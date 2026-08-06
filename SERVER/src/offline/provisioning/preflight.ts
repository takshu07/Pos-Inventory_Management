// =============================================================================
// PROVISIONING PREFLIGHT — the gate that decides whether a till may be wiped
//
// Provisioning DESTROYS a local database and rebuilds it from the cloud. That
// is exactly right for a new till and catastrophic for a working one, and the
// two are indistinguishable from the outside: both are a `pos-local.db` sitting
// in `data/`. Everything in this file exists to tell them apart BEFORE anything
// is deleted.
//
// ── The failure this prevents ────────────────────────────────────────────────
// A till trades all day offline. Its queue holds 900 sales that exist NOWHERE
// else in the world — not in Neon, not on paper. Someone runs the provisioning
// command on the wrong machine, or re-runs it after a failed attempt without
// looking. Rebuilding the mirror throws those sales away, and nothing errors:
// the new database is pristine, the catalog downloads cleanly, the till opens
// for business, and the loss is discovered at month end when the books are
// short by a day's takings.
//
// So the checks below are ordered by IRREVERSIBILITY, not by cost. Pending
// uploads are checked before database emptiness, because unsent sales are the
// only thing here that cannot be recovered from somewhere else.
//
// ── Blocking vs. confirmable ─────────────────────────────────────────────────
// Two severities, and the distinction is the whole design:
//
//   BLOCKING     — no flag overrides it. Data would be destroyed that exists
//                  in no other copy, or the operation is meaningless (wrong
//                  role). `--force` does NOT apply.
//   CONFIRMABLE  — legitimate in a re-provisioning, but must be stated out
//                  loud. Requires `--i-understand-this-destroys-the-mirror`.
//
// Making "queue is not empty" confirmable would defeat the point: the operator
// who most needs stopping is the one who is already convinced it is fine.
// =============================================================================

import fs from "node:fs";

import { offlineConfig, type OfflineConfig } from "../config";
import type { LocalClient } from "../datasource/localClient";

// =============================================================================
// TYPES
// =============================================================================

export type FindingSeverity =
  /** Refuses the run outright. No flag overrides it. */
  | "BLOCKING"
  /** Legitimate during re-provisioning, but requires explicit confirmation. */
  | "CONFIRMABLE"
  /**
   * Worth telling the operator, but never gates the run.
   *
   * The distinction from CONFIRMABLE is about what the confirmation flag MEANS.
   * `--i-understand-this-destroys-the-mirror` is a statement about DATA LOSS.
   * Attaching an unrelated hygiene warning to it teaches operators to pass the
   * flag reflexively on runs that destroy nothing — and the one time it does
   * mean data loss, they pass it without reading. Advisories keep that flag
   * scarce, and therefore meaningful.
   */
  | "ADVISORY";

export interface PreflightFinding {
  readonly code: string;
  readonly severity: FindingSeverity;
  readonly message: string;
  /** What the operator should actually do about it. */
  readonly remedy: string;
}

export interface PreflightResult {
  readonly findings: readonly PreflightFinding[];
  /** True when nothing blocks and every confirmable finding was confirmed. */
  readonly mayProceed: boolean;
  /** True when an existing mirror will be destroyed by proceeding. */
  readonly destroysExistingMirror: boolean;
}

export interface PreflightOptions {
  /** The operator passed --i-understand-this-destroys-the-mirror. */
  readonly confirmed: boolean;
  /**
   * Open handle to an EXISTING local database, if one is present and readable.
   * Null when there is no file, or when it could not be opened (corrupt).
   */
  readonly existing: LocalClient | null;
  /** Set when the existing file could not be opened at all. */
  readonly openError?: string | undefined;
  readonly config?: OfflineConfig;
}

// =============================================================================
// STRESS / TEST-DATA DETECTION
//
// A stress or validation harness leaves a database behind that looks completely
// normal. Provisioning on top of one would produce a till whose "clean" mirror
// is seeded with synthetic sales — which then upload to the cloud as real ones.
//
// Both markers below are what THIS repo's harnesses actually write:
//   scripts/validate-sync-e2e.ts  → device id "e2e-validation-till"
//   scripts/stress-sync.ts        → device ids prefixed "stress-"
//   scripts/production-stress.ts  → device ids prefixed "stress-"
// =============================================================================

