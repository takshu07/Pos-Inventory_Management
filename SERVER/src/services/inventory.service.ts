// =============================================================================
// INVENTORY SERVICE
//
// Orchestration + authorization for the Inventory module.
//
// The four rules this file exists to enforce:
//
//   1. STOCK CHANGES ONLY THROUGH THE LEDGER. Nothing here writes
//      ProductVariant.currentStock. Every quantity change calls
//      executeMovement(), which is the single writer and the thing that makes
//      inventory a ledger rather than a spreadsheet.
//
//   2. RBAC IS DATA SCOPING, NOT UI HIDING. `scopeFor(actor)` decides whether
//      cost and valuation are visible and whether stock may be changed, before
//      any payload is built. A cashier hitting a shared read gets a narrowed
//      result; a manager hitting an owner route is rejected by the guard. Both
//      layers are required.
//
//   3. NO DUPLICATED BUSINESS LOGIC. Arithmetic comes from inventory.engine,
//      sales figures from the sales tables, audit from the audit repository,
//      alerts from the Notification engine. This service joins; it does not
//      recompute.
//
//   4. AGGREGATES ARE BATCHED. Enrichment attaches reservations, velocity and
//      last-movement to a PAGE of variants in a fixed number of queries —
//      never one query per row.
// =============================================================================

import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { logger } from "../config/logger";
import { prisma } from "../config/prisma";
import { ConfigurationEngine } from "../engines/configuration.engine";
import { auditRepository } from "../repositories/audit.repository";
import { inventoryRepository } from "../repositories/inventory.repository";
import { executeMovement } from "./inventoryMovement.service";
import * as inventoryAlerts from "./inventoryAlerts.service";
import {
  classifyVelocity,
  computeAvailability,
  computeReorder,
  computeValuation,
  countAccuracy,
  deriveStockStatus,
  suggestedClearanceDiscount,
  sumValuations,
  type StockStatus,
} from "../engines/inventory.engine";
import type { AuthenticatedUser } from "../types/employee.types";
import type { PaginatedResponse } from "../types/common.types";
import type {
  AdjustmentQuery,
  CreateAdjustmentInput,
  CreateReservationInput,
  CycleCountQuery,
  DamagedQuery,
  MovementQuery,
  ReorderQuery,
  ReportDamageInput,
  ReservationQuery,
  ReviewAdjustmentInput,
  StartCycleCountInput,
  StockQuery,
  ValuationQuery,
  VelocityQuery,
} from "../validation/inventory.validation";

// =============================================================================
// SCOPING — the authorization primitive of this module
// =============================================================================

interface InventoryScope {
  /** May the actor see cost price, margins and valuation? */
  canSeeCost: boolean;
  /** May the actor change stock (approve adjustments, post counts)? */
  canMutateStock: boolean;
  /** May the actor request an adjustment for someone else to approve? */
  canRequestAdjustment: boolean;
  /** May the actor run and complete cycle counts? */
  canCount: boolean;
}

/**
 * Derives what this actor may see and do.
 *
 * Mirrors the spec exactly: OWNER everything; MANAGER counts and requests but
 * cannot approve, override, or see cost; CASHIER reads stock and scans only.
 * Cost visibility is the sharp edge — a cashier must be able to check whether
 * an item is in stock without learning the margin on it.
 */
function scopeFor(actor: AuthenticatedUser): InventoryScope {
  switch (actor.role) {
    case "OWNER":
      return {
        canSeeCost: true,
        canMutateStock: true,
        canRequestAdjustment: true,
        canCount: true,
      };
    case "MANAGER":
      return {
        canSeeCost: false,
        canMutateStock: false,
        canRequestAdjustment: true,
        canCount: true,
      };
    default:
      // CASHIER. Read + scan only — no counting, no adjustments, no cost.
      return {
        canSeeCost: false,
        canMutateStock: false,
        canRequestAdjustment: false,
        canCount: false,
      };
  }
}

function assertCanMutate(actor: AuthenticatedUser, action: string): void {
  if (!scopeFor(actor).canMutateStock) {
    throw new AppError(HTTP_STATUS.FORBIDDEN, `Only the owner can ${action}.`);
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const maybe = value as { toNumber?: () => number };
  return typeof maybe.toNumber === "function" ? maybe.toNumber() : Number(value) || 0;
}

function paginate<T>(data: T[], total: number, page: number, limit: number): PaginatedResponse<T> {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    data,
    meta: {
      total, page, limit, totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function resolvePeriod(period: string, from?: Date, to?: Date): { from: Date; to: Date } {
  if (from && to) return { from, to };
  const now = new Date();
  switch (period) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { from: start, to: now };
    }
    case "week": return { from: daysAgo(7), to: now };
    case "quarter": return { from: daysAgo(90), to: now };
    case "year": return { from: daysAgo(365), to: now };
    case "month":
    default: return { from: daysAgo(30), to: now };
  }
}

/** Store inventory settings, with a safe fallback on a fresh install. */
function inventoryConfig() {
  try {
    return ConfigurationEngine.getInventorySettings();
  } catch {
    return {
      allowNegativeStock: false,
      lowStockThreshold: 5,
      autoSkuGeneration: true,
      inventoryReservationMins: 15,
    };
  }
}

/** Days since a date, or null when it never happened. */
function daysSince(date: Date | null | undefined): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
}

