// =============================================================================
// CLOUD SERVE — answering an edge node's download request
//
// Runs on the CLOUD node. Streams master data out in keyset-paginated pages.
//
// ── Keyset, not offset ───────────────────────────────────────────────────────
// Pages are cut on `(updatedAt, id) > (cursor.updatedAt, cursor.id)`.
//
// With LIMIT/OFFSET, any row inserted or updated between page N and page N+1
// shifts the window and one row is never returned. That is not a theoretical
// concern here: the catalog is edited during the day, and a product that
// silently fails to download is a barcode that does not scan at the till.
//
// The `id` half of the cursor is what makes it correct when rows share a
// timestamp — which they do in bulk, after any import or price update, because
// they were all written in the same transaction with the same `now()`.
// =============================================================================

import { getCloudClient } from "../../config/prisma";

import { policyFor, type EntityPolicy } from "./policy";
import type { DownloadResponse } from "./protocol";
import { SYNC_PROTOCOL_VERSION } from "./protocol";

// =============================================================================
// LIMITS
// =============================================================================

/**
 * Hard ceiling on page size, regardless of what the caller asks for.
 *
 * Without it a device could request a million rows and hold a Neon connection
 * (and a serialized JSON body of that size in memory) while every cashier's
 * request queues behind it.
 */
const MAX_PAGE_SIZE = 2000;
const DEFAULT_PAGE_SIZE = 500;

export class UnknownSyncEntityError extends Error {
  constructor(entity: string) {
    super(`Unknown or non-downloadable sync entity "${entity}"`);
    this.name = "UnknownSyncEntityError";
  }
}

// =============================================================================
// QUERY
// =============================================================================

function assertDownloadable(entity: string): EntityPolicy {
  const policy = policyFor(entity);

  if (
    policy === undefined ||
    (policy.direction !== "DOWN" && policy.direction !== "BIDIRECTIONAL")
  ) {
    // Refusing unknown entities by name is also an access control: without it,
    // a device could name any table in the database and read it wholesale —
    // including `employees`, password hashes and all.
    throw new UnknownSyncEntityError(entity);
  }

  return policy;
}

export async function serveDownload(params: {
  entity: string;
  since?: string | undefined;
  sinceId?: string | undefined;
  limit?: number | undefined;
  deviceId: string;
}): Promise<DownloadResponse> {
  const policy = assertDownloadable(params.entity);
  const prisma = getCloudClient();

  const take = Math.min(
    Math.max(1, params.limit ?? DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE
  );

  const delegate = (prisma as unknown as Record<string, {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  }>)[lowerFirst(policy.entity)];

  if (delegate === undefined) {
    throw new UnknownSyncEntityError(params.entity);
  }

  const since = params.since === undefined ? undefined : new Date(params.since);

  // ── The keyset predicate ──────────────────────────────────────────────────
  //   updatedAt > cursor.updatedAt
  //   OR (updatedAt = cursor.updatedAt AND id > cursor.id)
  //
  // The second arm is the part that matters: it walks THROUGH a block of rows
  // sharing a timestamp instead of either re-sending them forever or skipping
  // past the whole block.
  const where =
    since === undefined
      ? {}
      : params.sinceId === undefined
        ? { updatedAt: { gt: since } }
        : {
            OR: [
              { updatedAt: { gt: since } },
              {
                AND: [
                  { updatedAt: { equals: since } },
                  { [policy.primaryKey]: { gt: params.sinceId } },
                ],
              },
            ],
          };

  // One extra row is fetched purely to answer `hasMore` without a second
  // COUNT query over a table that may have hundreds of thousands of rows.
  const rows = await delegate.findMany({
    where,
    orderBy: [{ updatedAt: "asc" }, { [policy.primaryKey]: "asc" }],
    take: take + 1,
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  const last = page.at(-1);
  const nextCursor =
    last === undefined
      ? null
      : {
          updatedAt: toIso(last["updatedAt"]),
          id: String(last[policy.primaryKey]),
        };

  await prisma.syncDevice.upsert({
    where: { deviceId: params.deviceId },
    create: { deviceId: params.deviceId, lastSeenAt: new Date(), lastDownloadAt: new Date() },
    update: { lastSeenAt: new Date(), lastDownloadAt: new Date() },
  });

  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    entity: policy.entity,
    rows: page.map(serializeRow),
    hasMore,
    nextCursor,
    serverTime: new Date().toISOString(),
  };
}

// =============================================================================
// SERIALIZATION
// =============================================================================

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

/**
 * Makes a Postgres row JSON-safe without losing precision.
 *
 * Decimal becomes a STRING, never a number: `JSON.stringify` on a float would
 * hand the till 19.989999999999998 for a price of 19.99, and that error
 * compounds across a day of line totals. BigInt likewise has no JSON form.
 */
function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      output[key] = null;
      continue;
    }

    if (value instanceof Date) {
      output[key] = value.toISOString();
      continue;
    }

    if (typeof value === "bigint") {
      output[key] = value.toString();
      continue;
    }

    // Prisma Decimal — duck-typed rather than instanceof so this stays correct
    // if the client is ever regenerated against a different runtime.
    if (typeof value === "object" && value !== null && "toFixed" in value) {
      output[key] = String(value);
      continue;
    }

    output[key] = value;
  }

  return output;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
