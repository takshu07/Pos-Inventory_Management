// =============================================================================
// CHANGE CAPTURE
//
// Records every local write to a syncable table into `sync_queue`, using SQLite
// AFTER triggers rather than application code.
//
// ── Why triggers and not a Prisma extension ──────────────────────────────────
// This is the mechanism the whole "never lose a transaction" guarantee rests
// on, so it is worth being explicit about why it lives in the database.
//
//   1. ATOMICITY. A trigger fires inside the same SQLite transaction as the
//      write that fired it. A sale and its queue entry therefore commit
//      together or not at all. An application-level hook cannot promise that:
//      if the process dies between "sale committed" and "queue row written",
//      the sale exists locally, is invisible to the sync engine forever, and
//      nobody finds out until the books do not balance.
//
//   2. IT CANNOT BE BYPASSED. There are 43 services and 26 repositories writing
//      to this database, plus $executeRaw in ten of them. Any capture built on
//      "remember to call recordChange()" is one new code path away from a hole.
//      A trigger sees the raw INSERT/UPDATE/DELETE no matter who issued it.
//
//   3. IT REQUIRES NO CHANGES TO BUSINESS LOGIC, which is the brief.
//
// ── The echo problem, and the lock that solves it ────────────────────────────
// Applying downloaded cloud rows is itself a local write, so it would fire the
// triggers and queue the cloud's own data straight back up. Capture is
// therefore suppressed by `sync_node_state.captureEnabled` during a download.
//
// The dangerous version of that idea is to flip the flag, run an async download
// loop, and flip it back — because any sale rung up in that window would be
// written with capture off and lost forever. This module never does that:
// `withCaptureSuppressed` only runs inside an interactive transaction, so
// SQLite's write lock is held the entire time and no other write can interleave.
// The unit of suppression is one transaction, always.
// =============================================================================

import { logger } from "../../config/logger";
import { getLocalClient, type LocalClient } from "../datasource/localClient";

import manifest from "../../../prisma/local/manifest.json" with { type: "json" };
import { capturedTables, entityForTable } from "./policy";

// =============================================================================
// NAMING
// =============================================================================

const TRIGGER_PREFIX = "sync_capture";

function triggerName(table: string, operation: "insert" | "update" | "delete"): string {
  return `${TRIGGER_PREFIX}_${table}_${operation}`;
}

// =============================================================================
// SQL BUILDING
// =============================================================================

/**
 * Builds a `json_object('col', ref."col", ...)` expression over every column of
 * a table.
 *
 * Column names come from the generated manifest rather than from
 * `pragma_table_info`, so the payload shape is a build-time artifact that can be
 * reviewed in a diff — not something that silently changes when a migration
 * lands.
 */
function rowToJson(table: string, reference: "NEW" | "OLD"): string {
  const model = manifest.models.find((candidate) => candidate.table === table);

  if (model === undefined) {
    throw new Error(`No manifest entry for table "${table}".`);
  }

  const pairs = model.columns
    .map((column) => `'${column.name}', ${reference}."${column.name}"`)
    .join(", ");

  return `json_object(${pairs})`;
}

/**
 * The guard every trigger shares.
 *
 * COALESCE defaults to ENABLED when the state row is missing. The direction
 * matters: defaulting to disabled would mean a fresh database silently records
 * nothing, which is exactly the failure this module exists to prevent. Erring
 * towards capturing too much costs a duplicate the cloud will deduplicate.
 */
const CAPTURE_GUARD =
  "COALESCE((SELECT captureEnabled FROM sync_node_state WHERE id = 'singleton'), 1) = 1";

/**
 * Idempotency key for a queue row.
 *
 * `<deviceId>:<random>` — generated once, at insert, and never regenerated. The
 * cloud stores it and rejects a second arrival, which is what makes a retry of
 * an upload whose RESPONSE was lost (but whose write succeeded) safe.
 *
 * The device prefix matters: without it, two stores that both restore from the
 * same database backup would produce colliding keys, and the cloud would
 * silently discard one store's sales as duplicates.
 */
const IDEMPOTENCY_KEY =
  "COALESCE((SELECT deviceId FROM sync_node_state WHERE id = 'singleton'), 'unregistered') " +
  "|| ':' || lower(hex(randomblob(16)))";

/** SQLite has no now() with milliseconds by default; this matches Prisma's format. */
const LOCAL_TIMESTAMP = "strftime('%Y-%m-%d %H:%M:%f', 'now')";

function buildTrigger(
  table: string,
  entity: string,
  operation: "insert" | "update" | "delete"
): string {
  const primaryKey =
    manifest.models.find((model) => model.table === table)?.primaryKey ?? "id";

  const isDelete = operation === "delete";
  const reference = isDelete ? "OLD" : "NEW";

  const payload = isDelete ? "NULL" : rowToJson(table, "NEW");
  const beforeData =
    operation === "insert" ? "NULL" : rowToJson(table, "OLD");

  const operationLabel = operation.toUpperCase() === "INSERT" ? "CREATE" : operation.toUpperCase();

  return `
CREATE TRIGGER "${triggerName(table, operation)}"
AFTER ${operation.toUpperCase()} ON "${table}"
FOR EACH ROW
WHEN ${CAPTURE_GUARD}
BEGIN
  INSERT INTO sync_queue (
    entity, tableName, entityId, operation,
    payload, beforeData,
    status, attempts, idempotencyKey, localTimestamp
  ) VALUES (
    '${entity}', '${table}', ${reference}."${primaryKey}", '${operationLabel}',
    ${payload}, ${beforeData},
    'PENDING', 0, ${IDEMPOTENCY_KEY}, ${LOCAL_TIMESTAMP}
  );
END;`.trim();
}