// =============================================================================
// STOCK OVERVIEW
// =============================================================================

/** Derived filters that cannot be expressed in SQL and run after enrichment. */
const DERIVED_STATUSES = new Set([
  "FAST_MOVING", "SLOW_MOVING", "DEAD_STOCK", "RESERVED", "OVERSTOCKED", "IN_STOCK",
]);

/** Sorts that need the enriched row rather than a column. */
const COMPUTED_SORTS = new Set([
  "available", "stockValue", "unitsSold", "lastMovementAt",
]);

/**
 * The stock overview table.
 *
 * When the caller filters or sorts on a DERIVED column, the id set is widened
 * to the whole filtered catalogue before enrichment, because ranking must
 * consider everything — sorting only the current page would produce a "slowest
 * mover" that merely happened to land on page 1.
 */
export async function listStock(query: StockQuery, actor: AuthenticatedUser) {
  const scope = scopeFor(actor);

  const needsFullSet =
    DERIVED_STATUSES.has(query.status) || COMPUTED_SORTS.has(query.sortBy);

  const filters = {
    page: query.page,
    limit: query.limit,
    search: query.search,
    categoryId: query.categoryId,
    brandId: query.brandId,
    supplierId: query.supplierId,
    isActive: query.isActive,
    lowStockOnly: query.status === "LOW_STOCK",
    outOfStockOnly: query.status === "OUT_OF_STOCK",
    negativeOnly: query.status === "NEGATIVE",
    createdFrom: query.createdFrom,
    createdTo: query.createdTo,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  };

  const { data: rows, total } = needsFullSet
    ? await inventoryRepository.findStock({ ...filters, page: 1, limit: 2000 })
    : await inventoryRepository.findStock(filters);

  const enriched = await enrichStockRows(rows, query.velocityDays, scope);

  // ── Derived filtering ────────────────────────────────────────────────────
  let visible = enriched;
  if (DERIVED_STATUSES.has(query.status)) {
    visible = enriched.filter((row) => {
      switch (query.status) {
        case "RESERVED": return row.reserved > 0;
        case "FAST_MOVING":
        case "SLOW_MOVING":
        case "DEAD_STOCK": return row.velocity === query.status;
        default: return row.status === query.status;
      }
    });
  }

  // ── Computed sorting ─────────────────────────────────────────────────────
  if (COMPUTED_SORTS.has(query.sortBy)) {
    const dir = query.sortOrder === "asc" ? 1 : -1;
    visible = [...visible].sort((a, b) => {
      const av = (a[query.sortBy as keyof typeof a] as number) ?? 0;
      const bv = (b[query.sortBy as keyof typeof b] as number) ?? 0;
      return (av - bv) * dir;
    });
  }

  if (needsFullSet) {
    const start = (query.page - 1) * query.limit;
    return paginate(
      visible.slice(start, start + query.limit),
      visible.length,
      query.page,
      query.limit
    );
  }

  return paginate(visible, total, query.page, query.limit);
}

/**
 * Attaches reservations, velocity, valuation and last-movement to a set of
 * rows. Three parallel queries, independent of row count.
 */
