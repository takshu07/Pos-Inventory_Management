// =============================================================================
// OFFLINE-FIRST RUNTIME CONFIGURATION
//
// Every knob for the offline/sync subsystem is resolved HERE, once, from the
// environment. Nothing else in `src/offline/` reads `process.env` directly.
//
// ── The single most important property of this module ────────────────────────
// `OFFLINE_MODE_ENABLED` defaults to FALSE. With it unset, the offline
// subsystem never initializes, the datasource router always resolves to the
// existing Neon/Postgres client, and the server behaves EXACTLY as it did
// before this feature existed. That is deliberate: the offline layer is
// strictly additive, and an existing cloud deployment must be able to take this
// code without changing a single environment variable.
//
// ── Roles ────────────────────────────────────────────────────────────────────
// A deployment plays exactly one role:
//
//   "cloud" — the central Neon-backed server. Source of truth for long-term
//             storage. Serves the /api/v1/sync/* endpoints that edge nodes
//             talk to. Never reads or writes SQLite.
//
//   "edge"  — the in-store node that cashiers actually use. Operates against
//             local SQLite all day, captures every write into a durable sync
//             queue, and reconciles with the cloud when a connection exists.
//
// The same image runs both; only OFFLINE_ROLE differs. That keeps one codebase
// and one set of business rules for both sides of the sync.
// =============================================================================

import path from "node:path";

// =============================================================================
// TYPES
// =============================================================================

/** Which side of the sync relationship this process is. */
export type DeploymentRole = "cloud" | "edge";

/**
 * Which database the datasource router is currently serving.
 *
 * This is a RUNTIME value on edge nodes (it does not change on cloud nodes,
 * which are permanently "cloud").
 */
export type DataSourceMode = "cloud" | "local";

export interface RetryPolicy {
  /** Max upload attempts for a single queue item before it is parked as FAILED. */
  readonly maxAttempts: number;
  /** First retry delay, in ms. Doubles per attempt up to `maxBackoffMs`. */
  readonly baseBackoffMs: number;
  /** Ceiling for the exponential backoff. */
  readonly maxBackoffMs: number;
}

export interface OfflineConfig {
  /** Master switch. When false the whole subsystem is inert. */
  readonly enabled: boolean;
  readonly role: DeploymentRole;

  /** Stable identity for this edge node. Namespaces idempotency keys. */
  readonly deviceId: string;

  /** Absolute path to the SQLite database file (edge only). */
  readonly localDatabasePath: string;

  /** Base URL of the cloud server this edge node syncs with (edge only). */
  readonly cloudBaseUrl: string;

  /**
   * Shared secret used to sign sync requests (edge) and verify them (cloud).
   * Sync is machine-to-machine, so it is authenticated by HMAC rather than by
   * a cashier's JWT — an edge node must be able to drain its queue at 2am with
   * nobody logged in.
   */
  readonly deviceSecret: string;

  /** Rows per page when downloading master data. */
  readonly downloadBatchSize: number;
  /** Queue items per upload batch. */
  readonly uploadBatchSize: number;
  /** Gzip request/response bodies above this many bytes. */
  readonly compressionThresholdBytes: number;

  readonly retry: RetryPolicy;

  /** How often the connectivity probe runs, in ms. */
  readonly connectivityProbeIntervalMs: number;
  /** Probe request timeout, in ms. */
  readonly connectivityTimeoutMs: number;
  /**
   * Consecutive probe failures before the router flips to local. >1 stops a
   * single dropped packet from bouncing the whole store into offline mode.
   */
  readonly connectivityFailureThreshold: number;
  /** Consecutive probe successes before the router flips back to cloud. */
  readonly connectivitySuccessThreshold: number;

  /** Run the background drain loop automatically when connectivity returns. */
  readonly autoSyncEnabled: boolean;
  /** How often the background drain loop wakes up, in ms. */
  readonly autoSyncIntervalMs: number;

  /**
   * Reject signed sync requests whose timestamp is further from now than this.
   * The replay window — see `src/offline/security/requestSignature.ts`.
   */
  readonly signatureToleranceMs: number;
}

// =============================================================================
// ENV PARSING HELPERS
// =============================================================================

function readBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function readInt(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readString(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

function readRole(): DeploymentRole {
  return readString("OFFLINE_ROLE", "cloud").toLowerCase() === "edge"
    ? "edge"
    : "cloud";
}

// =============================================================================
// RESOLUTION
// =============================================================================

/**
 * Builds the config from the current environment.
 *
 * Exported (rather than only the frozen singleton) so tests can rebuild it
 * after mutating `process.env` without reloading the module graph.
 */
export function resolveOfflineConfig(): OfflineConfig {
  const role = readRole();

  return {
    enabled: readBool("OFFLINE_MODE_ENABLED", false),
    role,

    // A blank deviceId is only safe on cloud nodes, which never enqueue.
    // `assertOfflineConfigValid` rejects it for edge nodes.
    deviceId: readString("OFFLINE_DEVICE_ID", ""),

    localDatabasePath: path.resolve(
      process.cwd(),
      readString("LOCAL_DATABASE_PATH", "./data/pos-local.db")
    ),

    cloudBaseUrl: readString("SYNC_CLOUD_URL", "").replace(/\/+$/, ""),
    deviceSecret: readString("SYNC_DEVICE_SECRET", ""),

    downloadBatchSize: readInt("SYNC_DOWNLOAD_BATCH_SIZE", 500),

    // 50, not 200. The cloud applies a batch in ONE interactive transaction
    // budgeted at 120s (cloudApply.ts). Against Neon a round trip costs ~330ms,
    // so 200 items cannot finish inside that window — the transaction expires,
    // the whole batch rolls back, and the till retries the same doomed payload
    // forever. 50 leaves comfortable headroom; a day's queue simply uploads as
    // several batches, which the receipt ledger already makes idempotent.
    uploadBatchSize: readInt("SYNC_UPLOAD_BATCH_SIZE", 50),
    compressionThresholdBytes: readInt("SYNC_COMPRESSION_THRESHOLD", 4096),

    retry: {
      maxAttempts: readInt("SYNC_MAX_ATTEMPTS", 8),
      baseBackoffMs: readInt("SYNC_BASE_BACKOFF_MS", 2000),
      maxBackoffMs: readInt("SYNC_MAX_BACKOFF_MS", 5 * 60 * 1000),
    },

    connectivityProbeIntervalMs: readInt("SYNC_PROBE_INTERVAL_MS", 15000),
    connectivityTimeoutMs: readInt("SYNC_PROBE_TIMEOUT_MS", 4000),
    connectivityFailureThreshold: readInt("SYNC_PROBE_FAIL_THRESHOLD", 2),
    connectivitySuccessThreshold: readInt("SYNC_PROBE_OK_THRESHOLD", 2),

    autoSyncEnabled: readBool("SYNC_AUTO_ENABLED", true),
    autoSyncIntervalMs: readInt("SYNC_AUTO_INTERVAL_MS", 60000),

    signatureToleranceMs: readInt("SYNC_SIGNATURE_TOLERANCE_MS", 5 * 60 * 1000),
  };
}

/**
 * Fails fast on a configuration that would break at runtime rather than at
 * boot. Called from `server.ts` alongside `validateEnvironment()`.
 *
 * Only edge nodes are validated strictly: a cloud node needs nothing beyond the
 * shared secret it verifies signatures with, and a disabled node needs nothing
 * at all.
 */
export function assertOfflineConfigValid(config: OfflineConfig): void {
  if (!config.enabled) return;

  const problems: string[] = [];

  if (config.role === "edge") {
    if (!config.deviceId) {
      problems.push(
        "OFFLINE_DEVICE_ID is required on an edge node — it namespaces every " +
          "idempotency key, so two stores sharing one id would silently " +
          "deduplicate each other's sales."
      );
    }
    if (!config.cloudBaseUrl) {
      problems.push("SYNC_CLOUD_URL is required on an edge node.");
    }
  }

  if (!config.deviceSecret) {
    problems.push(
      "SYNC_DEVICE_SECRET is required whenever OFFLINE_MODE_ENABLED=true " +
        "(edge nodes sign sync requests with it; cloud nodes verify them)."
    );
  } else if (config.deviceSecret.length < 32) {
    problems.push(
      "SYNC_DEVICE_SECRET must be at least 32 characters — it is the only " +
        "credential protecting the sync upload endpoint."
    );
  }

  if (config.retry.maxAttempts < 1) {
    problems.push("SYNC_MAX_ATTEMPTS must be at least 1.");
  }
  if (config.uploadBatchSize < 1 || config.downloadBatchSize < 1) {
    problems.push("Sync batch sizes must be at least 1.");
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid offline-first configuration:\n  - ${problems.join("\n  - ")}`
    );
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let cached: OfflineConfig | undefined;

/** The resolved config for this process. Memoized after first read. */
export function offlineConfig(): OfflineConfig {
  cached ??= resolveOfflineConfig();
  return cached;
}

/** Test seam: drops the memoized config so the next read re-parses env. */
export function resetOfflineConfigCache(): void {
  cached = undefined;
}

/** True when this process should operate against local SQLite. */
export function isEdgeNode(): boolean {
  const config = offlineConfig();
  return config.enabled && config.role === "edge";
}

/** True when this process should serve the /sync/* endpoints. */
export function isCloudNode(): boolean {
  const config = offlineConfig();
  return config.enabled && config.role === "cloud";
}