/** Device ids that mean the database was built by a test harness, not a shop. */
const SYNTHETIC_DEVICE_PATTERNS: readonly RegExp[] = [
  /^e2e-/i,
  /^stress-/i,
  /^test-/i,
  /^till-test$/i,
  /^provisioning-test/i,
];

/** Database FILENAMES that belong to a harness rather than a real till. */
const SYNTHETIC_PATH_PATTERNS: readonly RegExp[] = [
  /e2e-validation\.db$/i,
  /stress[^/\\]*\.db$/i,
  /production-stress[^/\\]*\.db$/i,
];

export function isSyntheticDeviceId(deviceId: string): boolean {
  return SYNTHETIC_DEVICE_PATTERNS.some((pattern) => pattern.test(deviceId));
}

export function isSyntheticDatabasePath(databasePath: string): boolean {
  return SYNTHETIC_PATH_PATTERNS.some((pattern) => pattern.test(databasePath));
}

// =============================================================================
// INDIVIDUAL CHECKS
// =============================================================================

/**
 * The node must be configured as an edge till.
 *
 * Provisioning a cloud node is not a dangerous mistake so much as a meaningless
 * one — there is no mirror to build — but it is worth catching loudly, because
 * the operator who typed it believes they are provisioning something.
 */
function checkRole(config: OfflineConfig, findings: PreflightFinding[]): void {
  if (!config.enabled) {
    findings.push({
      code: "OFFLINE_DISABLED",
      severity: "BLOCKING",
      message:
        "OFFLINE_MODE_ENABLED is not set. Provisioning builds the local mirror " +
        "for an offline-capable till; with the feature off there is nothing to build.",
      remedy: "Set OFFLINE_MODE_ENABLED=true and OFFLINE_ROLE=edge for this command.",
    });
  }

  if (config.role !== "edge") {
    findings.push({
      code: "NOT_EDGE_ROLE",
      severity: "BLOCKING",
      message:
        `OFFLINE_ROLE is "${config.role}", not "edge". Only an edge till has a ` +
        "local mirror to provision — a cloud node reads Neon directly.",
      remedy: "Run this on the till, with OFFLINE_ROLE=edge.",
    });
  }

  if (config.role === "edge" && !config.deviceId) {
    findings.push({
      code: "NO_DEVICE_ID",
      severity: "BLOCKING",
      message:
        "OFFLINE_DEVICE_ID is empty. It namespaces every idempotency key, so a " +
        "till provisioned without one would mint keys under 'unregistered' and " +
        "collide with every other such till at the cloud.",
      remedy: "Set OFFLINE_DEVICE_ID to a unique id, e.g. store-01-till-03.",
    });
  }

  if (config.role === "edge" && !config.cloudBaseUrl) {
    findings.push({
      code: "NO_CLOUD_URL",
      severity: "BLOCKING",
      message:
        "SYNC_CLOUD_URL is empty. Provisioning downloads the entire mirror from " +
        "the cloud; without a cloud there is nothing to download.",
      remedy: "Set SYNC_CLOUD_URL to the cloud node's base URL.",
    });
  }
}

/**
 * An edge node must hold no production database credentials.
 *
 * A till with a DATABASE_URL is one misconfiguration away from writing the
 * shop floor's traffic straight into Neon, bypassing the queue entirely.
 *
 * ADVISORY, not confirmable. Provisioning itself never touches Neon directly —
 * it reaches the cloud only through the signed sync API — so this variable
 * cannot make the run less safe. It is a deployment-hygiene note surfaced at
 * the one moment somebody is actually looking at this node's configuration.
 * Gating on it would also make every developer rehearsal require the
 * destroys-the-mirror flag, which is exactly how that flag stops being read.
 */
function checkNoProductionCredentials(findings: PreflightFinding[]): void {
  if ((process.env["DATABASE_URL"] ?? "").trim() === "") return;

  findings.push({
    code: "EDGE_HAS_DATABASE_URL",
    severity: "ADVISORY",
    message:
      "This node has a DATABASE_URL set. A real till has none by design — it " +
      "reaches the cloud only through the signed sync API, and holding Neon " +
      "credentials on a shop-floor PC widens the blast radius of a stolen machine.",
    remedy:
      "On a real till, unset DATABASE_URL. On a workstation running this as a " +
      "rehearsal, confirm to continue.",
  });
}