async function enrichStockRows(
  rows: Awaited<ReturnType<typeof inventoryRepository.findStock>>["data"],
  velocityDays: number,
  scope: InventoryScope
) {
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const windowFrom = daysAgo(velocityDays);
  const now = new Date();

  const [reservations, velocity, lastMovements, lastSales] = await Promise.all([
    inventoryRepository.sumActiveReservations(ids, now),
    inventoryRepository.salesVelocity(ids, windowFrom, now),
    inventoryRepository.findLastMovements(ids),
    // Unwindowed: dead stock asks "how long since this last sold", which a
    // 30-day window cannot answer.
    inventoryRepository.lastSaleDates(ids),
  ]);

  const reservedBy = new Map(reservations.map((r) => [r.variantId, r._sum.quantity ?? 0]));
  const velocityBy = new Map(velocity.map((v) => [v.variantId, v]));
  const movementBy = new Map(lastMovements.map((m) => [m.variantId, m]));
  const lastSaleBy = new Map(lastSales.map((s) => [s.variantId, s.lastSaleAt]));

  return rows.map((row) => {
    const reserved = reservedBy.get(row.id) ?? 0;
    const availability = computeAvailability({
      currentStock: row.currentStock,
      reservedQuantity: reserved,
    });

    const costPrice = toNumber(row.costPrice);
    const sellingPrice = toNumber(row.sellingPrice);
    const valuation = computeValuation({
      quantity: row.currentStock,
      costPrice,
      sellingPrice,
    });

    const sales = velocityBy.get(row.id);
    const unitsSold = Number(sales?.unitsSold ?? 0);
    const lastSaleAt = lastSaleBy.get(row.id) ?? null;

    const velocityClass = classifyVelocity({
      unitsSold,
      windowDays: velocityDays,
      daysSinceLastSale: daysSince(lastSaleAt),
      currentStock: row.currentStock,
    });

    const status: StockStatus = deriveStockStatus({
      currentStock: row.currentStock,
      available: availability.available,
      reorderLevel: row.reorderLevel,
    });

    const movement = movementBy.get(row.id);

    return {
      id: row.id,
      sku: row.sku,
      barcode: row.barcode,
      productId: row.product.id,
      productName: row.product.name,
      // The catalog stores an array; inventory rows show one thumbnail.
      imageUrl: row.product.imageUrls?.[0] ?? null,
      variantName: `${row.size?.name ?? ""} / ${row.color?.name ?? ""}`.trim(),
      sizeName: row.size?.name ?? null,
      colorName: row.color?.name ?? null,
      categoryId: row.product.category?.id ?? null,
      categoryName: row.product.category?.name ?? null,
      brandId: row.product.brand?.id ?? null,
      brandName: row.product.brand?.name ?? null,
      supplierId: row.supplier?.id ?? null,
      supplierName: row.supplier?.businessName ?? null,

      currentStock: row.currentStock,
      reserved,
      available: availability.available,
      reorderLevel: row.reorderLevel,
      status,
      velocity: velocityClass,

      // Cost and margin are OWNER-only. Omitting the keys entirely (rather
      // than nulling them) means a narrowed payload never carries the field at
      // all — there is nothing for a client bug to reveal.
      ...(scope.canSeeCost
        ? {
            costPrice,
            stockValue: valuation.stockValue,
            potentialProfit: valuation.potentialProfit,
            marginPercentage: valuation.marginPercentage,
          }
        : {}),

      sellingPrice,
      mrp: toNumber(row.mrp),
      retailValue: valuation.retailValue,

      unitsSold,
      revenue: Number(sales?.revenue ?? 0),
      lastSaleAt,
      lastMovementAt: movement?.createdAt ?? null,
      lastMovementType: movement?.type ?? null,

      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

/** Barcode/SKU scan. Available to every role — cashiers must be able to look up stock. */
export async function scanCode(code: string, actor: AuthenticatedUser) {
  const scope = scopeFor(actor);

  const variant = await inventoryRepository.findVariantByCode(code);
  if (!variant) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, `No product found for code "${code}".`);
  }

  const [enriched] = await enrichStockRows([variant], 30, scope);
  return enriched;
}

// =============================================================================
// INVENTORY DETAIL (drawer)
// =============================================================================

export async function getInventoryDetail(variantId: string, actor: AuthenticatedUser) {
  const scope = scopeFor(actor);

  const variant = await inventoryRepository.findVariantById(variantId);
  if (!variant) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Product variant not found.");
  }

  const [enriched] = await enrichStockRows([variant], 30, scope);

  const [reservations, damaged, pendingAdjustments] = await Promise.all([
    inventoryRepository.findReservations({ page: 1, limit: 20, variantId, status: "ACTIVE" }),
    inventoryRepository.findDamagedStock({ page: 1, limit: 20, variantId, isWrittenOff: false }),
    inventoryRepository.findAdjustments({ page: 1, limit: 10, variantId, status: "PENDING" }),
  ]);

  return {
    ...enriched,
    reservations: reservations.data,
    damaged: damaged.data,
    damagedQuantity: damaged.data.reduce((sum, d) => sum + d.quantity, 0),
    pendingAdjustments: pendingAdjustments.data,
  };
}

export async function getVariantPurchases(variantId: string, actor: AuthenticatedUser) {
  const scope = scopeFor(actor);
  const rows = await inventoryRepository.findVariantPurchases(variantId);

  return rows.map((row) => ({
    id: row.id,
    quantity: row.quantity,
    // Purchase cost is compensation-adjacent data: it reveals supplier pricing.
    ...(scope.canSeeCost ? { costPrice: toNumber(row.costPrice) } : {}),
    purchaseId: row.purchase.id,
    purchaseNumber: row.purchase.purchaseNumber,
    supplierInvoiceNumber: row.purchase.supplierInvoiceNumber,
    purchaseDate: row.purchase.purchaseDate,
    supplierId: row.purchase.supplier?.id ?? null,
    supplierName: row.purchase.supplier?.businessName ?? null,
  }));
}

export async function getVariantSales(variantId: string) {
  const rows = await inventoryRepository.findVariantSales(variantId);

  return rows.map((row) => ({
    id: row.id,
    quantity: row.quantity,
    sellingPrice: toNumber(row.sellingPrice),
    saleId: row.sale.id,
    saleNumber: row.sale.saleNumber,
    saleDate: row.sale.saleDate,
    customerId: row.sale.customer?.id ?? null,
    customerName: row.sale.customer?.name ?? null,
    employeeName: row.sale.employee
      ? `${row.sale.employee.firstName} ${row.sale.employee.lastName}`.trim()
      : null,
  }));
}

// =============================================================================
// MOVEMENTS — the ledger, read-only here. Writes go through executeMovement.
// =============================================================================

export async function listMovements(query: MovementQuery) {
  const { total, data } = await inventoryRepository.findMovements(query);

  const rows = data.map((row) => ({
    id: row.id,
    variantId: row.variantId,
    sku: row.variant?.sku ?? null,
    productName: row.variant?.product?.name ?? null,
    imageUrl: row.variant?.product?.imageUrls?.[0] ?? null,
    variantName: `${row.variant?.size?.name ?? ""} / ${row.variant?.color?.name ?? ""}`.trim(),
    type: row.type,
    quantityChanged: row.quantityChanged,
    stockBefore: row.stockBefore,
    stockAfter: row.stockAfter,
    reason: row.reason,
    referenceNumber: row.referenceNumber,
    // Which record caused this, so the UI can link straight to it.
    relatedPurchaseId: row.relatedPurchaseId,
    relatedSaleId: row.relatedSaleId,
    relatedExchangeId: row.relatedExchangeId,
    employeeId: row.employee?.id ?? null,
    employeeName: row.employee
      ? `${row.employee.firstName} ${row.employee.lastName}`.trim()
      : null,
    createdAt: row.createdAt,
  }));

  return paginate(rows, total, query.page, query.limit);
}

// =============================================================================
// RESERVATIONS
// =============================================================================

export async function listReservations(query: ReservationQuery) {
  const { total, data } = await inventoryRepository.findReservations(query);
  return paginate(data, total, query.page, query.limit);
}

/**
 * Holds stock without moving it.
 *
 * Deliberately writes NO movement: the goods have not left the shelf, and
 * recording a movement would make the ledger claim a stock change that did not
 * happen. Availability falls because the reservation exists, not because stock
 * moved — which is exactly the distinction that keeps cycle counts honest.
 */
export async function createReservation(
  input: CreateReservationInput,
  actor: AuthenticatedUser
) {
  const variant = await inventoryRepository.findVariantById(input.variantId);
  if (!variant) throw new AppError(HTTP_STATUS.NOT_FOUND, "Product variant not found.");

  const [existing] = await inventoryRepository.sumActiveReservations([input.variantId]);
  const availability = computeAvailability({
    currentStock: variant.currentStock,
    reservedQuantity: existing?._sum.quantity ?? 0,
  });

  if (input.quantity > availability.available) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      `Cannot reserve ${input.quantity} — only ${availability.available} available.`,
      { available: availability.available, currentStock: variant.currentStock }
    );
  }

  const minutes = input.expiresInMinutes ?? inventoryConfig().inventoryReservationMins;
  // A configured 0 means "no expiry" rather than "expires immediately", which
  // would make every hold useless the moment it was created.
  const expiresAt = minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;

  const reservation = await inventoryRepository.createReservation({
    variantId: input.variantId,
    quantity: input.quantity,
    type: input.type,
    heldFor: input.heldFor ?? null,
    customerId: input.customerId ?? null,
    exchangeId: input.exchangeId ?? null,
    reason: input.reason ?? null,
    expiresAt,
    createdById: actor.id,
  });

  auditRepository.create({
    performedBy: actor.id,
    action: "CREATE",
    module: "INVENTORY",
    tableName: "inventory_reservations",
    recordId: reservation.id,
    newData: { variantId: input.variantId, quantity: input.quantity, type: input.type },
  });

  return reservation;
}

