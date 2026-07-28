// =============================================================================
// LABEL SERVICE  —  the Label Engine's public facade
//
// This is the ONLY entry point other modules use. Product, Purchase, Inventory,
// Sales and Search all call these functions; none of them touches a printer,
// a driver, a template or the queue directly.
//
// Everything funnels through here so that:
//   • RBAC is checked in one place, on every path.
//   • Every print becomes a queued job — nothing prints synchronously.
//   • Audit records are written for preview, PDF, print and reprint alike.
//   • Options are resolved (settings → request overrides) exactly once and
//     frozen onto the job, so later settings changes never rewrite history.
// =============================================================================

import {
  ActionModule,
  ActionType,
  type BarcodeSymbology,
  type EmployeeRole,
  type PrintJobStatus,
  PrintOutputMode,
  type PrintSourceModule,
  type Prisma,
} from "../../generated/prisma";
import { logger } from "../config/logger";
import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { labelDataResolver } from "../engines/label/labelData.resolver";
import type { LabelDocument } from "../engines/label/label.types";
import { printQueue } from "../engines/label/queue/printQueue";
import { pdfRenderer } from "../engines/label/renderers/pdf.renderer";
import { svgRenderer } from "../engines/label/renderers/svg.renderer";
import { resolveTemplate } from "../engines/label/templates/template.engine";
import { auditRepository } from "../repositories/audit.repository";
import { printerRepository } from "../repositories/printer.repository";
import {
  printJobRepository,
  type ListJobsQuery,
  type PrintJobDetail,
} from "../repositories/printJob.repository";
import { labelTemplateRepository } from "../repositories/labelTemplate.repository";
import * as labelTemplateService from "./labelTemplate.service";

// ─── RBAC ─────────────────────────────────────────────────────────────────────
//
// Mirrors the spec exactly. Route-level requireRole is the primary boundary;
// these helpers are the second layer so a service called from a new route can
// never accidentally skip the check.

/** OWNER + MANAGER + CASHIER: everyone may preview and print. */
function assertCanPrint(role: EmployeeRole): void {
  if (role !== "OWNER" && role !== "MANAGER" && role !== "CASHIER") {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "You are not permitted to print labels.");
  }
}

/** OWNER + MANAGER: batch printing is not a cashier capability. */
function assertCanBatchPrint(role: EmployeeRole): void {
  if (role !== "OWNER" && role !== "MANAGER") {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      "Batch printing requires Manager or Owner privileges."
    );
  }
}

/** OWNER only: printers, templates, settings, and full history. */
function assertOwner(role: EmployeeRole, capability: string): void {
  if (role !== "OWNER") {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      `${capability} requires Owner privileges.`
    );
  }
}

// ─── Option resolution ────────────────────────────────────────────────────────

/**
 * Per-request print overrides.
 *
 * Every field is `| undefined` explicitly rather than merely optional: these
 * objects come straight from Zod, whose `.optional()` yields `T | undefined`,
 * and the project compiles with exactOptionalPropertyTypes. Spelling out
 * `undefined` lets a parsed payload be passed through without per-field
 * conditional spreads at every call site.
 */
export interface PrintOptionOverrides {
  templateId?: string | null | undefined;
  printerId?: string | null | undefined;
  copies?: number | undefined;
  output?: PrintOutputMode | undefined;
  widthMm?: number | undefined;
  heightMm?: number | undefined;
  margins?: { top: number; right: number; bottom: number; left: number } | undefined;
  barcodeSymbology?: BarcodeSymbology | undefined;
  darkness?: number | undefined;
  printSpeed?: number | undefined;
  orientation?: string | undefined;
}

interface ResolvedPrintContext {
  template: Awaited<ReturnType<typeof labelTemplateService.resolveTemplateForPrint>>;
  printerId: string | null;
  output: PrintOutputMode;
  copies: number;
  /** Frozen onto the job so history reflects what actually applied. */
  options: Prisma.InputJsonValue;
}

/**
 * Merges saved settings with per-request overrides.
 *
 * Precedence: explicit request > stored settings > engine default. The result
 * is snapshotted onto the job because a job that ran last week must always
 * report the options it actually used, not today's settings.
 */
