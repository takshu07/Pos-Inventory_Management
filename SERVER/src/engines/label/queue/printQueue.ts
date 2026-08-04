// =============================================================================
// PRINT QUEUE WORKER
//
// "Never print immediately. Every request becomes a Print Job. Jobs are
// processed sequentially."
//
// Why sequential is a requirement, not a simplification: a thermal printer has
// ONE print head and no job multiplexing. Two concurrent writes to the same
// socket interleave their command streams and produce garbage labels — and on
// label media, garbage means physically wasted stock. So the worker processes
// one job at a time, in FIFO order.
//
// Reliability model:
//   • Jobs are claimed atomically (conditional UPDATE) — a job can never be
//     printed twice, even if a second worker process appears.
//   • A crash mid-print leaves a job claimed; startup recovery releases jobs
//     stuck in PRINTING so the queue cannot deadlock on a dead process.
//   • Retryable failures (printer offline) go back to PENDING and are retried
//     with backoff up to maxAttempts. Non-retryable ones (bad template) fail
//     immediately rather than burning the retry budget.
//   • The loop is self-scheduling and idles when empty, so an idle POS does not
//     hammer the database.
// =============================================================================

import { randomUUID } from "node:crypto";

import {
  ActionModule,
  ActionType,
  PrintJobItemStatus,
  PrintJobStatus,
} from "../../../../generated/prisma";
import { logger } from "../../../config/logger";
import { auditRepository } from "../../../repositories/audit.repository";
import { labelTemplateRepository } from "../../../repositories/labelTemplate.repository";
import { printerRepository } from "../../../repositories/printer.repository";
import {
  printJobRepository,
  type PrintJobDetail,
} from "../../../repositories/printJob.repository";
import { printerService } from "../../../services/printer.service";
import { labelDataResolver } from "../labelData.resolver";
import type { LabelDocument } from "../label.types";
import {
  resolveTemplate,
} from "../templates/template.engine";

/**
 * Poll interval when the queue is empty.
 *
 * COST OF THIS CONSTANT (measured 2026-08-04, production-hardening phase):
 * this poll runs forever, whether or not anything is queued — roughly 43,000
 * round-trips a day on a completely idle store. The query itself is optimal
 * (`EXPLAIN ANALYZE`: 0.045ms server-side, Bitmap Index Scan on
 * `print_jobs_status_createdAt_idx`); the cost is entirely the round-trip. On
 * the measured Neon instance that round-trip was ~980ms, so the worker was
 * holding a pool connection roughly half the time while doing nothing, and
 * Neon's compute could never autosuspend.
 *
 * The default is UNCHANGED at 2000ms so print latency behaves exactly as
 * before. It is env-tunable so a deployment on a high-latency or
 * autosuspending database can widen it without a code change. Raising it only
 * delays the START of a print job — throughput once printing is governed by
 * BUSY_POLL_MS below, which is untouched.
 */
const IDLE_POLL_MS = Number.parseInt(
  process.env["PRINT_QUEUE_IDLE_POLL_MS"] ?? "2000",
  10
);
/** Delay between jobs when work is available — keeps the head from thrashing. */
const BUSY_POLL_MS = 100;
/** A job PRINTING longer than this is presumed abandoned by a dead process. */
const STALE_CLAIM_MS = 2 * 60 * 1000;
/** Backoff before a retryable failure is picked up again. */
const RETRY_BACKOFF_MS = 5000;

class PrintQueueWorker {
  /** Identifies this worker instance in claim records. */
  private readonly workerId = `worker-${randomUUID().slice(0, 8)}`;
  private running = false;
  private stopping = false;
  private timer: NodeJS.Timeout | null = null;
  private processedCount = 0;

  /** True while a job is actively being printed — exposed for diagnostics. */
  private currentJobId: string | null = null;

  isRunning(): boolean {
    return this.running;
  }

  getStatus(): {
    running: boolean;
    workerId: string;
    currentJobId: string | null;
    processedCount: number;
  } {
    return {
      running: this.running,
      workerId: this.workerId,
      currentJobId: this.currentJobId,
      processedCount: this.processedCount,
    };
  }