/** Releases a hold back to available stock. Also writes no movement. */
export async function releaseReservation(id: string, actor: AuthenticatedUser) {
  const reservation = await inventoryRepository.findReservationById(id);
  if (!reservation) throw new AppError(HTTP_STATUS.NOT_FOUND, "Reservation not found.");

  if (reservation.status !== "ACTIVE") {
    throw new AppError(HTTP_STATUS.CONFLICT, "That reservation is no longer active.");
  }

  const released = await inventoryRepository.updateReservationStatus(id, {
    status: "RELEASED",
    releasedById: actor.id,
    releasedAt: new Date(),
  });

  auditRepository.create({
    performedBy: actor.id,
    action: "UPDATE",
    module: "INVENTORY",
    tableName: "inventory_reservations",
    recordId: id,
    oldData: { status: "ACTIVE" },
    newData: { status: "RELEASED" },
  });

  return released;
}

// =============================================================================
// STOCK ADJUSTMENTS — request → approve → ledger
// =============================================================================

export async function listAdjustments(query: AdjustmentQuery) {
  const { total, data } = await inventoryRepository.findAdjustments(query);
  return paginate(data, total, query.page, query.limit);
}

/**
 * Raises an adjustment request.
 *
 * NOTHING moves here. The request is a durable record of intent; stock changes
 * only on approval. That separation is what makes "manager may request but not
 * perform" enforceable rather than aspirational.
 *
 * An OWNER's request is auto-approved — requiring them to approve their own
 * request would be ceremony, not control.
 */