async function resolvePrintContext(
  overrides: PrintOptionOverrides
): Promise<ResolvedPrintContext> {
  const settings = await printerRepository.getSettings();

  const template = await labelTemplateService.resolveTemplateForPrint(
    overrides.templateId,
    settings.defaultTemplateId
  );

  // A thermal job needs a device; PDF/preview do not.
  const output = overrides.output ?? settings.outputMode;

  let printerId = overrides.printerId ?? settings.defaultPrinterId ?? null;

  if (output === PrintOutputMode.THERMAL) {
    if (printerId) {
      const printer = await printerRepository.findById(printerId);
      if (!printer) {
        throw new AppError(HTTP_STATUS.NOT_FOUND, "The selected printer no longer exists.");
      }
      if (!printer.isActive) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          `Printer "${printer.name}" is deactivated. Choose another printer.`
        );
      }
    } else {
      // Last resort before failing: any active printer beats refusing the job.
      const fallback = await printerRepository.findDefault();
      printerId = fallback?.id ?? null;
    }
  }

  const copies = Math.max(1, Math.min(999, overrides.copies ?? settings.defaultCopies));

  const options: Prisma.InputJsonValue = {
    templateCode: template.code,
    copies,
    output,
    barcodeSymbology: overrides.barcodeSymbology ?? settings.barcodeSymbology,
    darkness: overrides.darkness ?? settings.darkness,
    printSpeed: overrides.printSpeed ?? settings.printSpeed,
    orientation: overrides.orientation ?? settings.orientation,
    ...(overrides.widthMm !== undefined && { widthMm: overrides.widthMm }),
    ...(overrides.heightMm !== undefined && { heightMm: overrides.heightMm }),
    ...(overrides.margins !== undefined && { margins: overrides.margins }),
  };

  return { template, printerId, output, copies, options };
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export interface PreviewRequest {
  variantId?: string | null | undefined;
  templateId?: string | null | undefined;
  /** Preview a template with sample data (template designer). */
  sample?: boolean | undefined;
  scale?: number | undefined;
  showBoundary?: boolean | undefined;
}

/**
 * Renders an on-screen preview. Never prints, never queues.
 *
 * Available to every role — a cashier must be able to check a label before
 * consuming media.
 */
export async function previewLabel(
  request: PreviewRequest,
  actor: { id: string; role: EmployeeRole }
): Promise<{
  svg: string;
  widthMm: number;
  heightMm: number;
  warnings: string[];
  template: { id: string; code: string; name: string };
}> {
  assertCanPrint(actor.role);

  const settings = await printerRepository.getSettings();
  const templateRow = await labelTemplateService.resolveTemplateForPrint(
    request.templateId,
    settings.defaultTemplateId
  );
  const template = resolveTemplate(templateRow);

  const data =
    request.sample || !request.variantId
      ? await labelDataResolver.resolveSample(template.barcodeSymbology)
      : await labelDataResolver.resolveOne(request.variantId, template.barcodeSymbology);

  const document: LabelDocument = { template, data, warnings: [] };
  const result = svgRenderer.renderLabelToSvg(document, {
    ...(request.scale !== undefined && { scale: request.scale }),
    showBoundary: request.showBoundary ?? true,
  });

  // Audited: the spec requires preview generation to be recorded. Fire-and-
  // forget so a preview is never blocked by the audit write.
  void auditRepository.create({
    performedBy: actor.id,
    action: ActionType.LABEL_PREVIEW_GENERATED,
    module: ActionModule.LABEL,
    tableName: "label_templates",
    recordId: templateRow.id,
    newData: {
      variantId: request.variantId ?? null,
      sample: request.sample ?? false,
      templateCode: templateRow.code,
    },
  });

  return {
    svg: result.svg,
    widthMm: result.widthMm,
    heightMm: result.heightMm,
    warnings: result.warnings,
    template: { id: templateRow.id, code: templateRow.code, name: templateRow.name },
  };
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

export interface PdfRequest {
  variantIds: string[];
  templateId?: string | null | undefined;
  copies?: number | undefined;
}

/**
 * Generates a PDF directly (bulk download / fallback printing).
 *
 * Deliberately NOT queued: this is a synchronous document download, not a
 * physical print. Nothing is consumed and the user waits for the bytes.
 */
export async function generatePdf(
  request: PdfRequest,
  actor: { id: string; role: EmployeeRole }
): Promise<{ buffer: Buffer; pageCount: number; warnings: string[]; filename: string }> {
  assertCanPrint(actor.role);

  if (request.variantIds.length === 0) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Select at least one product to generate labels.");
  }
  // Batch-sized PDFs are a manager+ capability.
  if (request.variantIds.length > 1) assertCanBatchPrint(actor.role);

  const settings = await printerRepository.getSettings();
  const templateRow = await labelTemplateService.resolveTemplateForPrint(
    request.templateId,
    settings.defaultTemplateId
  );
  const template = resolveTemplate(templateRow);

  const { labels, missingIds } = await labelDataResolver.resolveMany(
    request.variantIds,
    template.barcodeSymbology
  );

  if (labels.length === 0) {
    throw new AppError(
      HTTP_STATUS.NOT_FOUND,
      "None of the selected products could be found."
    );
  }

  const documents: LabelDocument[] = labels.map((data) => ({
    template,
    data,
    warnings: [],
  }));

  const copies = Math.max(1, Math.min(999, request.copies ?? settings.defaultCopies));
  const result = await pdfRenderer.renderLabelsToPdf(documents, { copies });

  const warnings = [...result.warnings];
  if (missingIds.length > 0) {
    warnings.push(`${missingIds.length} product(s) could not be found and were skipped.`);
  }

  void auditRepository.create({
    performedBy: actor.id,
    action: ActionType.LABEL_PDF_GENERATED,
    module: ActionModule.LABEL,
    tableName: "label_templates",
    recordId: templateRow.id,
    newData: {
      variants: request.variantIds.length,
      pages: result.pageCount,
      copies,
      templateCode: templateRow.code,
    },
  });

  const filename = `labels-${templateRow.code}-${Date.now()}.pdf`;
  return { buffer: result.buffer, pageCount: result.pageCount, warnings, filename };
}

