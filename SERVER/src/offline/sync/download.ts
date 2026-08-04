// =============================================================================
// DOWNLOAD — pulling master data from the cloud ("morning sync")
//
// Walks every DOWN/BIDIRECTIONAL entity in dependency order and writes what it
// gets into the local mirror.
//
// ── Incremental by keyset, not by offset ─────────────────────────────────────
// Pages are cut on `(updatedAt, id)` rather than LIMIT/OFFSET. Offset paging
// over a table that is being written to skips rows: insert a product between
// page 3 and page 4 and everything shifts, so one existing product is never
// returned. A skipped product is a barcode that does not scan at the till.
// The composite cursor is stable under concurrent writes, and the `id` half is
// what makes it correct when many rows share a timestamp — which they do, in
// bulk imports, by the thousand.
//
// ── Cursors are per-entity ───────────────────────────────────────────────────
// One global "last synced at" would mean a Customers pull that failed on page 9
// forces Products to be re-downloaded from scratch tomorrow. Each entity keeps
// its own high-water mark and resumes exactly where it stopped.
//
// ── Applying, without echoing ────────────────────────────────────────────────
// Writes land through `withCaptureSuppressed`, so the cloud's own rows are not
// captured and shipped straight back up. That suppression is transaction-scoped
// — see changeCapture.ts for why anything wider would silently drop sales.
// =============================================================================

import { logger } from "../../config/logger";
import { offlineConfig } from "../config";
import { getLocalClient, type LocalClient } from "../datasource/localClient";

import { withCaptureSuppressed } from "./changeCapture";
import { resolveDownloadConflict } from "./conflicts";
import { downloadEntities, type EntityPolicy } from "./policy";
import type { DownloadResponse } from "./protocol";
import { recordEvent } from "./runLog";
import { logTransportFailure, syncRequest, SyncTransportError } from "./transport";

// =============================================================================
// TYPES
// =============================================================================

export interface EntityDownloadResult {
  readonly entity: string;
  readonly rows: number;
  readonly conflicts: number;
  readonly pages: number;
  readonly error?: string;
}

export interface DownloadOutcome {
  readonly entities: readonly EntityDownloadResult[];
  readonly totalRows: number;
  readonly totalConflicts: number;
  readonly bytesReceived: number;
  readonly failedEntities: readonly string[];
}

// =============================================================================
// CURSORS
// =============================================================================

async function readCursor(
  local: LocalClient,
  entity: string
): Promise<{ since?: string; sinceId?: string }> {
  const cursor = await local.syncCursor.findUnique({ where: { entity } });

  if (cursor?.lastPulledAt == null) return {};

  return {
    since: cursor.lastPulledAt.toISOString(),
    ...(cursor.lastPulledId === null ? {} : { sinceId: cursor.lastPulledId }),
  };
}

async function writeCursor(
  local: LocalClient,
  entity: string,
  cursor: { updatedAt: string; id: string } | null,
  rowsPulled: number
): Promise<void> {
  if (cursor === null) {
    await local.syncCursor.upsert({
      where: { entity },
      create: { entity, lastSuccessAt: new Date(), rowsPulled },
      update: { lastSuccessAt: new Date(), rowsPulled: { increment: rowsPulled } },
    });
    return;
  }

  await local.syncCursor.upsert({
    where: { entity },
    create: {
      entity,
      lastPulledAt: new Date(cursor.updatedAt),
      lastPulledId: cursor.id,
      lastSuccessAt: new Date(),
      rowsPulled,
    },
    update: {
      lastPulledAt: new Date(cursor.updatedAt),
      lastPulledId: cursor.id,
      lastSuccessAt: new Date(),
      rowsPulled: { increment: rowsPulled },
    },
  });
}

// =============================================================================
// APPLYING ROWS
// =============================================================================

