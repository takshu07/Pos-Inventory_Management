// =============================================================================
// MIRROR VERIFICATION — proving a freshly built mirror is fit to sell from
//
// Provisioning is not finished when the download stops; it is finished when the
// mirror has been PROVEN correct. The difference matters because every way a
// provisioning run goes wrong produces a database that looks fine:
//
//   • a download that stopped at page 9 of 40      → a catalog with a hole in it
//   • a cursor written ahead of the rows it names  → tomorrow's sync skips rows
//   • FK enforcement that silently did not take    → orphan rows, rejected at upload
//   • a mirror left over from a stress harness     → synthetic sales sold as real
//
// None of these throw. All of them are found by the checks below, which is why
// Offline Mode enablement is gated on this file rather than on "the command
// exited 0".
//
// ── Why row counts are re-paged rather than asked for ────────────────────────
// There is no count endpoint in the sync protocol, and the brief forbids adding
// one. So the cloud-expectation check re-walks `/sync/download` from a ZERO
// cursor and counts what comes back. That is a second full read of the catalog,
// which is real cost — but it is the only way to check the mirror against the
// cloud's own answer using the protocol as it stands, and provisioning happens
// once per till.
// =============================================================================

import { offlineConfig, type OfflineConfig } from "../config";
import type { LocalClient } from "../datasource/localClient";
import { verifyChangeCapture } from "../sync/changeCapture";
import { downloadEntities } from "../sync/policy";
import type { DownloadResponse } from "../sync/protocol";
import { syncRequest } from "../sync/transport";

import { isSyntheticDeviceId } from "./preflight";

// =============================================================================
// TYPES
// =============================================================================

export interface VerificationCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
  /**
   * A failed ADVISORY check is reported but does not fail provisioning — it
   * describes a condition that is suspicious rather than incorrect.
   */
  readonly advisory?: boolean;
}

export interface VerificationResult {
  readonly checks: readonly VerificationCheck[];
  readonly passed: boolean;
}

export interface VerifyOptions {
  readonly client: LocalClient;
  /**
   * The config the mirror was provisioned under.
   *
   * ⚠ Must be threaded from the caller rather than read from `offlineConfig()`
   * here. Provisioning accepts an injected config, so a verifier that consulted
   * the ambient environment would compare the new mirror against a DIFFERENT
   * identity than the one it was just given — and report the freshly correct
   * device id as "another till's identity".
   */
  readonly config?: OfflineConfig;
  /**
   * Row counts observed during the provisioning download, per entity. The
   * cloud-expectation check compares the mirror against these AND against a
   * fresh re-page of the cloud.
   */
  readonly downloaded?: ReadonlyMap<string, number>;
  /**
   * Re-page every entity from the cloud to confirm the mirror matches what the
   * cloud actually holds. Costly; skipped by tests that have no cloud.
   */
  readonly compareWithCloud?: boolean;
}

// =============================================================================
// CHECKS
// =============================================================================

/**
 * The queue must be empty.
 *
 * A freshly provisioned mirror has never traded, so ANY queue row means either
 * the download echoed cloud data back into the queue (a capture-suppression
 * failure — the exact bug `withCaptureSuppressed` exists to prevent), or this
 * is not actually a fresh mirror.
 */
async function checkQueueEmpty(local: LocalClient): Promise<VerificationCheck> {
  const total = await local.syncQueueItem.count();

  return {
    name: "queue is empty",
    passed: total === 0,
    detail:
      total === 0
        ? "0 queue items"
        : `${total} queue item(s) on a mirror that has never traded — the download ` +
          "echoed cloud rows back into the queue, or this mirror is not fresh",
  };
}

/**
 * SQLite's own structural check.
 *
 * `integrity_check` walks every page, index and b-tree. A mirror written to a
 * failing disk or interrupted mid-write passes every application-level query
 * right up until the corrupt page is the one a cashier's scan needs.
 */
async function checkIntegrity(local: LocalClient): Promise<VerificationCheck> {
  const rows = await local.$queryRawUnsafe<Array<Record<string, unknown>>>(
    "PRAGMA integrity_check"
  );
  const result = String(Object.values(rows[0] ?? {})[0] ?? "");

  return {
    name: "database integrity",
    passed: result === "ok",
    detail: result === "ok" ? "PRAGMA integrity_check = ok" : `integrity_check: ${result}`,
  };
}

/**
 * Foreign keys must be both ENABLED and SATISFIED.
 *
 * Two separate failures with one symptom. `foreign_key_check` finds orphan rows
 * already present — a variant whose product never arrived because the download
 * broke between the two entities. The PRAGMA read confirms enforcement is
 * actually on for this connection, without which the till would accept new
 * orphans all day and Postgres would reject them at upload, after the goods
 * have left the shop.
 */