// ─── Printing (queued) ────────────────────────────────────────────────────────

export interface PrintRequestItem {
  variantId: string;
  copies?: number | undefined;
}

export interface PrintRequest {
  items: PrintRequestItem[];
  source: PrintSourceModule;
  reason?: string | null | undefined;
  options?: PrintOptionOverrides | undefined;
}

/**
 * Enqueues a print job. THE single path to physical output.
 *
 * Returns as soon as the job is persisted — the worker prints asynchronously.
 * That is what makes an offline printer harmless: the job waits rather than
 * the request failing and the intent being lost.
 */
export async function enqueuePrintJob(
  request: PrintRequest,
  actor: { id: string; role: EmployeeRole }
): Promise<PrintJobDetail> {
  assertCanPrint(actor.role);

  if (request.items.length === 0) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Select at least one product to print.");
  }
  if (request.items.length > 1) assertCanBatchPrint(actor.role);

  const overrides = request.options ?? {};
  const context = await resolvePrintContext(overrides);

  // Capture the barcode VALUE (never an image) at enqueue time so history and
  // reprints reproduce the same code even if the catalog changes later.
  const template = resolveTemplate(context.template);
  const { labels } = await labelDataResolver.resolveMany(
    request.items.map((item) => item.variantId),
    template.barcodeSymbology
  );
  const labelByVariant = new Map(labels.map((label) => [label.variantId, label]));

  const job = await printJobRepository.create({
    printerId: context.printerId,
    templateId: context.template.id,
    requestedById: actor.id,
    source: request.source,
    output: context.output,
    reason: request.reason ?? null,
    options: context.options,
    items: request.items.map((item, index) => {
      const label = labelByVariant.get(item.variantId);
      return {
        variantId: item.variantId,
        copies: Math.max(1, Math.min(999, item.copies ?? context.copies)),
        barcodeValue: label?.barcode ?? label?.sku ?? null,
        ...(label?.barcodeSymbology && { barcodeSymbology: label.barcodeSymbology }),
        sortOrder: index,
      };
    }),
  });

  logger.info(
    { jobId: job.id, jobNumber: job.jobNumber, items: job.totalLabels, actorId: actor.id },
    "[LabelEngine] Print job queued"
  );

  // Wake the worker so an interactive print starts immediately rather than
  // waiting for the next idle poll.
  printQueue.wake();

  return job;
}

export interface BatchPrintRequest {
  /** Explicit variant selection. */
  variantIds?: string[] | undefined;
  /** Or a filter — print every variant matching it. */
  filter?:
    | {
        categoryId?: string | undefined;
        brandId?: string | undefined;
        supplierId?: string | undefined;
        purchaseId?: string | undefined;
        search?: string | undefined;
      }
    | undefined;
  copiesPerLabel?: number | undefined;
  source: PrintSourceModule;
  reason?: string | null | undefined;
  options?: PrintOptionOverrides | undefined;
}