export async function createAdjustment(
  input: CreateAdjustmentInput,
  actor: AuthenticatedUser
) {
  const scope = scopeFor(actor);
  if (!scope.canRequestAdjustment) {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "You cannot request stock adjustments.");
  }

  const variant = await inventoryRepository.findVariantById(input.variantId);
  if (!variant) throw new AppError(HTTP_STATUS.NOT_FOUND, "Product variant not found.");

  const wouldGoNegative = variant.currentStock + input.quantityChange < 0;
  if (wouldGoNegative && !inventoryConfig().allowNegativeStock) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      `That would take stock to ${variant.currentStock + input.quantityChange}. ` +
        `Current stock is ${variant.currentStock}.`
    );
  }

  const adjustment = await inventoryRepository.createAdjustment({
    variantId: input.variantId,
    quantityChange: input.quantityChange,
    stockAtRequest: variant.currentStock,
    reason: input.reason,
    notes: input.notes ?? null,
    requestedById: actor.id,
    status: "PENDING",
  });

  auditRepository.create({
    performedBy: actor.id,
    action: "CREATE",
    module: "INVENTORY",
    tableName: "stock_adjustments",
    recordId: adjustment.id,
    newData: {
      variantId: input.variantId,
      quantityChange: input.quantityChange,
      reason: input.reason,
    },
  });

  // An owner requesting is an owner deciding; approve in the same breath.
  if (scope.canMutateStock) {
    return reviewAdjustment(adjustment.id, { approve: true }, actor);
  }

  inventoryAlerts.adjustmentRequested({
    adjustmentId: adjustment.id,
    productName: variant.product.name,
    sku: variant.sku,
    quantityChange: input.quantityChange,
    requestedBy: actor.id,
  });

  return adjustment;
}

/**
 * Approves or rejects an adjustment. OWNER only.
 *
 * On approval the ledger entry is written INSIDE the same transaction that
 * flips the status, so an approved adjustment can never exist without its
 * movement (or vice versa).
 */
export async function reviewAdjustment(
  id: string,
  input: ReviewAdjustmentInput,
  actor: AuthenticatedUser
) {
  assertCanMutate(actor, "approve stock adjustments");

  const adjustment = await inventoryRepository.findAdjustmentById(id);
  if (!adjustment) throw new AppError(HTTP_STATUS.NOT_FOUND, "Adjustment not found.");

  if (adjustment.status !== "PENDING") {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      `That adjustment has already been ${adjustment.status.toLowerCase()}.`
    );
  }

  if (!input.approve) {
    const rejected = await inventoryRepository.updateAdjustment(id, {
      status: "REJECTED",
      reviewedById: actor.id,
      reviewedAt: new Date(),
      reviewNotes: input.reviewNotes ?? null,
    });

    auditRepository.create({
      performedBy: actor.id,
      action: "UPDATE",
      module: "INVENTORY",
      tableName: "stock_adjustments",
      recordId: id,
      oldData: { status: "PENDING" },
      newData: { status: "REJECTED", reviewNotes: input.reviewNotes },
    });

    return rejected;
  }

  // ── Approval: ledger + status together, or neither ──────────────────────
  const result = await prisma.$transaction(async (tx) => {
    const movement = await executeMovement(
      {
        variantId: adjustment.variantId,
        employeeId: actor.id,
        // DAMAGE gets its own ledger type so the damaged report can be built
        // from the ledger rather than by parsing reason strings.
        type: adjustment.reason === "DAMAGE" ? "DAMAGED" : "MANUAL_ADJUSTMENT",
        quantityChanged: adjustment.quantityChange,
        reason: `${adjustment.reason}${adjustment.notes ? ` — ${adjustment.notes}` : ""}`,
        referenceNumber: `ADJ-${adjustment.id.slice(-8).toUpperCase()}`,
      },
      tx
    );

    const approved = await inventoryRepository.updateAdjustment(
      id,
      {
        status: "APPROVED",
        reviewedById: actor.id,
        reviewedAt: new Date(),
        reviewNotes: input.reviewNotes ?? null,
        movementId: movement.id,
      },
      tx
    );

    return { approved, movement };
  });

  auditRepository.create({
    performedBy: actor.id,
    action: "UPDATE",
    module: "INVENTORY",
    tableName: "stock_adjustments",
    recordId: id,
    oldData: { status: "PENDING" },
    newData: { status: "APPROVED", movementId: result.movement.id },
  });

  // A large correction is worth telling someone about even after approval.
  inventoryAlerts.largeAdjustmentApproved({
    variantId: adjustment.variantId,
    productName: adjustment.variant.product.name,
    sku: adjustment.variant.sku,
    quantityChange: adjustment.quantityChange,
    stockAfter: result.movement.stockAfter,
  });

  await notifyIfStockLow(adjustment.variantId);

  return result.approved;
}

