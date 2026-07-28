// =============================================================================
// PRINT JOB REPOSITORY
// All database access for print_jobs and print_job_items.
//
// Design decisions:
// - Job number generation is done inside the creating transaction using a
//   count-based sequence. It is display-only (the cuid id is the real key), so
//   a rare duplicate under concurrency is cosmetic, never a data-integrity bug.
// - claimNext() uses a conditional UPDATE rather than SELECT-then-UPDATE. Two
//   workers racing for the same job is a real possibility (dev hot-reload, a
//   future second process); the WHERE clause on status makes the claim atomic
//   so a job can never print twice.
// - Explicit `select` everywhere — a print history page must not drag the whole
//   product graph across the wire.
// =============================================================================

import type { Prisma } from "../../generated/prisma";
import {
  PrintJobItemStatus,
  PrintJobStatus,
  PrintOutputMode,
  PrintSourceModule,
} from "../../generated/prisma";
import { prisma } from "../config/prisma";
import type { PaginatedResponse } from "../types/common.types";

// ─── Projections ──────────────────────────────────────────────────────────────

const JOB_LIST_SELECT = {
  id: true,
  jobNumber: true,
  status: true,
  source: true,
  output: true,
  reason: true,
  totalLabels: true,
  totalCopies: true,
  attempts: true,
  maxAttempts: true,
  failureReason: true,
  startedAt: true,
  completedAt: true,
  durationMs: true,
  createdAt: true,
  reprintOfId: true,
  printer: { select: { id: true, name: true, driver: true, connection: true } },
  template: { select: { id: true, code: true, name: true, kind: true } },
  requestedBy: {
    select: { id: true, firstName: true, lastName: true, role: true },
  },
} satisfies Prisma.PrintJobSelect;