  /**
   * Starts the worker. Safe to call more than once — a second call is a no-op,
   * which matters under `tsx watch` where modules re-evaluate on every save.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopping = false;

    logger.info({ workerId: this.workerId }, "[PrintQueue] Worker started");

    await this.recoverStaleJobs();
    this.scheduleNext(0);
  }

  /** Stops after the in-flight job finishes — never mid-print. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.running = false;
    logger.info({ workerId: this.workerId }, "[PrintQueue] Worker stopped");
  }

  /**
   * Wakes the worker immediately instead of waiting for the next poll.
   * Called right after a job is enqueued so an interactive print feels instant.
   */
  wake(): void {
    if (!this.running || this.stopping) return;
    this.scheduleNext(0);
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopping) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  /**
   * Releases jobs abandoned by a crashed process.
   *
   * Without this, a job claimed at the moment of a crash stays PRINTING
   * forever and every later job queues behind it.
   */
  private async recoverStaleJobs(): Promise<void> {
    try {
      const stale = await printJobRepository.findStale(STALE_CLAIM_MS);
      if (stale.length === 0) return;

      const released = await printJobRepository.releaseStale(stale.map((job) => job.id));
      logger.warn(
        { released, workerId: this.workerId },
        "[PrintQueue] Released stale jobs from a previous process"
      );
    } catch (err) {
      logger.error({ err }, "[PrintQueue] Stale job recovery failed");
    }
  }

  /** One iteration: claim a job if there is one, process it, reschedule. */
  private async tick(): Promise<void> {
    if (this.stopping) return;

    try {
      const job = await printJobRepository.claimNext(this.workerId);

      if (!job) {
        this.scheduleNext(IDLE_POLL_MS);
        return;
      }

      this.currentJobId = job.id;
      await this.processJob(job);
      this.currentJobId = null;
      this.processedCount += 1;

      // Immediately look for more work — a 40-label purchase receipt should
      // not wait a full poll interval between jobs.
      this.scheduleNext(BUSY_POLL_MS);
    } catch (err) {
      this.currentJobId = null;
      logger.error({ err, workerId: this.workerId }, "[PrintQueue] Tick failed");
      this.scheduleNext(IDLE_POLL_MS);
    }
  }