// =============================================================================
// DAMAGED STOCK
// =============================================================================

export async function listDamagedStock(query: DamagedQuery, actor: AuthenticatedUser) {
  const scope = scopeFor(actor);
  const { total, data } = await inventoryRepository.findDamagedStock(query);

  const rows = data.map((row) => ({
    id: row.id,
    variantId: row.variantId,
    sku: row.variant.sku,
    productName: row.variant.product.name,
    imageUrl: row.variant.product.imageUrls?.[0] ?? null,
    variantName: `${row.variant.size?.name ?? ""} / ${row.variant.color?.name ?? ""}`.trim(),
    quantity: row.quantity,
    reason: row.reason,
    isWrittenOff: row.isWrittenOff,
    writtenOffAt: row.writtenOffAt,
    reportedAt: row.reportedAt,
    reportedByName: row.reportedBy
      ? `${row.reportedBy.firstName} ${row.reportedBy.lastName}`.trim()
      : null,
    // The cost of the loss is owner-only, like every other cost figure.
    ...(scope.canSeeCost
      ? { lossValue: toNumber(row.variant.costPrice) * row.quantity }
      : {}),
  }));

  return paginate(rows, total, query.page, query.limit);
}

/**
 * Reports damaged goods.
 *
 * Per the agreed model this does BOTH: deducts from currentStock via a DAMAGED
 * movement (the goods are not sellable) and writes a damaged record carrying
 * the reason and reporter. One without the other loses either the stock
 * accuracy or the reportability.
 */
export async function reportDamage(input: ReportDamageInput, actor: AuthenticatedUser) {
  assertCanMutate(actor, "write off damaged stock");

  const variant = await inventoryRepository.findVariantById(input.variantId);
  if (!variant) throw new AppError(HTTP_STATUS.NOT_FOUND, "Product variant not found.");

  if (input.quantity > variant.currentStock && !inventoryConfig().allowNegativeStock) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      `Cannot write off ${input.quantity} — only ${variant.currentStock} in stock.`
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const movement = await executeMovement(
      {
        variantId: input.variantId,
        employeeId: actor.id,
        type: "DAMAGED",
        quantityChanged: -Math.abs(input.quantity),
        reason: input.reason,
        referenceNumber: `DMG-${Date.now().toString(36).toUpperCase()}`,
      },
      tx
    );

    const record = await inventoryRepository.createDamagedStock(
      {
        variantId: input.variantId,
        quantity: input.quantity,
        reason: input.reason,
        movementId: movement.id,
        reportedById: actor.id,
      },
      tx
    );

    return record;
  });

  auditRepository.create({
    performedBy: actor.id,
    action: "CREATE",
    module: "INVENTORY",
    tableName: "damaged_stock",
    recordId: result.id,
    newData: { variantId: input.variantId, quantity: input.quantity, reason: input.reason },
  });

  inventoryAlerts.damagedStockReported({
    variantId: input.variantId,
    productName: variant.product.name,
    sku: variant.sku,
    quantity: input.quantity,
    reason: input.reason,
  });

  await notifyIfStockLow(input.variantId);

  return result;
}

// =============================================================================
// CYCLE COUNTS
// =============================================================================

export async function listCycleCounts(query: CycleCountQuery) {
  const { total, data } = await inventoryRepository.findCycleCounts(query);
  return paginate(data, total, query.page, query.limit);
}

