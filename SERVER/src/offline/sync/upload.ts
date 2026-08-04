// =============================================================================
// UPLOAD — draining the local queue to the cloud ("night sync")
//
// Reads `sync_queue` in ascending id and ships it in batches. Ascending id is
// not an arbitrary ordering: the queue id is assigned by the capture trigger at
// the moment of the write, so replaying it reproduces the exact order things
// happened at the till. That is what keeps a Sale ahead of its SaleItems and a
// CashRegister ahead of the transactions posted against it — without it the
// cloud's foreign keys would reject perfectly good data.
//
// ── The four guarantees, and the mechanism behind each ───────────────────────
//
//   No duplicate uploads   Every item carries an idempotency key generated once
//                          at capture. The cloud keeps a unique ledger of them.
//                          A retry of a batch that actually succeeded is
//                          answered SKIPPED_DUPLICATE, not applied twice.
//
//   No lost transactions   Items move PENDING → IN_FLIGHT → SYNCED. Nothing is
//                          ever deleted on the way through, and IN_FLIGHT is
//                          reset to PENDING on the next run (see
//                          `recoverStalledItems`). The worst case is sending
//                          something twice, which the ledger absorbs.
//
//   Atomic uploads         The cloud applies a whole batch in one Postgres
//                          transaction. A batch either lands entirely or not at
//                          all; there is no half-applied sale.
//
//   Resume                 Progress is per-item, not per-run. A sync killed at
//                          item 4,000 of 10,000 resumes at 4,001 because the
//                          first 4,000 are already SYNCED.
//
// ── Why status is written BEFORE the request, not after ──────────────────────
// Marking IN_FLIGHT first costs an extra write but converts the dangerous
// failure into the safe one. If the process dies mid-request, the items are
// IN_FLIGHT and get retried (possibly a duplicate send — absorbed by the
// ledger). Had they still been PENDING with the request already sent, that is
// identical; but had we marked them SYNCED optimistically, a crashed request
// would strand real sales as "already uploaded" and they would never be sent.
// =============================================================================

import { randomUUID } from "node:crypto";

import { logger } from "../../config/logger";
import { offlineConfig } from "../config";
import { getLocalClient, type LocalClient } from "../datasource/localClient";

import type {
  UploadItem,
  UploadRequest,
  UploadResponse,
  UploadItemResult,
} from "./protocol";
import { SYNC_PROTOCOL_VERSION } from "./protocol";
import { recordEvent } from "./runLog";
import {
  backoffDelayMs,
  isExhausted,
  logTransportFailure,
  SyncTransportError,
  syncRequest,
} from "./transport";

// =============================================================================
// TYPES
// =============================================================================

export interface UploadOutcome {
  readonly batches: number;
  readonly itemsSent: number;
  readonly applied: number;
  readonly duplicates: number;
  readonly conflicts: number;
  readonly rejected: number;
  readonly failed: number;
  readonly bytesSent: number;
  /** True when the queue was fully drained. */
  readonly drained: boolean;
  readonly stoppedBecause?: string;
}

// =============================================================================
// RECOVERY
// =============================================================================

/**
 * Returns items stranded IN_FLIGHT by a crashed run to PENDING.
 *
 * Runs at the start of every upload rather than only at boot: a run that threw
 * without unwinding leaves the same residue, and an item stuck IN_FLIGHT is
 * invisible to the next drain — which is precisely the "lost transaction" this
 * design exists to prevent.
 */
export async function recoverStalledItems(client?: LocalClient): Promise<number> {
  const local = client ?? getLocalClient();

  const { count } = await local.syncQueueItem.updateMany({
    where: { status: "IN_FLIGHT" },
    data: { status: "PENDING", batchId: null },
  });

  if (count > 0) {
    logger.warn(
      { items: count },
      "offline: returned stranded in-flight queue items to PENDING"
    );
    await recordEvent(
      null,
      "INTEGRITY_CHECK",
      `Recovered ${count} queue items stranded in flight by an interrupted upload`,
      { level: "WARN", client: local }
    );
  }

  return count;
}

// =============================================================================
// SELECTION
// =============================================================================

/**
 * Picks the next batch.
 *
 * Items that have already failed are held back until their backoff expires, so
 * one poison record cannot monopolize every batch and starve the sales queued
 * behind it.
 */
