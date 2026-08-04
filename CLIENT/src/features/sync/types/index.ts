/**
 * Offline synchronization — shared types.
 *
 * These mirror `SERVER/src/offline/sync/protocol.ts`. Kept as a hand-written
 * copy rather than imported across the project boundary, matching how every
 * other feature in this client treats server contracts.
 */

export type ConnectivityState = "online" | "offline" | "unknown";

export type SyncRunStatus =
  | "RUNNING"
  | "SUCCESS"
  | "PARTIAL"
  | "FAILED"
  | "INTERRUPTED";

export type SyncDirection = "DOWNLOAD" | "UPLOAD" | "FULL";

export interface SyncRunSummary {
  id: string;
  direction: SyncDirection;
  trigger: string;
  status: SyncRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  itemsTotal: number;
  itemsSucceeded: number;
  itemsFailed: number;
  itemsConflicted: number;
  error: string | null;
}

export interface SyncStatus {
  protocolVersion: number;
  deviceId: string;
  role: "edge" | "cloud";
  dataSource: "local" | "cloud";

  connectivity: {
    state: ConnectivityState;
    lastOnlineAt: string | null;
    latencyMs: number | null;
  };

  queue: {
    pending: number;
    failed: number;
    conflicted: number;
    inFlight: number;
    /**
     * Age of the oldest un-uploaded item.
     *
     * This — not `pending` — is the number that says whether something is
     * WRONG. 200 items queued during a two-hour outage is the feature working;
     * 6 items queued since Tuesday is the feature broken.
     */
    oldestPendingAgeSeconds: number | null;
  };

  lastDownload: SyncRunSummary | null;
  lastUpload: SyncRunSummary | null;
  syncing: boolean;

  /** False means local writes are NOT being captured. A hard alarm. */
  captureHealthy: boolean;
}

export interface SyncQueueItem {
  id: number;
  entity: string;
  entityId: string;
  operation: "CREATE" | "UPDATE" | "DELETE";
  status: "PENDING" | "IN_FLIGHT" | "SYNCED" | "FAILED" | "CONFLICT";
  attempts: number;
  lastError: string | null;
  lastAttempt: string | null;
  localTimestamp: string;
  syncedAt: string | null;
}

export interface SyncConflict {
  id: string;
  runId: string | null;
  entity: string;
  entityId: string;
  resolution: "CLOUD_WINS" | "LOCAL_WINS" | "MANUAL";
  reason: string;
  localData: string | null;
  cloudData: string | null;
  detectedAt: string;
  reviewedAt: string | null;
}

export interface SyncRunResult {
  runId: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
  skippedBecause?: string;
  durationMs: number;
}

export interface SyncHealthReport {
  checkedAt: string;
  healthy: boolean;
  findings: string[];
  captureTriggers: { expected: number; installed: number; missing: number };
  queue: {
    pending: number;
    failed: number;
    conflicted: number;
    stalledInFlight: number;
    oldestPendingAgeSeconds: number | null;
  };
}

/**
 * What the indicator actually shows.
 *
 * Deliberately NOT the same as `ConnectivityState`. A cashier does not need to
 * know the network state — they need to know whether their work is safe. Those
 * differ: a till that is online but has not drained its queue for two days is
 * "online" and very much not fine.
 */
export type SyncHealth = "SYNCED" | "PENDING" | "OFFLINE" | "DEGRADED" | "BROKEN";