/**
 * Coerces one cloud row into what the local Prisma client expects.
 *
 * JSON has no date type, so every DateTime arrives as an ISO string and Prisma
 * would reject it. The manifest says which columns are dates, so the conversion
 * is driven by the schema rather than by guessing at field names ending in
 * "At" — `season` and `pattern` are strings, `saleDate` is not.
 */
function coerceRow(
  row: Record<string, unknown>,
  policy: EntityPolicy,
  columnTypes: ReadonlyMap<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    const type = columnTypes.get(key);

    if (value === null || value === undefined) {
      result[key] = null;
      continue;
    }

    if (type === "DateTime" && typeof value === "string") {
      result[key] = new Date(value);
      continue;
    }

    // Postgres arrays arrive as real arrays; the scalar-list bridge on the
    // local client re-encodes them to JSON text on write, so they pass through
    // untouched here.
    result[key] = value;
  }

  // Defensive: a row without its primary key cannot be addressed.
  if (result[policy.primaryKey] === undefined) {
    throw new Error(`Downloaded ${policy.entity} row is missing its ${policy.primaryKey}`);
  }

  return result;
}

/**
 * Writes one page into the local mirror.
 *
 * The whole page is one transaction, so a page either lands completely or not
 * at all — and the cursor is only advanced after it commits, so an interrupted
 * download re-fetches that page rather than skipping it.
 */
async function applyPage(
  local: LocalClient,
  policy: EntityPolicy,
  rows: ReadonlyArray<Record<string, unknown>>,
  columnTypes: ReadonlyMap<string, string>,
  runId: string
): Promise<number> {
  let conflicts = 0;

  await withCaptureSuppressed(async (tx) => {
    const delegate = (tx as unknown as Record<string, {
      findUnique: (args: unknown) => Promise<unknown>;
      upsert: (args: unknown) => Promise<unknown>;
    }>)[lowerFirst(policy.entity)];

    if (delegate === undefined) {
      throw new Error(`No Prisma delegate for entity "${policy.entity}"`);
    }

    for (const raw of rows) {
      const row = coerceRow(raw, policy, columnTypes);
      const id = row[policy.primaryKey] as string;

      const existing = (await delegate.findUnique({
        where: { [policy.primaryKey]: id },
      })) as Record<string, unknown> | null;

      const decision = resolveDownloadConflict(policy, existing, row);

      if (decision.winner === "LOCAL") {
        conflicts += 1;
        await recordConflict(local, runId, policy, id, existing, row, decision.reason);
        continue;
      }

      await delegate.upsert({
        where: { [policy.primaryKey]: id },
        create: row,
        update: row,
      });

      if (decision.logged) {
        conflicts += 1;
        await recordConflict(local, runId, policy, id, existing, row, decision.reason);
      }
    }
  }, local);

  return conflicts;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

async function recordConflict(
  local: LocalClient,
  runId: string,
  policy: EntityPolicy,
  entityId: string,
  localData: unknown,
  cloudData: unknown,
  reason: string
): Promise<void> {
  const { randomUUID } = await import("node:crypto");

  await local.syncConflict.create({
    data: {
      id: randomUUID(),
      runId,
      entity: policy.entity,
      entityId,
      resolution: policy.conflictWinner === "CLOUD" ? "CLOUD_WINS" : "LOCAL_WINS",
      reason,
      localData: localData === null ? null : JSON.stringify(localData),
      cloudData: JSON.stringify(cloudData),
    },
  });

  await recordEvent(runId, "CONFLICT", `${policy.entity} ${entityId}: ${reason}`, {
    level: "WARN",
    entity: policy.entity,
    client: local,
  });
}

// =============================================================================
// ENTITY PULL
// =============================================================================

async function downloadEntity(
  local: LocalClient,
  policy: EntityPolicy,
  columnTypes: ReadonlyMap<string, string>,
  runId: string
): Promise<{ result: EntityDownloadResult; bytes: number }> {
  const config = offlineConfig();

  let cursor = await readCursor(local, policy.entity);
  let rows = 0;
  let conflicts = 0;
  let pages = 0;
  let bytes = 0;

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

    bytes += response.bytesReceived;
    pages += 1;

    const page = response.data;

    if (page.rows.length > 0) {
      conflicts += await applyPage(local, policy, page.rows, columnTypes, runId);
      rows += page.rows.length;

      // The cursor advances only after the page has COMMITTED. Advancing it
      // first would mean a crash between fetch and write silently skips a page
      // — and a skipped page of products is a shelf of items that will not scan.
      await writeCursor(local, policy.entity, page.nextCursor, page.rows.length);
    } else {
      await writeCursor(local, policy.entity, page.nextCursor, 0);
    }

    if (!page.hasMore || page.nextCursor === null) break;

    cursor = { since: page.nextCursor.updatedAt, sinceId: page.nextCursor.id };
  }

  return { result: { entity: policy.entity, rows, conflicts, pages }, bytes };
}

