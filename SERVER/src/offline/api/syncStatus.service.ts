// =============================================================================
// SYNC STATUS SERVICE  (edge side)
//
// Everything the offline UX needs in one query set: what the cashier's
// indicator shows, and what an owner looks at when something is wrong.
//
// ── The number that actually matters ─────────────────────────────────────────
// `oldestPendingAgeSeconds`, not the pending count. Two hundred items queued
// during a two-hour outage is normal operation working exactly as designed.
// Six items that have been sitting there since Tuesday means synchronization
// has been broken for three days and nobody noticed — and THAT is business
// sitting on one un-backed-up machine. The age is what distinguishes them, so
// it is surfaced as a first-class field rather than left to be derived.
// =============================================================================

import { offlineConfig } from "../config";
import { connectivitySnapshot } from "../datasource/connectivity";
import { getLocalClient } from "../datasource/localClient";
import { getDataSourceMode } from "../datasource/router";
import { verifyChangeCapture } from "../sync/changeCapture";
import { isSyncing } from "../sync/engine";
import type { SyncRunSummary, SyncStatusResponse } from "../sync/protocol";
import { SYNC_PROTOCOL_VERSION } from "../sync/protocol";

// =============================================================================
// SHAPES
// =============================================================================

interface RunRow {
  id: string;
  direction: string;
  trigger: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  itemsTotal: number;
  itemsSucceeded: number;
  itemsFailed: number;
  itemsConflicted: number;
  error: string | null;
}

function toRunSummary(run: RunRow): SyncRunSummary {
  return {
    id: run.id,
    direction: run.direction as SyncRunSummary["direction"],
    trigger: run.trigger,
    status: run.status as SyncRunSummary["status"],
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    durationMs: run.durationMs,
    itemsTotal: run.itemsTotal,
    itemsSucceeded: run.itemsSucceeded,
    itemsFailed: run.itemsFailed,
    itemsConflicted: run.itemsConflicted,
    error: run.error,
  };
}

// =============================================================================
// STATUS
// =============================================================================

export async function getSyncStatus(): Promise<SyncStatusResponse> {
  const config = offlineConfig();
  const local = getLocalClient();

  // Grouped in one round trip rather than five sequential awaits. Cheap against
  // SQLite, but this endpoint is polled by every open till screen.
  const [counts, oldest, lastDownload, lastUpload, capture] = await Promise.all([
    local.syncQueueItem.groupBy({ by: ["status"], _count: { _all: true } }),
    local.syncQueueItem.findFirst({
      where: { status: { in: ["PENDING", "IN_FLIGHT"] } },
      orderBy: { localTimestamp: "asc" },
      select: { localTimestamp: true },
    }),
    local.syncRun.findFirst({
      where: { direction: "DOWNLOAD" },
      orderBy: { startedAt: "desc" },
    }),
    local.syncRun.findFirst({
      where: { direction: "UPLOAD" },
      orderBy: { startedAt: "desc" },
    }),
    verifyChangeCapture(local),
  ]);

  const byStatus = new Map(counts.map((row) => [row.status, row._count._all]));
  const connectivity = connectivitySnapshot();

  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    deviceId: config.deviceId,
    role: config.role,
    dataSource: getDataSourceMode(),

    connectivity: {
      state: connectivity.state,
      lastOnlineAt: connectivity.lastOnlineAt?.toISOString() ?? null,
      latencyMs: connectivity.latencyMs,
    },

    queue: {
      pending: byStatus.get("PENDING") ?? 0,
      failed: byStatus.get("FAILED") ?? 0,
      conflicted: byStatus.get("CONFLICT") ?? 0,
      inFlight: byStatus.get("IN_FLIGHT") ?? 0,
      oldestPendingAgeSeconds:
        oldest === null
          ? null
          : Math.max(0, Math.floor((Date.now() - oldest.localTimestamp.getTime()) / 1000)),
    },

    lastDownload: lastDownload === null ? null : toRunSummary(lastDownload),
    lastUpload: lastUpload === null ? null : toRunSummary(lastUpload),
    syncing: isSyncing(),

    // False means local writes are NOT being queued. The UI treats this as a
    // hard alarm rather than a warning: the till looks fine and is silently
    // discarding the day's business.
    captureHealthy: capture.missing.length === 0,
  };
}

// =============================================================================
// HISTORY / QUEUE / CONFLICTS
// =============================================================================

export async function getSyncHistory(limit = 50): Promise<SyncRunSummary[]> {
  const local = getLocalClient();

  const runs = await local.syncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(1, limit), 200),
  });

  return runs.map(toRunSummary);
}