/** Hard ceiling on one batch — protects both the queue and the media roll. */
const MAX_BATCH_LABELS = 1000;

/**
 * Resolves a batch selection into variant ids.
 *
 * Supports "by category / brand / supplier / purchase / search" from the spec.
 * Bounded by MAX_BATCH_LABELS so a mis-clicked filter cannot queue the entire
 * catalog and empty a label roll.
 */
async function resolveBatchVariantIds(
  request: BatchPrintRequest
): Promise<string[]> {
  if (request.variantIds && request.variantIds.length > 0) {
    return request.variantIds.slice(0, MAX_BATCH_LABELS);
  }

  const filter = request.filter;
  if (!filter) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      "Provide either a product selection or a filter for batch printing."
    );
  }

  const { prisma } = await import("../config/prisma");

  // Purchase-based batches print one label per unit RECEIVED ("received 40
  // shirts → 40 labels"). Quantities live on PurchaseItem, so that expansion
  // belongs to labelIntegration.service, which calls enqueuePrintJob directly
  // with the per-variant copies already worked out.
  if (filter.purchaseId) {
    const purchaseItems = await prisma.purchaseItem.findMany({
      where: { purchaseId: filter.purchaseId },
      select: { variantId: true },
      take: MAX_BATCH_LABELS,
    });
    if (purchaseItems.length === 0) {
      throw new AppError(
        HTTP_STATUS.NOT_FOUND,
        "This purchase has no items to print labels for."
      );
    }
    return purchaseItems.map((item) => item.variantId);
  }

  const variants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      ...(filter.supplierId && { supplierId: filter.supplierId }),
      ...((filter.categoryId || filter.brandId || filter.search) && {
        product: {
          ...(filter.categoryId && { categoryId: filter.categoryId }),
          ...(filter.brandId && { brandId: filter.brandId }),
          ...(filter.search && {
            name: { contains: filter.search, mode: "insensitive" as const },
          }),
        },
      }),
    },
    select: { id: true },
    take: MAX_BATCH_LABELS,
    orderBy: { createdAt: "desc" },
  });

  if (variants.length === 0) {
    throw new AppError(
      HTTP_STATUS.NOT_FOUND,
      "No products matched this batch selection."
    );
  }

  return variants.map((variant) => variant.id);
}

/** Enqueues a batch job. MANAGER + OWNER only. */
export async function enqueueBatchPrintJob(
  request: BatchPrintRequest,
  actor: { id: string; role: EmployeeRole }
): Promise<PrintJobDetail> {
  assertCanBatchPrint(actor.role);

  const variantIds = await resolveBatchVariantIds(request);
  const copies = request.copiesPerLabel ?? 1;

  return enqueuePrintJob(
    {
      items: variantIds.map((variantId) => ({ variantId, copies })),
      source: request.source,
      reason: request.reason ?? null,
      ...(request.options !== undefined && { options: request.options }),
    },
    actor
  );
}

/**
 * Reprints an existing job.
 *
 * Creates a NEW job linked to the original rather than resetting it, so the
 * history of "printed twice" is preserved — which is exactly what a reprint
 * audit needs to show.
 */
export async function reprintJob(
  jobId: string,
  actor: { id: string; role: EmployeeRole },
  overrides: PrintOptionOverrides = {},
  reason?: string | null
): Promise<PrintJobDetail> {
  assertCanPrint(actor.role);

  const original = await printJobRepository.findById(jobId);
  if (!original) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Print job not found.");
  }

  // A cashier may reprint their own label, but not sweep a manager's 200-label
  // batch back onto the roll.
  if (original.items.length > 1) assertCanBatchPrint(actor.role);

  const context = await resolvePrintContext({
    templateId: overrides.templateId ?? original.template.id,
    printerId: overrides.printerId ?? original.printer?.id ?? null,
    ...overrides,
  });

  const job = await printJobRepository.create({
    printerId: context.printerId,
    templateId: context.template.id,
    requestedById: actor.id,
    source: original.source,
    output: context.output,
    reason: reason ?? `Reprint of ${original.jobNumber}`,
    options: context.options,
    reprintOfId: original.id,
    items: original.items.map((item, index) => ({
      variantId: item.variantId,
      copies: item.copies,
      barcodeValue: item.barcodeValue,
      barcodeSymbology: item.barcodeSymbology,
      sortOrder: index,
    })),
  });

  void auditRepository.create({
    performedBy: actor.id,
    action: ActionType.LABEL_REPRINTED,
    module: ActionModule.LABEL,
    tableName: "print_jobs",
    recordId: job.id,
    newData: {
      reprintOf: original.jobNumber,
      newJobNumber: job.jobNumber,
      labels: job.totalLabels,
      reason: reason ?? null,
    },
  });

  printQueue.wake();
  return job;
}