async function claimBatch(
  local: LocalClient,
  batchId: string,
  limit: number
): Promise<UploadItem[]> {
  const now = new Date();

  const candidates = await local.syncQueueItem.findMany({
    where: {
      status: "PENDING",
      OR: [
        { attempts: 0 },
        { lastAttempt: null },
        { lastAttempt: { lt: new Date(now.getTime() - offlineConfig().retry.baseBackoffMs) } },
      ],
    },
    orderBy: { id: "asc" },
    take: limit,
  });

  if (candidates.length === 0) return [];

  await local.syncQueueItem.updateMany({
    where: { id: { in: candidates.map((item) => item.id) } },
    data: { status: "IN_FLIGHT", batchId, lastAttempt: now },
  });

  return candidates.map((item) => ({
    queueId: item.id,
    idempotencyKey: item.idempotencyKey,
    entity: item.entity,
    entityId: item.entityId,
    operation: item.operation as UploadItem["operation"],
    payload: item.payload,
    beforeData: item.beforeData,
    localTimestamp: item.localTimestamp.toISOString(),
  }));
}

// =============================================================================
// RESULT APPLICATION
// =============================================================================

async function applyResults(
  local: LocalClient,
  results: readonly UploadItemResult[],
  runId: string
): Promise<{ applied: number; duplicates: number; conflicts: number; rejected: number }> {
  const counts = { applied: 0, duplicates: 0, conflicts: 0, rejected: 0 };

  // Grouped so the whole batch's bookkeeping is a handful of statements rather
  // than one per item — the same bulk discipline the rest of this codebase uses.
  const synced: number[] = [];
  const conflicted: { id: number; reason: string }[] = [];
  const rejected: { id: number; reason: string }[] = [];

  for (const result of results) {
    switch (result.outcome) {
      case "APPLIED":
        counts.applied += 1;
        synced.push(result.queueId);
        break;

      case "SKIPPED_DUPLICATE":
        // The cloud already had it. That is a SUCCESS from the till's point of
        // view — the data is safely central — so the item is marked SYNCED, not
        // failed. Treating it as an error here is what turns one lost response
        // into a queue that never drains.
        counts.duplicates += 1;
        synced.push(result.queueId);
        break;

      case "CONFLICT_CLOUD_WINS":
        counts.conflicts += 1;
        conflicted.push({ id: result.queueId, reason: result.reason ?? "cloud copy won" });
        break;

      case "REJECTED":
        counts.rejected += 1;
        rejected.push({ id: result.queueId, reason: result.reason ?? "rejected by cloud" });
        break;
    }
  }

  const now = new Date();

  if (synced.length > 0) {
    await local.syncQueueItem.updateMany({
      where: { id: { in: synced } },
      data: { status: "SYNCED", syncedAt: now, lastError: null },
    });
  }

  // Conflicts and rejections are terminal: the cloud has made a decision, and
  // re-sending identical bytes would only get the same answer. They are parked
  // in a state a human can see and act on, never silently dropped.
  for (const item of conflicted) {
    await local.syncQueueItem.update({
      where: { id: item.id },
      data: { status: "CONFLICT", lastError: item.reason, syncedAt: now },
    });
  }

  for (const item of rejected) {
    await local.syncQueueItem.update({
      where: { id: item.id },
      data: { status: "FAILED", lastError: item.reason },
    });
    await recordEvent(runId, "ITEM_FAILED", `Cloud rejected queue item ${item.id}`, {
      level: "ERROR",
      detail: { reason: item.reason },
      client: local,
    });
  }

  return counts;
}

/**
 * Handles a batch whose request failed outright (no response, or a 5xx).
 *
 * The items go back to PENDING with their attempt count incremented — except
 * those that have exhausted their attempts, which are parked as FAILED so a
 * permanently poisonous record cannot block the queue behind it forever.
 */
async function releaseBatch(
  local: LocalClient,
  batchId: string,
  error: SyncTransportError | Error,
  runId: string
): Promise<number> {
  const items = await local.syncQueueItem.findMany({ where: { batchId, status: "IN_FLIGHT" } });

  let parked = 0;

  for (const item of items) {
    const attempts = item.attempts + 1;

    if (isExhausted(attempts)) {
      parked += 1;
      await local.syncQueueItem.update({
        where: { id: item.id },
        data: {
          status: "FAILED",
          attempts,
          lastError: `${error.message} (gave up after ${attempts} attempts)`,
          batchId: null,
        },
      });
      continue;
    }

    await local.syncQueueItem.update({
      where: { id: item.id },
      data: { status: "PENDING", attempts, lastError: error.message, batchId: null },
    });
  }

  if (parked > 0) {
    await recordEvent(
      runId,
      "ITEM_FAILED",
      `${parked} queue items exhausted their retries and were parked as FAILED`,
      { level: "ERROR", client: local }
    );
  }

  return items.length;
}

// =============================================================================
// DRAIN
// =============================================================================