// =============================================================================
// ORCHESTRATION
// =============================================================================

export async function downloadMasterData(
  runId: string,
  options: { client?: LocalClient; entities?: string[] } = {}
): Promise<DownloadOutcome> {
  const local = options.client ?? getLocalClient();

  const manifest = (await import("../../../prisma/local/manifest.json", { with: { type: "json" } }))
    .default;

  const targets = downloadEntities().filter(
    (policy) => options.entities === undefined || options.entities.includes(policy.entity)
  );

  const results: EntityDownloadResult[] = [];
  const failed: string[] = [];
  let totalRows = 0;
  let totalConflicts = 0;
  let bytesReceived = 0;

  for (const policy of targets) {
    const model = manifest.models.find((candidate) => candidate.name === policy.entity);
    const columnTypes = new Map(
      (model?.columns ?? []).map((column) => [column.name, column.type])
    );

    try {
      const { result, bytes } = await downloadEntity(local, policy, columnTypes, runId);

      results.push(result);
      totalRows += result.rows;
      totalConflicts += result.conflicts;
      bytesReceived += bytes;

      logger.info(
        { entity: policy.entity, rows: result.rows, pages: result.pages },
        "offline: downloaded entity"
      );
    } catch (error) {
      // ── One entity's failure must not abort the rest ─────────────────────
      // If Customers times out, Products and Prices should still land: a till
      // with a current catalog and a stale customer list can trade, while a
      // till with nothing cannot. The failure is recorded and the cursor is
      // left where it was, so tomorrow resumes rather than restarts.
      logTransportFailure(`download ${policy.entity}`, error);

      const message = error instanceof Error ? error.message : String(error);
      results.push({ entity: policy.entity, rows: 0, conflicts: 0, pages: 0, error: message });
      failed.push(policy.entity);

      await recordEvent(runId, "ITEM_FAILED", `Download failed for ${policy.entity}`, {
        level: "ERROR",
        entity: policy.entity,
        detail: { message },
        client: local,
      });

      if (error instanceof SyncTransportError && !error.retryable) {
        // Bad credentials or a protocol mismatch will fail identically for
        // every remaining entity. Stop rather than generate 15 identical errors.
        break;
      }
    }
  }

  await local.syncNodeState.updateMany({
    where: { id: "singleton" },
    data: { lastDownloadAt: new Date() },
  });

  return {
    entities: results,
    totalRows,
    totalConflicts,
    bytesReceived,
    failedEntities: failed,
  };
}

/**
 * True when the local mirror has never been populated.
 *
 * Used at startup to decide whether this node can open for business: a till
 * with no products cannot sell anything, so an empty mirror plus no
 * connectivity is a situation an operator must be told about explicitly rather
 * than discover at the first scan.
 */
export async function isMirrorEmpty(client?: LocalClient): Promise<boolean> {
  const local = client ?? getLocalClient();
  const products = await local.product.count();
  return products === 0;
}