export async function getCycleCount(id: string) {
  const count = await inventoryRepository.findCycleCountById(id);
  if (!count) throw new AppError(HTTP_STATUS.NOT_FOUND, "Cycle count not found.");

  const items = await inventoryRepository.findCycleCountItems(id);

  return {
    ...count,
    accuracy: countAccuracy({
      totalCounted: items.filter((i) => i.countedQuantity !== null).length,
      varianceLines: items.filter((i) => (i.variance ?? 0) !== 0).length,
    }),
    items: items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      sku: item.variant.sku,
      barcode: item.variant.barcode,
      productName: item.variant.product.name,
      imageUrl: item.variant.product.imageUrls?.[0] ?? null,
      variantName: `${item.variant.size?.name ?? ""} / ${item.variant.color?.name ?? ""}`.trim(),
      expectedQuantity: item.expectedQuantity,
      countedQuantity: item.countedQuantity,
      variance: item.variance,
      notes: item.notes,
      countedAt: item.countedAt,
      countedByName: item.countedBy
        ? `${item.countedBy.firstName} ${item.countedBy.lastName}`.trim()
        : null,
    })),
  };
}

/**
 * Opens a count session and freezes the expected quantities.
 *
 * Snapshotting expected stock AT START is what makes a variance attributable
 * to the count. Reading it at completion would fold in every sale made while
 * counting and blame the counter for them.
 */
export async function startCycleCount(
  input: StartCycleCountInput,
  actor: AuthenticatedUser
) {
  const scope = scopeFor(actor);
  if (!scope.canCount) {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "You cannot run cycle counts.");
  }

  const scoped = await inventoryRepository.findStock({
    page: 1,
    limit: 2000,
    isActive: true,
    categoryId: input.categoryId,
    brandId: input.brandId,
    supplierId: input.supplierId,
    sortBy: "sku",
    sortOrder: "asc",
  });

  if (scoped.data.length === 0) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "No products match that scope.");
  }

  const reference = `CC-${new Date().getFullYear()}-${Date.now().toString(36).slice(-6).toUpperCase()}`;

  const session = await inventoryRepository.createCycleCount({
    reference,
    name: input.name ?? null,
    categoryId: input.categoryId ?? null,
    brandId: input.brandId ?? null,
    supplierId: input.supplierId ?? null,
    notes: input.notes ?? null,
    startedById: actor.id,
    totalItems: scoped.data.length,
  });

  await inventoryRepository.createCycleCountItems(
    scoped.data.map((v) => ({
      cycleCountId: session.id,
      variantId: v.id,
      expectedQuantity: v.currentStock,
    }))
  );

  auditRepository.create({
    performedBy: actor.id,
    action: "CREATE",
    module: "INVENTORY",
    tableName: "cycle_counts",
    recordId: session.id,
    newData: { reference, totalItems: scoped.data.length },
  });

  return session;
}

/** Records a physical count for one line. Upserts, so re-scanning corrects. */
export async function recordCount(
  cycleCountId: string,
  input: { variantId: string; countedQuantity: number; notes?: string | undefined },
  actor: AuthenticatedUser
) {
  const scope = scopeFor(actor);
  if (!scope.canCount) {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "You cannot run cycle counts.");
  }

  const session = await inventoryRepository.findCycleCountById(cycleCountId);
  if (!session) throw new AppError(HTTP_STATUS.NOT_FOUND, "Cycle count not found.");
  if (session.status !== "IN_PROGRESS") {
    throw new AppError(HTTP_STATUS.CONFLICT, "That count session is already closed.");
  }

  const existing = (await inventoryRepository.findCycleCountItems(cycleCountId)).find(
    (i) => i.variantId === input.variantId
  );

  // A variant scanned that was not in scope still counts — finding stock the
  // session did not expect is a real result, not an error.
  const expected = existing?.expectedQuantity ?? (
    await inventoryRepository.findVariantById(input.variantId)
  )?.currentStock ?? 0;

  return inventoryRepository.upsertCycleCountItem({
    cycleCountId,
    variantId: input.variantId,
    expectedQuantity: expected,
    countedQuantity: input.countedQuantity,
    variance: input.countedQuantity - expected,
    countedById: actor.id,
    notes: input.notes ?? null,
  });
}

/** Scanner entry point — resolves a barcode, then records the count. */
export async function recordCountByCode(
  cycleCountId: string,
  input: { code: string; countedQuantity: number; notes?: string | undefined },
  actor: AuthenticatedUser
) {
  const variant = await inventoryRepository.findVariantByCode(input.code);
  if (!variant) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, `No product found for code "${input.code}".`);
  }

  return recordCount(
    cycleCountId,
    {
      variantId: variant.id,
      countedQuantity: input.countedQuantity,
      notes: input.notes,
    },
    actor
  );
}

/**
 * Closes a count and, by default, posts its variances to the ledger.
 *
 * Posting is OWNER-only because it changes stock. A manager may count all day;
 * turning those findings into stock movements is an owner's decision.
 */