export async function uploadPendingChanges(
  runId: string,
  options: { client?: LocalClient; maxBatches?: number } = {}
): Promise<UploadOutcome> {
  const local = options.client ?? getLocalClient();
  const config = offlineConfig();

  await recoverStalledItems(local);

  const outcome = {
    batches: 0,
    itemsSent: 0,
    applied: 0,
    duplicates: 0,
    conflicts: 0,
    rejected: 0,
    failed: 0,
    bytesSent: 0,
  };

  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;
  let stoppedBecause: string | undefined;

  while (outcome.batches < maxBatches) {
    const batchId = randomUUID();
    const items = await claimBatch(local, batchId, config.uploadBatchSize);

    if (items.length === 0) break;

    outcome.batches += 1;
    outcome.itemsSent += items.length;

    const request: UploadRequest = {
      protocolVersion: SYNC_PROTOCOL_VERSION,
      deviceId: config.deviceId,
      batchId,
      items,
    };

    await recordEvent(runId, "BATCH_SENT", `Sending ${items.length} items`, {
      detail: { batchId, firstQueueId: items[0]?.queueId, lastQueueId: items.at(-1)?.queueId },
      client: local,
    });

    try {
      const response = await syncRequest<UploadResponse>({
        method: "POST",
        path: "/api/v1/sync/upload",
        body: request,
      });

      outcome.bytesSent += response.bytesSent;

      const counts = await applyResults(local, response.data.results, runId);
      outcome.applied += counts.applied;
      outcome.duplicates += counts.duplicates;
      outcome.conflicts += counts.conflicts;
      outcome.rejected += counts.rejected;

      // ── The gap check ──────────────────────────────────────────────────────
      // A result must come back for every item sent. A short response means the
      // cloud silently dropped some, and leaving them IN_FLIGHT would hide them
      // from every future drain. Push the unanswered ones back to PENDING.
      if (response.data.results.length !== items.length) {
        const answered = new Set(response.data.results.map((r) => r.queueId));
        const unanswered = items.filter((item) => !answered.has(item.queueId));

        await local.syncQueueItem.updateMany({
          where: { id: { in: unanswered.map((item) => item.queueId) } },
          data: { status: "PENDING", batchId: null },
        });

        logger.error(
          { sent: items.length, answered: response.data.results.length },
          "offline: cloud returned fewer results than items sent — requeued the remainder"
        );
      }

      await recordEvent(runId, "BATCH_ACKED", `Cloud accepted ${counts.applied} items`, {
        detail: { batchId, ...counts },
        client: local,
      });
    } catch (error) {
      const transportError =
        error instanceof Error ? error : new Error(String(error));

      logTransportFailure("upload batch", error);
      outcome.failed += await releaseBatch(local, batchId, transportError, runId);

      // A terminal error means every subsequent batch would fail identically —
      // bad credentials, a protocol mismatch. Stop and surface it rather than
      // burning the whole queue's retry budget on the same wall.
      if (error instanceof SyncTransportError && !error.retryable) {
        stoppedBecause = `terminal transport error: ${error.message}`;
        break;
      }

      stoppedBecause = `transport error: ${transportError.message}`;
      break;
    }
  }

  const remaining = await local.syncQueueItem.count({ where: { status: "PENDING" } });

  return {
    ...outcome,
    drained: remaining === 0,
    ...(stoppedBecause === undefined ? {} : { stoppedBecause }),
  };
}

// =============================================================================
// RETRY
// =============================================================================

/**
 * Moves FAILED items back to PENDING so the next run picks them up.
 *
 * Deliberately does NOT reset `attempts`: the count is the record of how much
 * trouble an item has been, and zeroing it would let a genuinely poisonous
 * record cycle forever. An operator retrying from the UI wants another go, not
 * amnesia.
 *
 * CONFLICT items are excluded — the cloud made a decision about those, and
 * re-sending the same bytes gets the same answer. They need a human.
 */
export async function retryFailedItems(
  options: { ids?: number[]; client?: LocalClient } = {}
): Promise<number> {
  const local = options.client ?? getLocalClient();

  const { count } = await local.syncQueueItem.updateMany({
    where: {
      status: "FAILED",
      ...(options.ids === undefined ? {} : { id: { in: options.ids } }),
    },
    data: { status: "PENDING", lastError: null, batchId: null },
  });

  logger.info({ items: count }, "offline: failed queue items requeued");
  return count;
}

/** Delay before the next attempt for an item, honoring jittered backoff. */
export function nextRetryDelayMs(attempts: number): number {
  return backoffDelayMs(attempts);
}