/**
 * The synthetic-data check, run against the file that is about to be replaced.
 *
 * Detecting this at PREFLIGHT rather than only at verification matters: a
 * stress database that is about to be deleted is fine, but one whose device id
 * matches the id we are provisioning UNDER means the operator is about to
 * promote a test till to production under a synthetic identity.
 */
function checkConfiguredIdentity(
  config: OfflineConfig,
  findings: PreflightFinding[]
): void {
  if (config.deviceId && isSyntheticDeviceId(config.deviceId)) {
    findings.push({
      code: "SYNTHETIC_DEVICE_ID",
      severity: "CONFIRMABLE",
      message:
        `OFFLINE_DEVICE_ID "${config.deviceId}" matches a test-harness naming ` +
        "pattern. A real till provisioned under a harness id will have its sales " +
        "deduplicated against the harness's own idempotency keys at the cloud.",
      remedy:
        "Use a real store/till id. Confirm only if this is a rehearsal, not a " +
        "till that will take money.",
    });
  }

  if (isSyntheticDatabasePath(config.localDatabasePath)) {
    findings.push({
      // ADVISORY: a harness filename says nothing about what the run will do to
      // the cloud. The device id is the thing that can corrupt central data, and
      // that one is confirmable above.
      code: "SYNTHETIC_DB_PATH",
      severity: "ADVISORY",
      message:
        `LOCAL_DATABASE_PATH "${config.localDatabasePath}" is a harness database ` +
        "filename, not a production mirror path.",
      remedy: "Point LOCAL_DATABASE_PATH at the real mirror, or confirm for a rehearsal.",
    });
  }
}

/**
 * The three questions asked of an EXISTING database, in irreversibility order.
 *
 * Every one of these requires reading the old database before it is destroyed,
 * which is why provisioning opens it read-only first rather than unlinking the
 * file the moment it decides to rebuild.
 */
