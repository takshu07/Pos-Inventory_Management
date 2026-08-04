// =============================================================================
// CLOUD APPLY — accepting an uploaded batch into the central database
//
// Runs on the CLOUD node. This is the last line of defence for data integrity:
// everything the edge nodes do is provisional until it lands here.
//
// ── One batch, one transaction ───────────────────────────────────────────────
// Every item in a batch is applied inside a single Postgres transaction,
// together with the receipts that record having applied them. So:
//
//   • a batch never half-lands — no sale exists without its items;
//   • a receipt can never exist for a row that was not written, nor a row
//     without its receipt. Those two failing independently is exactly how a
//     till ends up believing a sale is safely uploaded when it is not.
//
// ── Why the idempotency check is BOTH a query and a unique index ─────────────
// The query short-circuits the common case cheaply. The unique index on
// `sync_receipts.idempotencyKey` is what makes it CORRECT: two concurrent
// uploads of the same batch (a till retrying while the original request is
// still in flight) would both pass the query. One of them then loses the insert
// race and its transaction rolls back — so the sale is booked once, by exactly
// one of them.
//
// ── What a till is NOT allowed to write ──────────────────────────────────────
// The policy registry is enforced here, not just consulted. An item for a
// cloud-authoritative entity is REJECTED outright — a compromised or buggy
// edge node must not be able to upload an Employee row and mint itself an
// OWNER account, and "the till would never send that" is not a security
// control.
// =============================================================================

import { randomUUID } from "node:crypto";

import { logger } from "../../config/logger";
import { getCloudClient } from "../../config/prisma";
import type { PrismaClient } from "../../../generated/prisma";

import { resolveUploadConflict, describeDifferences } from "./conflicts";
import { policyFor, type EntityPolicy } from "./policy";
import type {
  ItemOutcome,
  UploadItem,
  UploadRequest,
  UploadItemResult,
} from "./protocol";

// =============================================================================
// TYPES
// =============================================================================

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

