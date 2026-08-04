// =============================================================================
// CONFLICT RESOLUTION
//
// Deterministic, and deliberately NOT last-write-wins.
//
// ── Why not last-write-wins ──────────────────────────────────────────────────
// LWW compares two clocks. One of them is a shop-floor PC whose time is
// whatever it drifted to, or whatever someone set it to when the receipts
// printed with the wrong date. Letting that clock arbitrate whether head
// office's new price survives is not a policy, it is a coin toss — and the
// failure is invisible, because the losing value simply disappears.
//
// So the winner is decided by WHAT the row is, not WHEN it was written:
//
//   Catalog, pricing, settings, identity  → the cloud wins. Head office sets
//                                           these; a till has no authority to
//                                           overrule them.
//   Records of things that happened       → the till wins. The cloud cannot
//                                           have a better opinion about whether
//                                           a customer walked out with a shirt.
//
// The mapping lives in policy.ts. This module applies it and makes sure the
// losing side is never destroyed silently.
//
// ── Every conflict is logged with BOTH versions ──────────────────────────────
// A resolution that discards data without keeping it is indistinguishable from
// a bug. Both payloads are written to the conflict log so a wrong call is
// always recoverable and always explainable — which is what "auditable" has to
// mean here.
// =============================================================================

import type { EntityPolicy } from "./policy";

// =============================================================================
// TYPES
// =============================================================================

export interface ConflictDecision {
  readonly winner: "CLOUD" | "LOCAL";
  readonly reason: string;
  /** True when this is a genuine conflict worth writing to the audit log. */
  readonly logged: boolean;
}

const NO_CONFLICT: ConflictDecision = {
  winner: "CLOUD",
  reason: "no local copy",
  logged: false,
};

// =============================================================================
// DOWNLOAD SIDE  (a cloud row is landing on top of a local one)
// =============================================================================

/**
 * Decides what happens when a downloaded row meets an existing local row.
 *
 * @param existing the local row, or null if this is a fresh insert
 * @param incoming the row the cloud sent
 */
export function resolveDownloadConflict(
  policy: EntityPolicy,
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown>
): ConflictDecision {
  // Nothing to conflict with.
  if (existing === null) return NO_CONFLICT;

  // Identical content is not a conflict, just a re-download. Comparing
  // `updatedAt` alone would flag every row the cloud touched for unrelated
  // reasons, filling the conflict log with noise nobody can triage.
  if (!hasMeaningfulDifference(existing, incoming)) {
    return { winner: "CLOUD", reason: "identical", logged: false };
  }

  if (policy.conflictWinner === "CLOUD") {
    // The local row is overwritten. Logged, because a manager who changed a
    // price on the till this morning deserves to be able to find out where it
    // went.
    return {
      winner: "CLOUD",
      reason:
        `${policy.entity} is cloud-authoritative; the central copy replaced a ` +
        `differing local row`,
      logged: true,
    };
  }

  // A local-authoritative entity arriving in a DOWNLOAD means the cloud is
  // echoing back something this till already owns. Keep the local version.
  return {
    winner: "LOCAL",
    reason:
      `${policy.entity} is local-authoritative; the till's record of what ` +
      `happened is kept and the downloaded copy discarded`,
    logged: true,
  };
}

// =============================================================================
// UPLOAD SIDE  (a till's row is landing on the cloud)
// =============================================================================

export interface UploadConflictContext {
  readonly policy: EntityPolicy;
  readonly cloudRow: Record<string, unknown> | null;
  readonly localRow: Record<string, unknown>;
  readonly operation: "CREATE" | "UPDATE" | "DELETE";
}

/**
 * Decides what the cloud does with an uploaded row that already exists
 * centrally.
 */
export function resolveUploadConflict(context: UploadConflictContext): ConflictDecision {
  const { policy, cloudRow, localRow, operation } = context;

  if (cloudRow === null) {
    // ── An UPDATE or DELETE for a row the cloud has never seen ──────────────
    // Not an error. It happens routinely: the CREATE is sitting later in the
    // same batch, or an earlier batch's response was lost. For an append-only
    // event entity the right move is to insert it — refusing would discard a
    // real sale because its paperwork arrived out of order.
    return {
      winner: "LOCAL",
      reason:
        operation === "DELETE"
          ? "row absent centrally; delete is a no-op"
          : "row absent centrally; inserted from the till's payload",
      logged: false,
    };
  }

  if (policy.conflictWinner === "LOCAL") {
    return {
      winner: "LOCAL",
      reason: `${policy.entity} records an event at the till; the till is authoritative`,
      logged: false,
    };
  }

  // ── Cloud-authoritative entity, changed on both sides ─────────────────────
  // The classic case is a Customer: head office merged two duplicate records
  // while the shop edited a phone number. The cloud's version stands, and the
  // till's payload is archived rather than dropped.
  if (!hasMeaningfulDifference(cloudRow, localRow)) {
    return { winner: "CLOUD", reason: "identical", logged: false };
  }

  return {
    winner: "CLOUD",
    reason:
      `${policy.entity} is cloud-authoritative; the central copy stands and the ` +
      `uploaded payload is archived in the conflict log`,
    logged: true,
  };
}

// =============================================================================
// COMPARISON
// =============================================================================

/**
 * Columns excluded from the "did anything really change?" test.
 *
 * `updatedAt` moves whenever anything touches a row, including operations that
 * changed nothing a human would notice. Including it would make every
 * re-download look like a conflict.
 */
const IGNORED_COLUMNS = new Set(["updatedAt", "createdAt"]);

function normalize(value: unknown): string {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) return value.toISOString();

  // Prisma Decimal and other objects with a meaningful toString. Comparing
  // 12.50 to "12.5" as raw values would report a difference that does not
  // exist; both normalize through the same path.
  if (typeof value === "object") {
    const asRecord = value as { toString?: () => string };
    if (typeof asRecord.toString === "function" && asRecord.toString !== Object.prototype.toString) {
      return asRecord.toString();
    }
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    // 12.50 from Postgres and 12.5 from SQLite are the same money.
    return String(Number(value));
  }

  return String(value);
}

/**
 * True when the two rows differ in a column that matters.
 *
 * Only columns present in BOTH rows are compared. A partial projection (a
 * `select` that fetched three columns) must not be read as "every other column
 * was deleted".
 */
export function hasMeaningfulDifference(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean {
  for (const key of Object.keys(right)) {
    if (IGNORED_COLUMNS.has(key)) continue;
    if (!(key in left)) continue;

    if (normalize(left[key]) !== normalize(right[key])) return true;
  }

  return false;
}

/** Field-level diff, for the conflict log. Answers "what actually differed?" */
export function describeDifferences(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): Record<string, { local: string; cloud: string }> {
  const differences: Record<string, { local: string; cloud: string }> = {};

  for (const key of Object.keys(right)) {
    if (IGNORED_COLUMNS.has(key)) continue;
    if (!(key in left)) continue;

    const localValue = normalize(left[key]);
    const cloudValue = normalize(right[key]);

    if (localValue !== cloudValue) {
      differences[key] = { local: localValue, cloud: cloudValue };
    }
  }

  return differences;
}
