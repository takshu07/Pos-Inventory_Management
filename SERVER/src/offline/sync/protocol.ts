// =============================================================================
// SYNC WIRE PROTOCOL
//
// The shapes both sides agree on. Kept in one file, imported by the edge client
// and the cloud handlers alike, so the two cannot drift — a mismatched field
// name between uploader and applier would present as sales silently rejected.
//
// ── Design notes that matter ─────────────────────────────────────────────────
//
// Payloads travel as JSON STRINGS, not as nested objects. They are written by a
// SQLite trigger (`json_object(...)`) and applied on the far side after
// validation, and keeping them opaque in transit means the transport layer
// cannot accidentally coerce a Decimal to a float or a date to a locale string
// on the way through.
//
// Every response carries `serverTime`. An edge node's clock is whatever the
// shop set it to; anchoring cursors to the SERVER's clock stops a till with a
// fast clock from skipping rows it never received.
// =============================================================================

// =============================================================================
// SHARED
// =============================================================================

export const SYNC_PROTOCOL_VERSION = 1;

export type SyncOperation = "CREATE" | "UPDATE" | "DELETE";

/** What the cloud decided about one uploaded item. */
export type ItemOutcome =
  /** Written to the central database. */
  | "APPLIED"
  /** Already applied under this idempotency key. Not an error. */
  | "SKIPPED_DUPLICATE"
  /** Cloud's copy won under the conflict rules; the local payload is archived. */
  | "CONFLICT_CLOUD_WINS"
  /** Refused — malformed, unknown entity, or not something a till may author. */
  | "REJECTED";

// =============================================================================
// DOWNLOAD  (cloud → edge)
// =============================================================================

export interface DownloadRequest {
  readonly entity: string;
  /** Keyset cursor: the last (updatedAt, id) successfully pulled. */
  readonly since?: string | undefined;
  readonly sinceId?: string | undefined;
  readonly limit: number;
}

export interface DownloadResponse {
  readonly protocolVersion: number;
  readonly entity: string;
  /** Rows as plain JSON objects, ordered by (updatedAt, id) ascending. */
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly hasMore: boolean;
  /** Cursor to pass as `since`/`sinceId` on the next page. Null when done. */
  readonly nextCursor: { readonly updatedAt: string; readonly id: string } | null;
  readonly serverTime: string;
}

// =============================================================================
// UPLOAD  (edge → cloud)
// =============================================================================

export interface UploadItem {
  /** The edge node's local queue id. Echoed back so it can mark the right row. */
  readonly queueId: number;
  readonly idempotencyKey: string;
  readonly entity: string;
  readonly entityId: string;
  readonly operation: SyncOperation;
  /** JSON string of the row after the change. Null for DELETE. */
  readonly payload: string | null;
  /** JSON string of the row before the change. Null for CREATE. */
  readonly beforeData: string | null;
  readonly localTimestamp: string;
}

export interface UploadRequest {
  readonly protocolVersion: number;
  readonly deviceId: string;
  /** Stable id for this batch, so a resumed upload is recognizable. */
  readonly batchId: string;
  readonly items: readonly UploadItem[];
}

export interface UploadItemResult {
  readonly queueId: number;
  readonly idempotencyKey: string;
  readonly outcome: ItemOutcome;
  /** Present when the outcome is REJECTED or a conflict, for the operator. */
  readonly reason?: string;
}

export interface UploadResponse {
  readonly protocolVersion: number;
  readonly batchId: string;
  readonly results: readonly UploadItemResult[];
  readonly applied: number;
  readonly duplicates: number;
  readonly conflicts: number;
  readonly rejected: number;
  readonly serverTime: string;
}

// =============================================================================
// STATUS  (served by an edge node, for its own UI)
// =============================================================================

export interface SyncStatusResponse {
  readonly protocolVersion: number;
  readonly deviceId: string;
  readonly role: "edge" | "cloud";
  readonly dataSource: "local" | "cloud";

  readonly connectivity: {
    readonly state: "online" | "offline" | "unknown";
    readonly lastOnlineAt: string | null;
    readonly latencyMs: number | null;
  };

  readonly queue: {
    readonly pending: number;
    readonly failed: number;
    readonly conflicted: number;
    readonly inFlight: number;
    /** Age of the oldest un-uploaded item, in seconds. The number that tells an
     *  owner how much business is sitting on this machine unbacked-up. */
    readonly oldestPendingAgeSeconds: number | null;
  };

  readonly lastDownload: SyncRunSummary | null;
  readonly lastUpload: SyncRunSummary | null;
  /** True while a run holds the sync lock. */
  readonly syncing: boolean;

  readonly captureHealthy: boolean;
}

export interface SyncRunSummary {
  readonly id: string;
  readonly direction: "DOWNLOAD" | "UPLOAD" | "FULL";
  readonly trigger: string;
  readonly status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED" | "INTERRUPTED";
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
  readonly itemsTotal: number;
  readonly itemsSucceeded: number;
  readonly itemsFailed: number;
  readonly itemsConflicted: number;
  readonly error: string | null;
}