// ─── Queue management ─────────────────────────────────────────────────────────

export async function getJob(
  jobId: string,
  actor: { id: string; role: EmployeeRole }
): Promise<PrintJobDetail> {
  assertCanPrint(actor.role);

  const job = await printJobRepository.findById(jobId);
  if (!job) throw new AppError(HTTP_STATUS.NOT_FOUND, "Print job not found.");

  // A cashier sees only their own jobs; managers and owners see everything.
  if (actor.role === "CASHIER" && job.requestedBy.id !== actor.id) {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "You can only view your own print jobs.");
  }
  return job;
}

export async function listJobs(
  query: ListJobsQuery,
  actor: { id: string; role: EmployeeRole }
) {
  assertCanPrint(actor.role);

  // Scope cashiers to their own history rather than 403-ing the whole screen.
  const scoped: ListJobsQuery =
    actor.role === "CASHIER" ? { ...query, requestedById: actor.id } : query;

  return printJobRepository.findMany(scoped);
}

export async function getActiveQueue(actor: { role: EmployeeRole }) {
  assertCanPrint(actor.role);
  return printJobRepository.findActive();
}

export async function getQueueStats(actor: { role: EmployeeRole }) {
  assertCanPrint(actor.role);
  const [counts, worker] = await Promise.all([
    printJobRepository.countByStatus(),
    Promise.resolve(printQueue.getStatus()),
  ]);
  return { counts, worker };
}

export async function cancelJob(
  jobId: string,
  actor: { id: string; role: EmployeeRole }
): Promise<PrintJobDetail> {
  assertCanPrint(actor.role);

  const job = await printJobRepository.findById(jobId);
  if (!job) throw new AppError(HTTP_STATUS.NOT_FOUND, "Print job not found.");

  if (actor.role === "CASHIER" && job.requestedBy.id !== actor.id) {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "You can only cancel your own print jobs.");
  }

  const cancelled = await printJobRepository.cancel(jobId);
  if (!cancelled) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      `This job is ${job.status.toLowerCase()} and can no longer be cancelled.`,
      { reason: "JOB_NOT_CANCELLABLE", status: job.status }
    );
  }

  const updated = await printJobRepository.findById(jobId);
  return updated as PrintJobDetail;
}

/** Retries a failed job, optionally on a different printer. */
export async function retryJob(
  jobId: string,
  actor: { id: string; role: EmployeeRole },
  printerId?: string | null
): Promise<PrintJobDetail> {
  assertCanPrint(actor.role);

  const job = await printJobRepository.findById(jobId);
  if (!job) throw new AppError(HTTP_STATUS.NOT_FOUND, "Print job not found.");

  const requeued = await printJobRepository.requeue(jobId, printerId ?? undefined);
  if (!requeued) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      `This job is ${job.status.toLowerCase()} and cannot be retried.`,
      { reason: "JOB_NOT_RETRYABLE", status: job.status }
    );
  }

  printQueue.wake();
  return (await printJobRepository.findById(jobId)) as PrintJobDetail;
}

// ─── History ──────────────────────────────────────────────────────────────────

/** Full print history. OWNER-only per the RBAC matrix. */
export async function getHistory(
  query: ListJobsQuery,
  actor: { id: string; role: EmployeeRole }
) {
  assertOwner(actor.role, "Viewing full print history");
  return printJobRepository.findMany(query);
}

export { labelTemplateRepository, printJobRepository };

export const labelService = {
  previewLabel,
  generatePdf,
  enqueuePrintJob,
  enqueueBatchPrintJob,
  reprintJob,
  getJob,
  listJobs,
  getActiveQueue,
  getQueueStats,
  cancelJob,
  retryJob,
  getHistory,
} as const;

export type { PrintJobStatus };