export async function getQueueItems(params: {
  status?: string | undefined;
  limit?: number | undefined;
}): Promise<{
  items: Array<Record<string, unknown>>;
  total: number;
}> {
  const local = getLocalClient();

  const where = params.status === undefined ? {} : { status: params.status };
  const take = Math.min(Math.max(1, params.limit ?? 100), 500);

  const [items, total] = await Promise.all([
    local.syncQueueItem.findMany({
      where,
      orderBy: { id: "asc" },
      take,
      // The payload is deliberately excluded. A page of 500 full row snapshots
      // is megabytes of JSON that no operator screen renders, and it can
      // contain customer contact details that have no business being in a
      // monitoring list.
      select: {
        id: true,
        entity: true,
        entityId: true,
        operation: true,
        status: true,
        attempts: true,
        lastError: true,
        lastAttempt: true,
        localTimestamp: true,
        syncedAt: true,
      },
    }),
    local.syncQueueItem.count({ where }),
  ]);

  return { items, total };
}

export async function getConflicts(limit = 50): Promise<Array<Record<string, unknown>>> {
  const local = getLocalClient();

  return local.syncConflict.findMany({
    orderBy: { detectedAt: "desc" },
    take: Math.min(Math.max(1, limit), 200),
  });
}

export async function getSyncEvents(
  params: { runId?: string | undefined; limit?: number | undefined } = {}
): Promise<Array<Record<string, unknown>>> {
  const local = getLocalClient();

  return local.syncEvent.findMany({
    where: params.runId === undefined ? {} : { runId: params.runId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(1, params.limit ?? 100), 500),
  });
}

// =============================================================================
// CONSISTENCY CHECK
// =============================================================================

export interface ConsistencyReport {
  readonly checkedAt: string;
  readonly healthy: boolean;
  readonly findings: readonly string[];
  readonly captureTriggers: { expected: number; installed: number; missing: number };
  readonly queue: {
    pending: number;
    failed: number;
    conflicted: number;
    stalledInFlight: number;
    oldestPendingAgeSeconds: number | null;
  };
}

/**
 * The data-integrity self-check.
 *
 * Every finding here corresponds to a way this node could be quietly failing
 * while looking perfectly healthy from the outside.
 */
export async function runConsistencyCheck(): Promise<ConsistencyReport> {
  const local = getLocalClient();
  const findings: string[] = [];

  const capture = await verifyChangeCapture(local);

  if (capture.missing.length > 0) {
    findings.push(
      `${capture.missing.length} change-capture triggers are missing — local ` +
        `writes to those tables are NOT being queued for upload`
    );
  }

  const nodeState = await local.syncNodeState.findUnique({ where: { id: "singleton" } });

  if (nodeState !== null && !nodeState.captureEnabled) {
    findings.push(
      "Change capture is DISABLED. A download was interrupted; writes since " +
        "then have not been queued."
    );
  }

  const [pending, failed, conflicted, stalled, oldest] = await Promise.all([
    local.syncQueueItem.count({ where: { status: "PENDING" } }),
    local.syncQueueItem.count({ where: { status: "FAILED" } }),
    local.syncQueueItem.count({ where: { status: "CONFLICT" } }),
    local.syncQueueItem.count({
      where: {
        status: "IN_FLIGHT",
        // In flight for more than ten minutes means the run that claimed them
        // is gone; a live batch completes in seconds.
        lastAttempt: { lt: new Date(Date.now() - 10 * 60 * 1000) },
      },
    }),
    local.syncQueueItem.findFirst({
      where: { status: { in: ["PENDING", "IN_FLIGHT"] } },
      orderBy: { localTimestamp: "asc" },
      select: { localTimestamp: true },
    }),
  ]);

  if (failed > 0) {
    findings.push(`${failed} queue items have exhausted their retries and need attention`);
  }

  if (conflicted > 0) {
    findings.push(`${conflicted} queue items were resolved against this device and need review`);
  }

  if (stalled > 0) {
    findings.push(
      `${stalled} queue items have been in flight for over ten minutes — the ` +
        `run that claimed them did not finish`
    );
  }

  const oldestAge =
    oldest === null
      ? null
      : Math.floor((Date.now() - oldest.localTimestamp.getTime()) / 1000);

  // 24 hours is the threshold because the design target is one business day
  // offline. Beyond that, this is no longer the feature working — it is the
  // feature failing quietly.
  if (oldestAge !== null && oldestAge > 86_400) {
    findings.push(
      `The oldest un-uploaded item is ${Math.floor(oldestAge / 3600)} hours old. ` +
        `A full business day of data is sitting on this machine only.`
    );
  }

  return {
    checkedAt: new Date().toISOString(),
    healthy: findings.length === 0,
    findings,
    captureTriggers: {
      expected: capture.expected,
      installed: capture.installed,
      missing: capture.missing.length,
    },
    queue: {
      pending,
      failed,
      conflicted,
      stalledInFlight: stalled,
      oldestPendingAgeSeconds: oldestAge,
    },
  };
}