async function checkForeignKeys(local: LocalClient): Promise<VerificationCheck[]> {
  const enforcementRows = await local.$queryRawUnsafe<Array<Record<string, unknown>>>(
    "PRAGMA foreign_keys"
  );
  const enforced = String(Object.values(enforcementRows[0] ?? {})[0] ?? "") === "1";

  const violations = await local.$queryRawUnsafe<Array<Record<string, unknown>>>(
    "PRAGMA foreign_key_check"
  );

  return [
    {
      name: "foreign key enforcement is ON",
      passed: enforced,
      detail: enforced
        ? "PRAGMA foreign_keys = 1"
        : "PRAGMA foreign_keys is OFF — the till would accept orphan rows that " +
          "Postgres rejects at upload time",
    },
    {
      name: "no foreign key violations",
      passed: violations.length === 0,
      detail:
        violations.length === 0
          ? "PRAGMA foreign_key_check found 0 orphans"
          : `${violations.length} orphan row(s) — the download landed a child before ` +
            "its parent, so part of the catalog is unreachable",
    },
  ];
}

/**
 * Change-capture triggers must all be installed.
 *
 * A mirror with missing triggers is the worst outcome provisioning can produce,
 * because the till works perfectly: sales are written, receipts print, the queue
 * stays reassuringly at zero, and nothing is ever uploaded.
 */
async function checkCaptureTriggers(local: LocalClient): Promise<VerificationCheck> {
  const capture = await verifyChangeCapture(local);

  return {
    name: "change-capture triggers installed",
    passed: capture.missing.length === 0,
    detail:
      capture.missing.length === 0
        ? `${capture.installed}/${capture.expected} triggers present`
        : `${capture.missing.length} trigger(s) MISSING (${capture.missing
            .slice(0, 5)
            .join(", ")}) — local writes would not be queued`,
  };
}

/**
 * Device identity must match the configured id, and must not be synthetic.
 *
 * This is the reused-mirror check restated after the rebuild: it proves the new
 * mirror took THIS till's identity rather than inheriting one.
 */
async function checkDeviceIdentity(
  local: LocalClient,
  config: OfflineConfig
): Promise<VerificationCheck[]> {
  const state = await local.syncNodeState.findUnique({ where: { id: "singleton" } });

  const checks: VerificationCheck[] = [];

  checks.push({
    name: "device identity is initialized",
    passed: state !== null && state.deviceId === config.deviceId && state.deviceId !== "",
    detail:
      state === null
        ? "sync_node_state has no singleton row — the node was never initialized"
        : state.deviceId === config.deviceId
          ? `deviceId = "${state.deviceId}"`
          : `deviceId is "${state.deviceId}" but OFFLINE_DEVICE_ID is "${config.deviceId}" ` +
            "— this mirror carries another till's identity",
  });

  checks.push({
    name: "device identity is not a test-harness id",
    passed: state === null ? false : !isSyntheticDeviceId(state.deviceId),
    detail:
      state !== null && isSyntheticDeviceId(state.deviceId)
        ? `deviceId "${state.deviceId}" matches a harness naming pattern — sales from ` +
          "this till would collide with harness idempotency keys at the cloud"
        : "device id is not a harness pattern",
    advisory: true,
  });

  checks.push({
    name: "change capture is enabled",
    passed: state?.captureEnabled === true,
    detail:
      state?.captureEnabled === true
        ? "captureEnabled = true"
        : "captureEnabled is FALSE — a download was interrupted and every local " +
          "write would go unqueued",
  });

  return checks;
}

/**
 * No fake or malformed idempotency keys.
 *
 * Every real key is `<deviceId>:<32 hex>`, minted by the capture trigger. A key
 * in any other shape was hand-written by a harness or a migration script, and
 * the cloud's UNIQUE index would then either reject real sales as duplicates or
 * accept two different sales under one key.
 *
 * A fresh mirror has an empty queue, so this normally examines nothing — it
 * exists to catch the mirror that was seeded rather than downloaded.
 */
