// =============================================================================
// SYNC RUN LOG
//
// Bookkeeping for "requirement: audit logging for every synchronization event".
// Two tables, deliberately separate:
//
//   sync_runs    one row per sync session, updated as it progresses.
//   sync_events  append-only breadcrumbs within a run.
//
// Why both? A run row is mutable, so a process killed mid-run leaves it stuck
// in RUNNING with nothing to say about how far it got. The event stream is
// append-only and survives, which is what makes an interrupted sync
// diagnosable after the fact rather than just "it was running, and then it
// wasn't".
// =============================================================================

import { randomUUID } from "node:crypto";

import { logger } from "../../config/logger";
import { getLocalClient, type LocalClient } from "../datasource/localClient";

// =============================================================================
// TYPES
// =============================================================================

export type SyncDirection = "DOWNLOAD" | "UPLOAD" | "FULL";
export type SyncTrigger = "MANUAL" | "SCHEDULED" | "AUTO" | "STARTUP" | "RECOVERY";
export type RunStatus = "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED" | "INTERRUPTED";

export type EventType =
  | "RUN_STARTED"
  | "BATCH_SENT"
  | "BATCH_ACKED"
  | "ITEM_FAILED"
  | "CONFLICT"
  | "MODE_CHANGED"
  | "RUN_FINISHED"
  | "INTEGRITY_CHECK";

export interface RunTotals {
  itemsTotal: number;
  itemsSucceeded: number;
  itemsFailed: number;
  itemsConflicted: number;
  bytesTransferred: number;
}

// =============================================================================
// RUNS
// =============================================================================

export async function startRun(
  direction: SyncDirection,
  trigger: SyncTrigger,
  client?: LocalClient
): Promise<string> {
  const local = client ?? getLocalClient();
  const id = randomUUID();

  await local.syncRun.create({
    data: { id, direction, trigger, status: "RUNNING" },
  });

  // Recording the active run on the node state is what lets the NEXT boot
  // recognize an interrupted run — see `reconcileInterruptedRuns`.
  await local.syncNodeState.updateMany({
    where: { id: "singleton" },
    data: { activeRunId: id },
  });

  await recordEvent(id, "RUN_STARTED", `${direction} sync started (${trigger})`, {
    client: local,
  });

  return id;
}

export async function finishRun(
  runId: string,
  status: RunStatus,
  totals: Partial<RunTotals>,
  options: { error?: string; detail?: unknown; client?: LocalClient } = {}
): Promise<void> {
  const local = options.client ?? getLocalClient();

  const run = await local.syncRun.findUnique({ where: { id: runId } });
  const durationMs = run === null ? null : Date.now() - run.startedAt.getTime();

  await local.syncRun.update({
    where: { id: runId },
    data: {
      status,
      finishedAt: new Date(),
      ...(durationMs === null ? {} : { durationMs }),
      ...(totals.itemsTotal === undefined ? {} : { itemsTotal: totals.itemsTotal }),
      ...(totals.itemsSucceeded === undefined
        ? {}
        : { itemsSucceeded: totals.itemsSucceeded }),
      ...(totals.itemsFailed === undefined ? {} : { itemsFailed: totals.itemsFailed }),
      ...(totals.itemsConflicted === undefined
        ? {}
        : { itemsConflicted: totals.itemsConflicted }),
      ...(totals.bytesTransferred === undefined
        ? {}
        : { bytesTransferred: totals.bytesTransferred }),
      ...(options.error === undefined ? {} : { error: options.error }),
      ...(options.detail === undefined ? {} : { detail: JSON.stringify(options.detail) }),
    },
  });

  await local.syncNodeState.updateMany({
    where: { id: "singleton" },
    data: { activeRunId: null },
  });

  await recordEvent(
    runId,
    "RUN_FINISHED",
    `sync finished: ${status}`,
    { level: status === "SUCCESS" ? "INFO" : status === "PARTIAL" ? "WARN" : "ERROR", client: local }
  );
}

/**
 * Marks runs left RUNNING by a killed process as INTERRUPTED.
 *
 * Called at startup. Without it, a till that lost power mid-sync shows a run
 * that has been "in progress" for eleven hours, and the status endpoint reports
 * `syncing: true` forever — which would make the UI's spinner permanent and,
 * worse, make the engine's "a run is already active" guard block every future
 * sync.
 */
export async function reconcileInterruptedRuns(client?: LocalClient): Promise<number> {
  const local = client ?? getLocalClient();

  const { count } = await local.syncRun.updateMany({
    where: { status: "RUNNING" },
    data: {
      status: "INTERRUPTED",
      finishedAt: new Date(),
      error: "Process exited while the run was in progress",
    },
  });

  await local.syncNodeState.updateMany({
    where: { id: "singleton" },
    data: { activeRunId: null },
  });

  if (count > 0) {
    logger.warn({ runs: count }, "offline: marked interrupted sync runs");
  }

  return count;
}

// =============================================================================
// EVENTS
// =============================================================================

export async function recordEvent(
  runId: string | null,
  type: EventType,
  message: string,
  options: {
    level?: "INFO" | "WARN" | "ERROR";
    entity?: string;
    detail?: unknown;
    client?: LocalClient;
  } = {}
): Promise<void> {
  const local = options.client ?? getLocalClient();

  try {
    await local.syncEvent.create({
      data: {
        id: randomUUID(),
        ...(runId === null ? {} : { runId }),
        type,
        level: options.level ?? "INFO",
        ...(options.entity === undefined ? {} : { entity: options.entity }),
        message,
        ...(options.detail === undefined ? {} : { detail: JSON.stringify(options.detail) }),
      },
    });
  } catch (err) {
    // The audit trail must never be able to fail the operation it is recording.
    // A sync that succeeded but could not write its own breadcrumb is still a
    // sync that succeeded.
    logger.error({ err, type, message }, "offline: failed to record sync event");
  }
}

/**
 * Trims the event log.
 *
 * A busy till writes a few hundred events a day. Left alone for a year that is
 * a table nobody reads competing for page cache with the sales the cashier is
 * waiting on. Runs are kept far longer than events because they are what the
 * history screen shows.
 */
export async function pruneLogs(
  options: { keepEventDays?: number; keepRunDays?: number; client?: LocalClient } = {}
): Promise<{ events: number; runs: number }> {
  const local = options.client ?? getLocalClient();

  const eventCutoff = new Date(Date.now() - (options.keepEventDays ?? 14) * 86_400_000);
  const runCutoff = new Date(Date.now() - (options.keepRunDays ?? 90) * 86_400_000);

  const events = await local.syncEvent.deleteMany({
    where: { createdAt: { lt: eventCutoff } },
  });

  // Only finished runs are prunable; a RUNNING row older than the cutoff is a
  // bug worth keeping visible.
  const runs = await local.syncRun.deleteMany({
    where: { startedAt: { lt: runCutoff }, status: { not: "RUNNING" } },
  });

  return { events: events.count, runs: runs.count };
}