export async function completeCycleCount(
  id: string,
  input: { postAdjustments: boolean; notes?: string | undefined },
  actor: AuthenticatedUser
) {
  const session = await inventoryRepository.findCycleCountById(id);
  if (!session) throw new AppError(HTTP_STATUS.NOT_FOUND, "Cycle count not found.");
  if (session.status !== "IN_PROGRESS") {
    throw new AppError(HTTP_STATUS.CONFLICT, "That count session is already closed.");
  }

  if (input.postAdjustments) {
    assertCanMutate(actor, "post cycle count adjustments");
  }

  const items = await inventoryRepository.findCycleCountItems(id);
  const counted = items.filter((i) => i.countedQuantity !== null);
  const variances = counted.filter((i) => (i.variance ?? 0) !== 0);

  const netVariance = variances.reduce((sum, i) => sum + (i.variance ?? 0), 0);

  if (input.postAdjustments && variances.length > 0) {
    // One transaction for the whole posting: a partially-posted count would
    // leave the ledger disagreeing with the session's own totals.
    await prisma.$transaction(async (tx) => {
      for (const item of variances) {
        await executeMovement(
          {
            variantId: item.variantId,
            employeeId: actor.id,
            type: "MANUAL_ADJUSTMENT",
            quantityChanged: item.variance ?? 0,
            reason: `Cycle count ${session.reference} — counted ${item.countedQuantity}, expected ${item.expectedQuantity}`,
            referenceNumber: session.reference,
          },
          tx
        );
      }
    });
  }

  const completed = await inventoryRepository.updateCycleCount(id, {
    status: "COMPLETED",
    completedById: actor.id,
    completedAt: new Date(),
    countedItems: counted.length,
    varianceItems: variances.length,
    netVariance,
    notes: input.notes ?? session.notes,
  });

  auditRepository.create({
    performedBy: actor.id,
    action: "UPDATE",
    module: "INVENTORY",
    tableName: "cycle_counts",
    recordId: id,
    newData: {
      status: "COMPLETED",
      countedItems: counted.length,
      varianceItems: variances.length,
      netVariance,
      posted: input.postAdjustments,
    },
  });

  inventoryAlerts.cycleCountCompleted({
    cycleCountId: id,
    reference: session.reference,
    varianceItems: variances.length,
    accuracy: countAccuracy({
      totalCounted: counted.length,
      varianceLines: variances.length,
    }),
  });

  return completed;
}

// =============================================================================
// ALERT HELPER
// =============================================================================

/**
 * Raises a low/out-of-stock alert if a change pushed a variant over the line.
 *
 * Called AFTER a stock change rather than on a schedule, so the alert fires at
 * the moment the condition becomes true rather than up to a day later.
 */
async function notifyIfStockLow(variantId: string): Promise<void> {
  try {
    const variant = await inventoryRepository.findVariantById(variantId);
    if (!variant) return;

    const [reserved] = await inventoryRepository.sumActiveReservations([variantId]);
    const availability = computeAvailability({
      currentStock: variant.currentStock,
      reservedQuantity: reserved?._sum.quantity ?? 0,
    });

    const status = deriveStockStatus({
      currentStock: variant.currentStock,
      available: availability.available,
      reorderLevel: variant.reorderLevel ?? inventoryConfig().lowStockThreshold,
    });

    const payload = {
      variantId,
      productName: variant.product.name,
      sku: variant.sku,
      currentStock: variant.currentStock,
      available: availability.available,
    };

    if (status === "NEGATIVE") inventoryAlerts.negativeStock(payload);
    else if (status === "OUT_OF_STOCK") inventoryAlerts.outOfStock(payload);
    else if (status === "LOW_STOCK") {
      inventoryAlerts.lowStock({ ...payload, reorderLevel: variant.reorderLevel ?? 0 });
    }
  } catch (err) {
    // Alerting must never fail the stock operation that triggered it.
    logger.error({ err, variantId }, "[InventoryService] Low-stock alert check failed");
  }
}

// =============================================================================
// EXPORTED FOR PHASE-2 ANALYTICS (dashboard, valuation, reorder, velocity)
// =============================================================================

export {
  enrichStockRows,
  scopeFor,
  toNumber,
  daysAgo,
  daysSince,
  inventoryConfig,
  paginate,
  resolvePeriod,
};

export type { InventoryScope };

// Re-exported so the analytics service can reuse the same engine functions
// without importing the engine twice with different assumptions.
export {
  computeReorder,
  computeValuation,
  sumValuations,
  suggestedClearanceDiscount,
  classifyVelocity,
};

export type { ReorderQuery, ValuationQuery, VelocityQuery };