/** Every trigger this module owns, for the current policy registry. */
export function buildAllTriggers(): readonly { name: string; sql: string }[] {
  const triggers: { name: string; sql: string }[] = [];

  for (const table of capturedTables()) {
    const policy = entityForTable(table);
    if (policy === undefined) continue;

    for (const operation of ["insert", "update", "delete"] as const) {
      triggers.push({
        name: triggerName(table, operation),
        sql: buildTrigger(table, policy.entity, operation),
      });
    }
  }

  return triggers;
}

// =============================================================================
// INSTALLATION
// =============================================================================

/**
 * Installs (or reinstalls) every change-capture trigger.
 *
 * Idempotent and safe to run at every boot — which it is, because `db push`
 * recreates tables and SQLite drops their triggers with them. A node that
 * booted after a schema refresh without this would run all day capturing
 * nothing.
 */
export async function installChangeCapture(client?: LocalClient): Promise<number> {
  const local = client ?? getLocalClient();

  // Ensure the singleton state row exists before any trigger reads it.
  await ensureNodeState(local);

  const existing = await local.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '${TRIGGER_PREFIX}_%'`
  );

  for (const trigger of existing) {
    await local.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger.name}"`);
  }

  const triggers = buildAllTriggers();

  for (const trigger of triggers) {
    await local.$executeRawUnsafe(trigger.sql);
  }

  logger.info(
    { triggers: triggers.length, tables: capturedTables().length },
    "offline: change-capture triggers installed"
  );

  return triggers.length;
}

/**
 * Verifies the installed triggers match what the current policy expects.
 *
 * Used by the health endpoint and the consistency check: a node running with
 * missing triggers looks perfectly healthy right up until the day's sales turn
 * out never to have been queued.
 */
export async function verifyChangeCapture(
  client?: LocalClient
): Promise<{ expected: number; installed: number; missing: string[] }> {
  const local = client ?? getLocalClient();

  const rows = await local.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '${TRIGGER_PREFIX}_%'`
  );

  const installed = new Set(rows.map((row) => row.name));
  const expected = buildAllTriggers();
  const missing = expected.filter((t) => !installed.has(t.name)).map((t) => t.name);

  return { expected: expected.length, installed: installed.size, missing };
}

// =============================================================================
// NODE STATE
// =============================================================================

async function ensureNodeState(local: LocalClient): Promise<void> {
  const { offlineConfig } = await import("../config");
  const deviceId = offlineConfig().deviceId || "unregistered";

  await local.syncNodeState.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", deviceId, captureEnabled: true },
    // Only the device id is refreshed. `captureEnabled` is deliberately NOT
    // reset here: if a previous process died mid-download with capture off,
    // that is a fault the recovery path must see and repair explicitly rather
    // than have quietly papered over at boot.
    update: { deviceId },
  });
}

// =============================================================================
// SUPPRESSION
// =============================================================================

/**
 * Runs `work` with change capture suppressed, inside a single transaction.
 *
 * The transaction is not an implementation detail — it is the safety mechanism.
 * SQLite holds the write lock for its duration, so no concurrent request can
 * commit an uncaptured write while the flag is off. The flag is restored in the
 * same transaction, so a crash rolls the suppression back rather than leaving
 * the node permanently deaf to its own writes.
 *
 * Use ONLY for applying downloaded cloud data.
 */
export async function withCaptureSuppressed<T>(
  work: (tx: Parameters<Parameters<LocalClient["$transaction"]>[0]>[0]) => Promise<T>,
  client?: LocalClient
): Promise<T> {
  const local = client ?? getLocalClient();

  return local.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      "UPDATE sync_node_state SET captureEnabled = 0 WHERE id = 'singleton'"
    );

    try {
      return await work(tx);
    } finally {
      await tx.$executeRawUnsafe(
        "UPDATE sync_node_state SET captureEnabled = 1 WHERE id = 'singleton'"
      );
    }
  });
}

/**
 * Repairs a node left with capture disabled by an interrupted download.
 *
 * Called during startup recovery. Returns true if it had to fix something,
 * which the caller logs loudly — it means writes may have gone uncaptured, and
 * a consistency check is warranted.
 */
export async function repairCaptureFlag(client?: LocalClient): Promise<boolean> {
  const local = client ?? getLocalClient();

  const rows = await local.$queryRawUnsafe<Array<{ captureEnabled: number }>>(
    "SELECT captureEnabled FROM sync_node_state WHERE id = 'singleton'"
  );

  const enabled = rows[0]?.captureEnabled;
  if (enabled === undefined || Number(enabled) === 1) return false;

  await local.$executeRawUnsafe(
    "UPDATE sync_node_state SET captureEnabled = 1 WHERE id = 'singleton'"
  );

  logger.error(
    "offline: change capture was found DISABLED at startup — a previous " +
      "download was interrupted. Capture has been re-enabled; run a " +
      "consistency check, because writes during that window were not queued."
  );

  return true;
}