  /**
   * Executes one claimed job end-to-end: resolve data → render → deliver →
   * record outcome → audit.
   */
  private async processJob(job: PrintJobDetail): Promise<void> {
    const startedAt = Date.now();

    logger.info(
      { jobId: job.id, jobNumber: job.jobNumber, labels: job.totalLabels },
      "[PrintQueue] Processing job"
    );

    void auditRepository.create({
      performedBy: job.requestedBy.id,
      action: ActionType.LABEL_PRINT_STARTED,
      module: ActionModule.LABEL,
      tableName: "print_jobs",
      recordId: job.id,
      newData: {
        jobNumber: job.jobNumber,
        attempt: job.attempts,
        printerId: job.printer?.id ?? null,
        templateId: job.template.id,
      },
    });

    try {
      await printJobRepository.updateItemStatuses(job.id, PrintJobItemStatus.PRINTING);

      // ── Resolve template ────────────────────────────────────────────────────
      const templateRow = await labelTemplateRepository.findById(job.template.id);
      if (!templateRow) {
        await this.failJob(
          job,
          `Template "${job.template.name}" no longer exists.`,
          false,
          startedAt
        );
        return;
      }
      const template = resolveTemplate(templateRow);

      // ── Resolve label data (ONE query for every item) ───────────────────────
      const variantIds = job.items.map((item) => item.variantId);
      const { labels, missingIds } = await labelDataResolver.resolveMany(
        variantIds,
        template.barcodeSymbology
      );

      // A deleted variant must not abort the whole job — mark just those items
      // failed and print the rest. Losing 1 label of 40 beats losing all 40.
      if (missingIds.length > 0) {
        const missingItemIds = job.items
          .filter((item) => missingIds.includes(item.variantId))
          .map((item) => item.id);
        await printJobRepository.markItemsFailed(
          missingItemIds,
          "Product variant no longer exists."
        );
        logger.warn(
          { jobId: job.id, missing: missingIds.length },
          "[PrintQueue] Some variants could not be resolved"
        );
      }

      if (labels.length === 0) {
        await this.failJob(
          job,
          "None of this job's products could be resolved.",
          false,
          startedAt
        );
        return;
      }

      // ── Expand copies ──────────────────────────────────────────────────────
      // Per-item copies are expanded into repeated documents so a job can mix
      // "3 of this variant, 1 of that" — the drivers' own `copies` argument
      // only supports a uniform multiplier.
      const copiesByVariant = new Map(
        job.items.map((item) => [item.variantId, item.copies])
      );

      const documents: LabelDocument[] = [];
      for (const label of labels) {
        const copies = copiesByVariant.get(label.variantId) ?? 1;
        for (let copy = 0; copy < copies; copy += 1) {
          documents.push({ template, data: label, warnings: [] });
        }
      }

      // ── Deliver ────────────────────────────────────────────────────────────
      const printer = job.printer
        ? await printerRepository.findById(job.printer.id)
        : null;

      const result = await printerService.execute(documents, {
        printer,
        output: job.output,
        copies: 1, // copies already expanded above
      });

      if (!result.ok) {
        await this.failJob(
          job,
          result.error ?? "Print failed.",
          result.retryable,
          startedAt
        );
        return;
      }

      // ── Success ────────────────────────────────────────────────────────────
      const durationMs = Date.now() - startedAt;
      await printJobRepository.updateItemStatuses(job.id, PrintJobItemStatus.COMPLETED);
      await printJobRepository.markCompleted(job.id, durationMs);

      // Usage counters drive the template picker's "most used" ordering.
      void labelTemplateRepository.incrementUsage(template.id).catch(() => {});

      void auditRepository.create({
        performedBy: job.requestedBy.id,
        action: ActionType.LABEL_PRINT_COMPLETED,
        module: ActionModule.LABEL,
        tableName: "print_jobs",
        recordId: job.id,
        newData: {
          jobNumber: job.jobNumber,
          labels: documents.length,
          durationMs,
          bytesWritten: result.bytesWritten,
          output: job.output,
        },
      });

      logger.info(
        { jobId: job.id, jobNumber: job.jobNumber, durationMs, labels: documents.length },
        "[PrintQueue] Job completed"
      );
    } catch (err) {
      // An unexpected throw is treated as retryable: it is more likely a
      // transient DB/network fault than a permanent data problem.
      await this.failJob(
        job,
        err instanceof Error ? err.message : "Unexpected print failure.",
        true,
        startedAt
      );
    }
  }

  private async failJob(
    job: PrintJobDetail,
    reason: string,
    retryable: boolean,
    startedAt: number
  ): Promise<void> {
    const { willRetry } = await printJobRepository.markFailed(job.id, reason, retryable);

    if (!willRetry) {
      await printJobRepository.updateItemStatuses(
        job.id,
        PrintJobItemStatus.FAILED,
        reason
      );
    }

    void auditRepository.create({
      performedBy: job.requestedBy.id,
      action: ActionType.LABEL_PRINT_FAILED,
      module: ActionModule.LABEL,
      tableName: "print_jobs",
      recordId: job.id,
      newData: {
        jobNumber: job.jobNumber,
        reason,
        attempt: job.attempts,
        willRetry,
        durationMs: Date.now() - startedAt,
      },
    });

    logger.warn(
      { jobId: job.id, jobNumber: job.jobNumber, reason, willRetry },
      "[PrintQueue] Job failed"
    );

    // Back off before the retry so a printer that is briefly offline is not
    // hammered once per loop iteration.
    if (willRetry) this.scheduleNext(RETRY_BACKOFF_MS);
  }
}

/**
 * Singleton worker.
 *
 * Stored on globalThis for the same reason the Prisma client is: under
 * `tsx watch` the module is re-evaluated on every file change, and without
 * this guard each reload would start an additional worker, so a single job
 * could be claimed and printed by several workers at once.
 */
const globalForQueue = globalThis as unknown as {
  printQueueWorker: PrintQueueWorker | undefined;
};

export const printQueue: PrintQueueWorker =
  globalForQueue.printQueueWorker ?? new PrintQueueWorker();

if (process.env["NODE_ENV"] !== "production") {
  globalForQueue.printQueueWorker = printQueue;
}

export { PrintJobStatus };