const JOB_ITEM_SELECT = {
  id: true,
  variantId: true,
  copies: true,
  status: true,
  failureReason: true,
  barcodeValue: true,
  barcodeSymbology: true,
  sortOrder: true,
  templateId: true,
  variant: {
    select: {
      id: true,
      sku: true,
      barcode: true,
      size: { select: { name: true } },
      color: { select: { name: true } },
      product: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.PrintJobItemSelect;

export type PrintJobListRow = Prisma.PrintJobGetPayload<{
  select: typeof JOB_LIST_SELECT;
}>;

export type PrintJobDetail = PrintJobListRow & {
  items: Prisma.PrintJobItemGetPayload<{ select: typeof JOB_ITEM_SELECT }>[];
};

// ─── Creation ─────────────────────────────────────────────────────────────────

export interface CreateJobItemInput {
  variantId: string;
  copies: number;
  templateId?: string | null;
  barcodeValue?: string | null;
  barcodeSymbology?: Prisma.PrintJobItemCreateManyJobInput["barcodeSymbology"];
  sortOrder: number;
}

export interface CreateJobInput {
  printerId: string | null;
  templateId: string;
  requestedById: string;
  source: PrintSourceModule;
  output: PrintOutputMode;
  reason?: string | null;
  options: Prisma.InputJsonValue;
  maxAttempts?: number;
  reprintOfId?: string | null;
  items: CreateJobItemInput[];
  /** QUEUED normally; PENDING when the printer is known to be offline. */
  initialStatus?: PrintJobStatus;
}

/**
 * Generates the next display job number ("PJ-000241").
 *
 * Uses a count rather than a DB sequence to avoid adding a sequence object for
 * a cosmetic field. Called inside the create transaction.
 */
async function nextJobNumber(tx: Prisma.TransactionClient): Promise<string> {
  const count = await tx.printJob.count();
  return `PJ-${String(count + 1).padStart(6, "0")}`;
}

/**
 * Creates a job and its items atomically.
 *
 * Atomic because a job with no items would be claimed by the worker and
 * immediately "complete" having printed nothing — silently losing the request.
 */
async function create(input: CreateJobInput): Promise<PrintJobDetail> {
  return prisma.$transaction(async (tx) => {
    const jobNumber = await nextJobNumber(tx);

    const totalLabels = input.items.length;
    const totalCopies = input.items.reduce((sum, item) => sum + item.copies, 0);

    const job = await tx.printJob.create({
      data: {
        jobNumber,
        printerId: input.printerId,
        templateId: input.templateId,
        requestedById: input.requestedById,
        status: input.initialStatus ?? PrintJobStatus.QUEUED,
        source: input.source,
        output: input.output,
        reason: input.reason ?? null,
        options: input.options,
        totalLabels,
        totalCopies,
        maxAttempts: input.maxAttempts ?? 3,
        reprintOfId: input.reprintOfId ?? null,
        items: {
          createMany: {
            data: input.items.map((item) => ({
              variantId: item.variantId,
              copies: item.copies,
              templateId: item.templateId ?? null,
              barcodeValue: item.barcodeValue ?? null,
              ...(item.barcodeSymbology && { barcodeSymbology: item.barcodeSymbology }),
              sortOrder: item.sortOrder,
            })),
          },
        },
      },
      select: { ...JOB_LIST_SELECT, items: { select: JOB_ITEM_SELECT } },
    });

    return job as PrintJobDetail;
  });
}

// ─── Queue operations ─────────────────────────────────────────────────────────

/**
 * Atomically claims the oldest processable job for a worker.
 *
 * The conditional updateMany is the concurrency guard: only a job still in
 * QUEUED/PENDING can be claimed, so if two workers target the same job exactly
 * one succeeds (count === 1) and the loser moves on. A plain findFirst +
 * update would let both print the same labels.
 */
async function claimNext(workerId: string): Promise<PrintJobDetail | null> {
  const candidate = await prisma.printJob.findFirst({
    where: {
      status: { in: [PrintJobStatus.QUEUED, PrintJobStatus.PENDING] },
      attempts: { lt: prisma.printJob.fields.maxAttempts },
    },
    orderBy: { createdAt: "asc" }, // strict FIFO — jobs process sequentially
    select: { id: true },
  });

  if (!candidate) return null;

  const claimed = await prisma.printJob.updateMany({
    where: {
      id: candidate.id,
      status: { in: [PrintJobStatus.QUEUED, PrintJobStatus.PENDING] },
    },
    data: {
      status: PrintJobStatus.PRINTING,
      claimedAt: new Date(),
      claimedBy: workerId,
      startedAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  // Lost the race — another worker claimed it first.
  if (claimed.count === 0) return null;

  return findById(candidate.id);
}

/**
 * Returns jobs stuck in PRINTING past a threshold.
 *
 * A process killed mid-print leaves its job claimed forever. Without recovery
 * the queue would stall permanently on that job — so these are released back
 * to QUEUED at worker startup.
 */
async function findStale(olderThanMs: number): Promise<{ id: string }[]> {
  return prisma.printJob.findMany({
    where: {
      status: PrintJobStatus.PRINTING,
      claimedAt: { lt: new Date(Date.now() - olderThanMs) },
    },
    select: { id: true },
  });
}

async function releaseStale(jobIds: string[]): Promise<number> {
  if (jobIds.length === 0) return 0;
  const result = await prisma.printJob.updateMany({
    where: { id: { in: jobIds }, status: PrintJobStatus.PRINTING },
    data: { status: PrintJobStatus.QUEUED, claimedAt: null, claimedBy: null },
  });
  return result.count;
}

async function markCompleted(jobId: string, durationMs: number): Promise<void> {
  await prisma.printJob.update({
    where: { id: jobId },
    data: {
      status: PrintJobStatus.COMPLETED,
      completedAt: new Date(),
      durationMs,
      failureReason: null,
    },
  });
}

/**
 * Marks a job failed, or returns it to the queue when retries remain.
 *
 * `retryable` is false for errors no retry can fix (an invalid template, a
 * deleted variant) — retrying those just burns attempts and delays the queue.
 */
async function markFailed(
  jobId: string,
  reason: string,
  retryable: boolean
): Promise<{ willRetry: boolean }> {
  const job = await prisma.printJob.findUnique({
    where: { id: jobId },
    select: { attempts: true, maxAttempts: true },
  });

  const willRetry =
    retryable && !!job && job.attempts < job.maxAttempts;

  await prisma.printJob.update({
    where: { id: jobId },
    data: {
      // PENDING (not QUEUED) marks "held awaiting retry" so the UI can
      // distinguish a fresh job from one that has already failed once.
      status: willRetry ? PrintJobStatus.PENDING : PrintJobStatus.FAILED,
      failureReason: reason,
      claimedAt: null,
      claimedBy: null,
      ...(willRetry ? {} : { completedAt: new Date() }),
    },
  });

  return { willRetry };
}

async function updateItemStatuses(
  jobId: string,
  status: PrintJobItemStatus,
  failureReason?: string | null
): Promise<void> {
  await prisma.printJobItem.updateMany({
    where: { jobId },
    data: { status, failureReason: failureReason ?? null },
  });
}

async function markItemsFailed(
  itemIds: string[],
  failureReason: string
): Promise<void> {
  if (itemIds.length === 0) return;
  await prisma.printJobItem.updateMany({
    where: { id: { in: itemIds } },
    data: { status: PrintJobItemStatus.FAILED, failureReason },
  });
}

/**
 * Cancels a job. Only non-terminal jobs can be cancelled — cancelling a
 * COMPLETED job would rewrite history, and a job already PRINTING has bytes in
 * flight that we cannot recall.
 */
async function cancel(jobId: string): Promise<boolean> {
  const result = await prisma.printJob.updateMany({
    where: {
      id: jobId,
      status: { in: [PrintJobStatus.QUEUED, PrintJobStatus.PENDING] },
    },
    data: {
      status: PrintJobStatus.CANCELLED,
      completedAt: new Date(),
    },
  });

  if (result.count > 0) {
    await prisma.printJobItem.updateMany({
      where: { jobId },
      data: { status: PrintJobItemStatus.SKIPPED },
    });
  }
  return result.count > 0;
}

/** Re-queues a failed/cancelled job, resetting its retry budget. */
async function requeue(jobId: string, printerId?: string | null): Promise<boolean> {
  const result = await prisma.printJob.updateMany({
    where: {
      id: jobId,
      status: { in: [PrintJobStatus.FAILED, PrintJobStatus.CANCELLED, PrintJobStatus.PENDING] },
    },
    data: {
      status: PrintJobStatus.QUEUED,
      attempts: 0,
      failureReason: null,
      claimedAt: null,
      claimedBy: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      ...(printerId !== undefined && { printerId }),
    },
  });

  if (result.count > 0) {
    await prisma.printJobItem.updateMany({
      where: { jobId },
      data: { status: PrintJobItemStatus.PENDING, failureReason: null },
    });
  }
  return result.count > 0;
}

// ─── Reads ────────────────────────────────────────────────────────────────────

async function findById(id: string): Promise<PrintJobDetail | null> {
  const job = await prisma.printJob.findUnique({
    where: { id },
    select: {
      ...JOB_LIST_SELECT,
      items: { select: JOB_ITEM_SELECT, orderBy: { sortOrder: "asc" } },
    },
  });
  return job as PrintJobDetail | null;
}

export interface ListJobsQuery {
  page: number;
  limit: number;
  status?: PrintJobStatus | undefined;
  source?: PrintSourceModule | undefined;
  printerId?: string | undefined;
  templateId?: string | undefined;
  requestedById?: string | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
  search?: string | undefined;
}

async function findMany(
  query: ListJobsQuery
): Promise<PaginatedResponse<PrintJobListRow>> {
  const where: Prisma.PrintJobWhereInput = {
    ...(query.status && { status: query.status }),
    ...(query.source && { source: query.source }),
    ...(query.printerId && { printerId: query.printerId }),
    ...(query.templateId && { templateId: query.templateId }),
    ...(query.requestedById && { requestedById: query.requestedById }),
    ...((query.dateFrom || query.dateTo) && {
      createdAt: {
        ...(query.dateFrom && { gte: query.dateFrom }),
        ...(query.dateTo && { lte: query.dateTo }),
      },
    }),
    ...(query.search && {
      OR: [
        { jobNumber: { contains: query.search, mode: "insensitive" as const } },
        { reason: { contains: query.search, mode: "insensitive" as const } },
        {
          items: {
            some: {
              variant: {
                OR: [
                  { sku: { contains: query.search, mode: "insensitive" as const } },
                  {
                    product: {
                      name: { contains: query.search, mode: "insensitive" as const },
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    }),
  };

  const [data, total] = await Promise.all([
    prisma.printJob.findMany({
      where,
      select: JOB_LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.printJob.count({ where }),
  ]);

  const totalPages = Math.ceil(total / query.limit);
  return {
    data,
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1,
    },
  };
}

/** Live queue snapshot for the queue table + background polling. */
async function findActive(limit = 50): Promise<PrintJobListRow[]> {
  return prisma.printJob.findMany({
    where: {
      status: {
        in: [PrintJobStatus.QUEUED, PrintJobStatus.PENDING, PrintJobStatus.PRINTING],
      },
    },
    select: JOB_LIST_SELECT,
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

/** Status counts for the queue/history dashboards — one grouped query. */
async function countByStatus(): Promise<Record<PrintJobStatus, number>> {
  const rows = await prisma.printJob.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const counts = {
    QUEUED: 0,
    PENDING: 0,
    PRINTING: 0,
    COMPLETED: 0,
    FAILED: 0,
    CANCELLED: 0,
  } as Record<PrintJobStatus, number>;

  for (const row of rows) counts[row.status] = row._count._all;
  return counts;
}

export const printJobRepository = {
  create,
  claimNext,
  findStale,
  releaseStale,
  markCompleted,
  markFailed,
  updateItemStatuses,
  markItemsFailed,
  cancel,
  requeue,
  findById,
  findMany,
  findActive,
  countByStatus,
} as const;