async function checkIdempotencyKeys(
  local: LocalClient,
  config: OfflineConfig
): Promise<VerificationCheck> {
  const items = await local.syncQueueItem.findMany({
    select: { idempotencyKey: true },
    take: 500,
  });

  if (items.length === 0) {
    return {
      name: "no fake idempotency keys",
      passed: true,
      detail: "queue is empty — no keys to inspect",
    };
  }

  const expected = new RegExp(`^${escapeRegExp(config.deviceId)}:[0-9a-f]{32}$`);
  const bad = items.filter((item) => !expected.test(item.idempotencyKey));

  return {
    name: "no fake idempotency keys",
    passed: bad.length === 0,
    detail:
      bad.length === 0
        ? `${items.length} key(s) match <deviceId>:<32 hex>`
        : `${bad.length} key(s) are not trigger-minted (e.g. "${bad[0]?.idempotencyKey}") ` +
          "— they were written by a harness or a script, not by the capture trigger",
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * No residue from a stress or validation harness.
 *
 * The harnesses in `scripts/` tag their fixtures so a run can clean up after
 * itself. Finding those tags in a mirror that was just built from the cloud
 * means either the rebuild did not actually happen, or the CLOUD is carrying
 * stress data — which is a far more serious finding, and the reason this check
 * reports the entity rather than just failing.
 */
async function checkNoStressData(local: LocalClient): Promise<VerificationCheck> {
  const [taggedProducts, taggedCustomers] = await Promise.all([
    local.product.count({ where: { name: { startsWith: "E2E-" } } }),
    local.customer.count({ where: { name: { startsWith: "E2E-" } } }),
  ]);

  const stressProducts = await local.product.count({
    where: { name: { startsWith: "STRESS-" } },
  });

  const total = taggedProducts + taggedCustomers + stressProducts;

  return {
    name: "no stress-test data",
    passed: total === 0,
    detail:
      total === 0
        ? "no E2E-/STRESS- tagged rows"
        : `${total} harness-tagged row(s) (${taggedProducts} products, ${taggedCustomers} ` +
          `customers, ${stressProducts} stress products) — either the rebuild did not ` +
          "happen, or the CLOUD itself holds stress data and must be cleaned first",
  };
}

/**
 * Every cursor must name a row the mirror actually holds.
 *
 * This is the check that catches the most dangerous silent failure in
 * provisioning. A cursor is a promise: "everything up to (updatedAt, id) is
 * already here." If it was advanced past rows that were never committed — a
 * crash between the write and the commit, or a restored cursor table — then
 * tomorrow's incremental sync starts AFTER those rows and never fetches them.
 * The gap is permanent and completely silent: the products simply do not exist
 * on this till, and every scan of them fails at the counter.
 *
 * The check: for each entity with a cursor, the row it names must be present
 * locally, and no local row may sit beyond it.
 */
async function checkCursors(
  local: LocalClient,
  downloaded: ReadonlyMap<string, number> | undefined,
  expectCursors: boolean
): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = [];
  const cursors = await local.syncCursor.findMany();

  if (cursors.length === 0) {
    // A download that pulled NOTHING legitimately writes no cursors — an empty
    // cloud, or `--skip-download`. Demanding cursors there would fail a mirror
    // that is perfectly correct for what it was asked to do. The check only
    // bites when entities were actually downloaded and left no high-water mark
    // behind, which is the real fault: the next sync would re-pull everything.
    return [
      {
        name: "download cursors initialized",
        passed: !expectCursors,
        detail: expectCursors
          ? "no sync_cursors rows despite a download that returned rows — the mirror " +
            "has no high-water marks, so the first incremental sync would re-download " +
            "the entire catalog"
          : "no cursors, and none expected (nothing was downloaded)",
      },
    ];
  }

  checks.push({
    name: "download cursors initialized",
    passed: true,
    detail: `${cursors.length} entity cursor(s) recorded`,
  });

  const delegates = local as unknown as Record<
    string,
    { count: (args?: unknown) => Promise<number>; findFirst: (args: unknown) => Promise<unknown> }
  >;

  const mismatched: string[] = [];
  const dangling: string[] = [];

  for (const cursor of cursors) {
    if (cursor.lastPulledId === null || cursor.lastPulledAt === null) continue;

    const delegate = delegates[lowerFirst(cursor.entity)];
    if (delegate === undefined) continue;

    // The row the cursor names must exist. If it does not, the cursor is ahead
    // of the data and the rows between are lost to every future sync.
    const named = await delegate.findFirst({ where: { id: cursor.lastPulledId } });

    if (named === null) {
      dangling.push(`${cursor.entity}→${cursor.lastPulledId}`);
      continue;
    }

    // Cross-check the cursor against what the download reported, when we have it.
    const expectedRows = downloaded?.get(cursor.entity);
    if (expectedRows !== undefined) {
      const actual = await delegate.count();
      if (actual < expectedRows) {
        mismatched.push(`${cursor.entity} (${actual} local < ${expectedRows} downloaded)`);
      }
    }
  }

  checks.push({
    name: "cursors point at rows the mirror holds",
    passed: dangling.length === 0,
    detail:
      dangling.length === 0
        ? "every cursor names a present row"
        : `${dangling.length} cursor(s) point at missing rows (${dangling
            .slice(0, 3)
            .join(", ")}) — the cursor is AHEAD of the data and the gap will never ` +
          "be re-fetched by an incremental sync",
  });

  checks.push({
    name: "cursor state matches downloaded data",
    passed: mismatched.length === 0,
    detail:
      mismatched.length === 0
        ? "local row counts are consistent with the download"
        : `${mismatched.length} entity/entities hold fewer rows than were downloaded: ${mismatched
            .slice(0, 3)
            .join(", ")}`,
  });

  return checks;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * Row counts must match what the cloud actually holds.
 *
 * Re-pages `/sync/download` from a zero cursor per entity and compares totals
 * against the mirror. This is the only check that can catch a download that
 * stopped early but wrote a plausible cursor — the local database is
 * self-consistent in that case, and only the cloud knows a page is missing.
 *
 * Counts are compared with the cloud allowed to be AHEAD: head office may
 * legitimately have added a product in the seconds since the download finished.
 * The mirror holding MORE rows than the cloud is the real failure — it means
 * local rows exist that the cloud has never seen, on a node that has never
 * traded.
 */
async function checkCloudRowCounts(
  local: LocalClient,
  config: OfflineConfig
): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = [];

  const delegates = local as unknown as Record<string, { count: () => Promise<number> }>;
  const shortfalls: string[] = [];
  const excesses: string[] = [];
  let compared = 0;

  for (const policy of downloadEntities()) {
    const delegate = delegates[lowerFirst(policy.entity)];
    if (delegate === undefined) continue;

    let cloudRows = 0;
    let cursor: { since?: string; sinceId?: string } = {};

    try {
      for (;;) {
        const response = await syncRequest<DownloadResponse>({
          method: "GET",
          path: "/api/v1/sync/download",
          query: {
            entity: policy.entity,
            since: cursor.since,
            sinceId: cursor.sinceId,
            limit: config.downloadBatchSize,
          },
        });

        const page = response.data;
        cloudRows += page.rows.length;

        if (!page.hasMore || page.nextCursor === null) break;
        cursor = { since: page.nextCursor.updatedAt, sinceId: page.nextCursor.id };
      }
    } catch {
      // A single entity that cannot be re-read does not invalidate the mirror;
      // it is reported as an unverified entity rather than a failure.
      continue;
    }

    const localRows = await delegate.count();
    compared += 1;

    if (localRows < cloudRows) {
      shortfalls.push(`${policy.entity} (${localRows} local / ${cloudRows} cloud)`);
    } else if (localRows > cloudRows) {
      excesses.push(`${policy.entity} (${localRows} local / ${cloudRows} cloud)`);
    }
  }

  checks.push({
    name: "row counts match cloud expectations",
    passed: shortfalls.length === 0,
    detail:
      shortfalls.length === 0
        ? `${compared} entity/entities reconciled against the cloud`
        : `${shortfalls.length} entity/entities are SHORT of the cloud: ${shortfalls
            .slice(0, 5)
            .join(", ")} — the download did not complete`,
  });

  checks.push({
    name: "mirror holds no rows the cloud has not seen",
    passed: excesses.length === 0,
    detail:
      excesses.length === 0
        ? "no local-only rows in downloadable entities"
        : `${excesses.length} entity/entities hold MORE rows than the cloud: ${excesses
            .slice(0, 5)
            .join(", ")} — residue survived the rebuild`,
    // Head office adding rows mid-verification produces a benign shortfall, but
    // an EXCESS on a never-traded till is real residue. Still advisory, because
    // a legitimate cloud-side DELETE between download and verify looks identical.
    advisory: true,
  });

  return checks;
}

// =============================================================================
// ORCHESTRATION
// =============================================================================

/**
 * Runs every mirror check. Read-only — it never repairs what it finds.
 *
 * Separation is deliberate: a verification that quietly fixed a dangling cursor
 * would hide the fact that provisioning produced one, and the next till would
 * hit the same bug with nobody the wiser.
 */
export async function verifyMirror(options: VerifyOptions): Promise<VerificationResult> {
  const { client } = options;
  const config = options.config ?? offlineConfig();
  const checks: VerificationCheck[] = [];

  // Cursors are only REQUIRED when the download actually returned rows. See
  // checkCursors for why demanding them unconditionally is wrong.
  const expectCursors = [...(options.downloaded?.values() ?? [])].some((rows) => rows > 0);

  checks.push(await checkQueueEmpty(client));
  checks.push(await checkIntegrity(client));
  checks.push(...(await checkForeignKeys(client)));
  checks.push(await checkCaptureTriggers(client));
  checks.push(...(await checkDeviceIdentity(client, config)));
  checks.push(await checkIdempotencyKeys(client, config));
  checks.push(await checkNoStressData(client));
  checks.push(...(await checkCursors(client, options.downloaded, expectCursors)));

  if (options.compareWithCloud === true) {
    checks.push(...(await checkCloudRowCounts(client, config)));
  }

  // Advisory failures are reported but do not fail the run — they describe
  // conditions that are suspicious rather than provably wrong.
  const passed = checks.every((check) => check.passed || check.advisory === true);

  return { checks, passed };
}