async function checkExistingDatabase(
  config: OfflineConfig,
  options: PreflightOptions,
  findings: PreflightFinding[]
): Promise<void> {
  const fileExists = fs.existsSync(config.localDatabasePath);

  if (!fileExists) return; // First-time provisioning. Nothing to protect.

  // ── Unreadable file ───────────────────────────────────────────────────────
  // A corrupt database is the one case where destroying it is probably right,
  // but we cannot read its queue to prove nothing is lost — so it is
  // confirmable, never automatic.
  if (options.existing === null) {
    findings.push({
      code: "EXISTING_DB_UNREADABLE",
      severity: "CONFIRMABLE",
      message:
        `A database exists at ${config.localDatabasePath} but could not be opened` +
        `${options.openError ? ` (${options.openError})` : ""}. It may be corrupt. ` +
        "Its queue cannot be read, so it is NOT possible to prove no unsent sales " +
        "would be destroyed.",
      remedy:
        "Preserve a copy of the file for forensics, then confirm to rebuild. " +
        "If this till traded today, escalate before proceeding.",
    });
    return;
  }

  const existing = options.existing;

  // ── 1. Pending uploads — the irreversible one ─────────────────────────────
  // Checked first and BLOCKING with no override. These rows are the only copy
  // of real business events. The correct action is always to drain, never to
  // provision through them.
  let queued = 0;
  try {
    queued = await existing.syncQueueItem.count({
      where: { status: { in: ["PENDING", "IN_FLIGHT", "FAILED", "CONFLICT"] } },
    });
  } catch {
    // The table is missing or unreadable — a partially initialized mirror.
    findings.push({
      code: "QUEUE_UNREADABLE",
      severity: "CONFIRMABLE",
      message:
        "The existing database has no readable sync_queue. It is a partially " +
        "initialized or non-mirror database.",
      remedy: "Confirm to rebuild, after preserving a copy of the file.",
    });
    return;
  }

  if (queued > 0) {
    findings.push({
      code: "PENDING_UPLOADS",
      severity: "BLOCKING",
      message:
        `The existing mirror holds ${queued} un-uploaded queue item(s). These are ` +
        "the ONLY copy of those sales — they are not in the cloud and not on paper. " +
        "Provisioning would destroy them silently.",
      remedy:
        "Drain first:  curl -X POST localhost:3000/api/v1/sync/run -d '{\"direction\":\"UPLOAD\"}'\n" +
        "    then confirm  GET /api/v1/sync/status  reports pending == 0 AND inFlight == 0.\n" +
        "    Items parked FAILED need  POST /api/v1/sync/retry  and a root-cause fix first.",
    });
  }

  // ── 2. Device identity — the reused-mirror check ──────────────────────────
  // A mirror copied from another till (a well-meant "clone the working one"
  // deployment) carries that till's device id. Both machines then mint
  // idempotency keys under one identity and the cloud silently discards one
  // store's sales as duplicates of the other's.
  try {
    const state = await existing.syncNodeState.findUnique({ where: { id: "singleton" } });

    if (state !== null && state.deviceId && state.deviceId !== "unregistered") {
      if (state.deviceId !== config.deviceId) {
        findings.push({
          code: "FOREIGN_MIRROR",
          severity: "CONFIRMABLE",
          message:
            `The existing mirror belongs to device "${state.deviceId}", but this ` +
            `node is configured as "${config.deviceId}". This is a mirror copied ` +
            "from another till — the two would mint colliding idempotency keys and " +
            "the cloud would discard one till's sales as duplicates of the other's.",
          remedy:
            "This is precisely what provisioning fixes: rebuilding gives this till " +
            "its own identity. Confirm to proceed, having verified the queue is empty.",
        });
      }

      if (isSyntheticDeviceId(state.deviceId)) {
        findings.push({
          code: "STRESS_DATABASE",
          severity: "CONFIRMABLE",
          message:
            `The existing mirror was built by a test harness (device "${state.deviceId}"). ` +
            "It contains synthetic sales that must never reach the cloud as real ones.",
          remedy: "Confirm to destroy it and rebuild from the cloud.",
        });
      }
    }
  } catch {
    findings.push({
      code: "NODE_STATE_UNREADABLE",
      severity: "CONFIRMABLE",
      message:
        "The existing database has no readable sync_node_state — it is a stale or " +
        "partially initialized mirror.",
      remedy: "Confirm to rebuild.",
    });
  }

  // ── 3. Non-empty business data ────────────────────────────────────────────
  // Reached only when the queue is clean, so this is catalog and history that
  // the cloud already has. Confirmable, because re-provisioning a drained till
  // is a legitimate and expected operation.
  try {
    const [products, sales] = await Promise.all([
      existing.product.count(),
      existing.sale.count(),
    ]);

    if (products > 0 || sales > 0) {
      findings.push({
        code: "DATABASE_NOT_EMPTY",
        severity: "CONFIRMABLE",
        message:
          `The existing mirror is not empty (${products} product(s), ${sales} sale(s)). ` +
          "Its queue is clean, so nothing here is unsent — but it will be destroyed.",
        remedy:
          "Confirm with --i-understand-this-destroys-the-mirror once you have " +
          "verified this is the till you meant.",
      });
    }
  } catch {
    findings.push({
      code: "SCHEMA_UNREADABLE",
      severity: "CONFIRMABLE",
      message:
        "The existing database does not expose the expected mirror schema. It is " +
        "stale or was never fully pushed.",
      remedy: "Confirm to rebuild.",
    });
  }
}

// =============================================================================
// ORCHESTRATION
// =============================================================================

/**
 * Runs every gate and decides whether provisioning may proceed.
 *
 * Pure with respect to the filesystem and both databases — it only READS. The
 * caller owns every destructive step, so a preflight that throws leaves the
 * till exactly as it found it.
 */
export async function runPreflight(options: PreflightOptions): Promise<PreflightResult> {
  const config = options.config ?? offlineConfig();
  const findings: PreflightFinding[] = [];

  checkRole(config, findings);
  checkConfiguredIdentity(config, findings);
  checkNoProductionCredentials(findings);
  await checkExistingDatabase(config, options, findings);

  const blocking = findings.filter((f) => f.severity === "BLOCKING");
  const confirmable = findings.filter((f) => f.severity === "CONFIRMABLE");
  // ADVISORY findings are deliberately absent from both gates. They are printed
  // and nothing more.

  const destroysExistingMirror = confirmable.some((f) =>
    [
      "DATABASE_NOT_EMPTY",
      "FOREIGN_MIRROR",
      "STRESS_DATABASE",
      "EXISTING_DB_UNREADABLE",
      "QUEUE_UNREADABLE",
      "NODE_STATE_UNREADABLE",
      "SCHEMA_UNREADABLE",
    ].includes(f.code)
  );

  return {
    findings,
    mayProceed:
      blocking.length === 0 && (confirmable.length === 0 || options.confirmed),
    destroysExistingMirror,
  };
}