interface ItemDecision {
  readonly result: UploadItemResult;
  readonly conflict?: {
    readonly entity: string;
    readonly entityId: string;
    readonly reason: string;
    readonly localData: string;
    readonly cloudData: string | null;
  };
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Rejects anything an edge node has no business sending, BEFORE it touches the
 * database.
 */
function validateItem(item: UploadItem): { policy: EntityPolicy } | { rejection: string } {
  const policy = policyFor(item.entity);

  if (policy === undefined) {
    return { rejection: `unknown entity "${item.entity}"` };
  }

  if (policy.direction === "DOWN") {
    return {
      rejection:
        `${item.entity} is cloud-authoritative and may not be written by a device. ` +
        `Rejecting rather than trusting the sender.`,
    };
  }

  if (policy.direction === "LOCAL_ONLY") {
    return { rejection: `${item.entity} is device-local and is never uploaded` };
  }

  if (!item.entityId) {
    return { rejection: "missing entityId" };
  }

  if (item.operation !== "DELETE" && !item.payload) {
    return { rejection: `${item.operation} requires a payload` };
  }

  return { policy };
}

function parsePayload(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Converts a trigger-produced JSON row into Prisma input.
 *
 * SQLite has no date type, so `json_object` emits datetimes as strings; Postgres
 * will not take them. The conversion is driven by the manifest's column types
 * so it cannot be fooled by a string column whose name looks like a date.
 */
function coerceForCloud(
  row: Record<string, unknown>,
  columnTypes: ReadonlyMap<string, string>
): Record<string, unknown> {
  const coerced: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    const type = columnTypes.get(key);

    if (value === null || value === undefined) {
      coerced[key] = null;
      continue;
    }

    if (type === "DateTime") {
      coerced[key] = new Date(value as string);
      continue;
    }

    if (type === "Boolean" && typeof value === "number") {
      // SQLite stores booleans as 0/1.
      coerced[key] = value === 1;
      continue;
    }

    if (columnTypes.get(key) === "Json" && typeof value === "string") {
      try {
        coerced[key] = JSON.parse(value);
      } catch {
        coerced[key] = value;
      }
      continue;
    }

    coerced[key] = value;
  }

  return coerced;
}

// =============================================================================
// APPLYING ONE ITEM
// =============================================================================

async function applyItem(
  tx: TransactionClient,
  item: UploadItem,
  policy: EntityPolicy,
  columnTypes: ReadonlyMap<string, string>,
  scalarListFields: readonly string[]
): Promise<ItemDecision> {
  const delegate = (tx as unknown as Record<string, {
    findUnique: (args: unknown) => Promise<unknown>;
    upsert: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
  }>)[lowerFirst(policy.entity)];

  if (delegate === undefined) {
    return reject(item, `no Prisma delegate for ${policy.entity}`);
  }

  const where = { [policy.primaryKey]: item.entityId };
  const cloudRow = (await delegate.findUnique({ where })) as Record<string, unknown> | null;

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (item.operation === "DELETE") {
    if (cloudRow === null) {
      // Already gone. Idempotent by nature — report success rather than an
      // error, or a retried delete would park itself as FAILED forever.
      return { result: outcome(item, "APPLIED") };
    }

    await delegate.delete({ where });
    return { result: outcome(item, "APPLIED") };
  }

  // ── CREATE / UPDATE ───────────────────────────────────────────────────────
  const parsed = parsePayload(item.payload);
  if (parsed === null) {
    return reject(item, "payload was not valid JSON");
  }

  const decision = resolveUploadConflict({
    policy,
    cloudRow,
    localRow: parsed,
    operation: item.operation,
  });

  if (decision.winner === "CLOUD") {
    return {
      result: outcome(item, "CONFLICT_CLOUD_WINS", decision.reason),
      conflict: {
        entity: policy.entity,
        entityId: item.entityId,
        reason: decision.reason,
        localData: item.payload ?? "",
        cloudData: JSON.stringify(cloudRow, jsonSafe),
      },
    };
  }

  const data = coerceForCloud(parsed, columnTypes);

  // Scalar lists arrive as JSON text (that is how SQLite stores them) and must
  // go back to being real Postgres arrays.
  for (const field of scalarListFields) {
    if (typeof data[field] === "string") {
      try {
        data[field] = JSON.parse(data[field] as string);
      } catch {
        data[field] = [];
      }
    }
  }

  await delegate.upsert({ where, create: data, update: data });

  const conflictRecord =
    decision.logged && cloudRow !== null
      ? {
          entity: policy.entity,
          entityId: item.entityId,
          reason: decision.reason,
          localData: item.payload ?? "",
          cloudData: JSON.stringify(cloudRow, jsonSafe),
        }
      : undefined;

  return {
    result: outcome(item, "APPLIED"),
    ...(conflictRecord === undefined ? {} : { conflict: conflictRecord }),
  };
}

/** JSON.stringify replacer — Decimal and BigInt are not JSON-representable. */
function jsonSafe(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value !== null && typeof value === "object" && "toFixed" in value) {
    return String(value);
  }
  return value;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function outcome(item: UploadItem, result: ItemOutcome, reason?: string): UploadItemResult {
  return {
    queueId: item.queueId,
    idempotencyKey: item.idempotencyKey,
    outcome: result,
    ...(reason === undefined ? {} : { reason }),
  };
}

function reject(item: UploadItem, reason: string): ItemDecision {
  return { result: outcome(item, "REJECTED", reason) };
}

// =============================================================================
// BATCH
// =============================================================================

export interface ApplyBatchResult {
  readonly results: readonly UploadItemResult[];
  readonly applied: number;
  readonly duplicates: number;
  readonly conflicts: number;
  readonly rejected: number;
}

export async function applyUploadBatch(request: UploadRequest): Promise<ApplyBatchResult> {
  const prisma = getCloudClient();

  const manifest = (await import("../../../prisma/local/manifest.json", { with: { type: "json" } }))
    .default;

  const columnTypesByEntity = new Map(
    manifest.models.map((model) => [
      model.name,
      new Map(model.columns.map((column) => [column.name, column.type])),
    ])
  );
  const scalarListsByEntity = manifest.scalarListFields as Record<string, string[]>;

  const results: UploadItemResult[] = [];
  const counts = { applied: 0, duplicates: 0, conflicts: 0, rejected: 0 };

  // ── The whole batch in one transaction ────────────────────────────────────
  // The timeout is generous because a batch is up to a few hundred upserts, and
  // a batch that times out half-way would be re-sent in full — which is safe,
  // but wasteful, and on a bad link it can loop.
  await prisma.$transaction(
    async (tx) => {
      // Which of these have we already accepted? One query, not one per item.
      const existingReceipts = await tx.syncReceipt.findMany({
        where: { idempotencyKey: { in: request.items.map((item) => item.idempotencyKey) } },
        select: { idempotencyKey: true, result: true },
      });

      const alreadyApplied = new Map(
        existingReceipts.map((receipt) => [receipt.idempotencyKey, receipt.result])
      );

      const receiptsToWrite: Array<{
        id: string;
        idempotencyKey: string;
        deviceId: string;
        entity: string;
        entityId: string;
        operation: string;
        result: string;
        reason: string | null;
        batchId: string;
      }> = [];

      const conflictsToWrite: Array<{
        id: string;
        deviceId: string;
        entity: string;
        entityId: string;
        resolution: string;
        reason: string;
        localData: string;
        cloudData: string | null;
      }> = [];

      for (const item of request.items) {
        // ── Idempotency ─────────────────────────────────────────────────────
        if (alreadyApplied.has(item.idempotencyKey)) {
          counts.duplicates += 1;
          results.push(
            outcome(item, "SKIPPED_DUPLICATE", `already applied (${alreadyApplied.get(item.idempotencyKey)})`)
          );
          continue;
        }

        const validation = validateItem(item);

        if ("rejection" in validation) {
          counts.rejected += 1;
          results.push(outcome(item, "REJECTED", validation.rejection));
          receiptsToWrite.push({
            id: randomUUID(),
            idempotencyKey: item.idempotencyKey,
            deviceId: request.deviceId,
            entity: item.entity,
            entityId: item.entityId,
            operation: item.operation,
            result: "REJECTED",
            reason: validation.rejection,
            batchId: request.batchId,
          });
          continue;
        }

        const { policy } = validation;
        const columnTypes = columnTypesByEntity.get(policy.entity) ?? new Map<string, string>();

        let decision: ItemDecision;

        try {
          decision = await applyItem(
            tx,
            item,
            policy,
            columnTypes,
            scalarListsByEntity[policy.entity] ?? []
          );
        } catch (error) {
          // ── A single bad row must not roll back the batch ─────────────────
          // A foreign key that does not resolve, a value that violates a check
          // constraint — these are permanent problems with THAT row. Failing
          // the transaction would block every good sale behind it indefinitely,
          // so the row is rejected individually and reported back so the till
          // can park it for a human.
          const message = error instanceof Error ? error.message : String(error);

          logger.warn(
            { entity: item.entity, entityId: item.entityId, err: message },
            "offline: rejecting individual sync item"
          );

          decision = reject(item, message.slice(0, 500));
        }

        results.push(decision.result);

        switch (decision.result.outcome) {
          case "APPLIED":
            counts.applied += 1;
            break;
          case "CONFLICT_CLOUD_WINS":
            counts.conflicts += 1;
            break;
          case "REJECTED":
            counts.rejected += 1;
            break;
          default:
            break;
        }

        receiptsToWrite.push({
          id: randomUUID(),
          idempotencyKey: item.idempotencyKey,
          deviceId: request.deviceId,
          entity: item.entity,
          entityId: item.entityId,
          operation: item.operation,
          result: decision.result.outcome,
          reason: decision.result.reason ?? null,
          batchId: request.batchId,
        });

        if (decision.conflict !== undefined) {
          conflictsToWrite.push({
            id: randomUUID(),
            deviceId: request.deviceId,
            entity: decision.conflict.entity,
            entityId: decision.conflict.entityId,
            resolution:
              decision.result.outcome === "CONFLICT_CLOUD_WINS" ? "CLOUD_WINS" : "LOCAL_WINS",
            reason: decision.conflict.reason,
            localData: decision.conflict.localData,
            cloudData: decision.conflict.cloudData,
          });
        }
      }

      // Receipts are written in the SAME transaction as the rows they describe.
      // Split across two transactions, a crash between them would either lose
      // the dedupe protection or claim to have applied something that rolled
      // back.
      if (receiptsToWrite.length > 0) {
        await tx.syncReceipt.createMany({ data: receiptsToWrite });
      }

      if (conflictsToWrite.length > 0) {
        await tx.syncConflictRecord.createMany({ data: conflictsToWrite });
      }

      await tx.syncDevice.upsert({
        where: { deviceId: request.deviceId },
        create: {
          deviceId: request.deviceId,
          lastSeenAt: new Date(),
          lastUploadAt: new Date(),
          itemsAccepted: counts.applied,
          itemsRejected: counts.rejected,
          conflicts: counts.conflicts,
          lastQueueId: request.items.at(-1)?.queueId ?? null,
        },
        update: {
          lastSeenAt: new Date(),
          lastUploadAt: new Date(),
          itemsAccepted: { increment: counts.applied },
          itemsRejected: { increment: counts.rejected },
          conflicts: { increment: counts.conflicts },
          lastQueueId: request.items.at(-1)?.queueId ?? null,
        },
      });
    },
    { timeout: 120_000, maxWait: 20_000 }
  );

  return { results, ...counts };
}
