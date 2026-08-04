// =============================================================================
// INVENTORY REPOSITORY
//
// Sole owner of the Prisma calls the Inventory module makes. No business logic
// — the arithmetic is in inventory.engine, orchestration and RBAC in
// inventory.service.
//
// Design decisions worth stating:
//   1. AGGREGATES FAN OUT, THEY DO NOT NEST. Stock overview attaches
//      reservations, sales velocity and last-movement to a PAGE of variants as
//      separate batched queries keyed by that page's ids. Against a
//      network-latency-bound Postgres (Neon), N+1 is the dominant cost.
//   2. RESERVATIONS ARE SUMMED, NEVER STORED. Availability is derived on every
//      read, so an expired hold stops consuming stock without a job running.
//   3. Raw SQL uses LOWERCASE table names — models are @@map'd, so "Employee"
//      does not exist as a relation in Postgres.
// =============================================================================

import { Prisma } from "../../generated/prisma";
import type {
  AdjustmentStatus,
  CycleCountStatus,
  MovementType,
  ReservationStatus,
  ReservationType,
} from "../../generated/prisma";
import { prisma } from "../config/prisma";

// =============================================================================
// SELECTS
// =============================================================================

/**
 * The stock-overview row. Includes cost price because inventory valuation is
 * the module's job; the SERVICE strips it for roles that may not see cost.
 */
const STOCK_SELECT = {
  id: true,
  sku: true,
  barcode: true,
  currentStock: true,
  reorderLevel: true,
  costPrice: true,
  sellingPrice: true,
  mrp: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  size: { select: { id: true, name: true } },
  color: { select: { id: true, name: true } },
  supplier: { select: { id: true, businessName: true } },
  product: {
    select: {
      id: true,
      name: true,
      imageUrls: true,
      category: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
    },
  },
} as const;

export type StockRow = Prisma.ProductVariantGetPayload<{ select: typeof STOCK_SELECT }>;

// =============================================================================
// STOCK OVERVIEW
// =============================================================================

export interface StockFilters {
  page: number;
  limit: number;
  search?: string | undefined;
  categoryId?: string | undefined;
  brandId?: string | undefined;
  supplierId?: string | undefined;
  isActive?: boolean | undefined;
  /** Server-filterable statuses only. Derived ones are applied in the service. */
  lowStockOnly?: boolean | undefined;
  outOfStockOnly?: boolean | undefined;
  negativeOnly?: boolean | undefined;
  createdFrom?: Date | undefined;
  createdTo?: Date | undefined;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

/**
 * WHERE clause shared by the list and its count, so the two can never disagree
 * about how many rows match.
 */
function buildStockWhere(filters: StockFilters): Prisma.ProductVariantWhereInput {
  const where: Prisma.ProductVariantWhereInput = {};

  if (filters.isActive !== undefined) where.isActive = filters.isActive;
  if (filters.supplierId) where.supplierId = filters.supplierId;

  if (filters.categoryId || filters.brandId) {
    where.product = {
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.brandId ? { brandId: filters.brandId } : {}),
    };
  }

  if (filters.createdFrom || filters.createdTo) {
    where.createdAt = {
      ...(filters.createdFrom ? { gte: filters.createdFrom } : {}),
      ...(filters.createdTo ? { lte: filters.createdTo } : {}),
    };
  }

  // Stock-level filters. `lowStockOnly` compares against the row's own
  // reorderLevel via a field reference — Prisma cannot express column-to-column
  // comparison in a plain filter, but `fields` makes it possible without SQL.
  if (filters.outOfStockOnly) where.currentStock = { lte: 0 };
  else if (filters.negativeOnly) where.currentStock = { lt: 0 };
  else if (filters.lowStockOnly) {
    where.currentStock = { lte: prisma.productVariant.fields.reorderLevel };
  }

  if (filters.search) {
    const term = filters.search.trim();
    where.OR = [
      { sku: { contains: term, mode: "insensitive" } },
      { barcode: { contains: term, mode: "insensitive" } },
      { product: { name: { contains: term, mode: "insensitive" } } },
      { product: { brand: { name: { contains: term, mode: "insensitive" } } } },
      { product: { category: { name: { contains: term, mode: "insensitive" } } } },
      { supplier: { businessName: { contains: term, mode: "insensitive" } } },
    ];
  }

  return where;
}

/** Sort fields that map to real columns; anything else is computed downstream. */
const SORTABLE: Record<string, Prisma.ProductVariantOrderByWithRelationInput> = {
  sku: { sku: "asc" },
  currentStock: { currentStock: "asc" },
  costPrice: { costPrice: "asc" },
  sellingPrice: { sellingPrice: "asc" },
  createdAt: { createdAt: "asc" },
  updatedAt: { updatedAt: "asc" },
};

function buildStockOrderBy(
  filters: StockFilters
): Prisma.ProductVariantOrderByWithRelationInput {
  const base = SORTABLE[filters.sortBy];
  if (!base) return { createdAt: filters.sortOrder };

  const [key] = Object.keys(base);
  return { [key as string]: filters.sortOrder };
}

async function findStock(filters: StockFilters) {
  const where = buildStockWhere(filters);
  const skip = (filters.page - 1) * filters.limit;

  const [total, data] = await prisma.$transaction([
    prisma.productVariant.count({ where }),
    prisma.productVariant.findMany({
      where,
      select: STOCK_SELECT,
      orderBy: buildStockOrderBy(filters),
      skip,
      take: filters.limit,
    }),
  ]);

  return { total, data };
}

/** Ids only — used when a computed sort must rank the whole filtered set. */
async function findStockIds(filters: StockFilters, cap = 2000) {
  return prisma.productVariant.findMany({
    where: buildStockWhere(filters),
    select: { id: true },
    take: cap,
  });
}

async function findVariantById(id: string) {
  return prisma.productVariant.findUnique({ where: { id }, select: STOCK_SELECT });
}

/** Barcode/SKU scan — the POS and cycle-count scanner entry point. */
async function findVariantByCode(code: string) {
  return prisma.productVariant.findFirst({
    where: { OR: [{ barcode: code }, { sku: code }] },
    select: STOCK_SELECT,
  });
}

// =============================================================================
// RESERVATIONS — availability is DERIVED from these, never stored.
// =============================================================================

/**
 * Active reserved quantity per variant.
 *
 * Expired holds are excluded by the WHERE clause rather than by a sweeper job,
 * so a forgotten reservation stops consuming stock the moment it lapses. That
 * is the whole reason availability is computed rather than cached.
 */
async function sumActiveReservations(variantIds: string[], now: Date = new Date()) {
  if (variantIds.length === 0) return [];

  return prisma.inventoryReservation.groupBy({
    by: ["variantId"],
    where: {
      variantId: { in: variantIds },
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    _sum: { quantity: true },
  });
}

const RESERVATION_SELECT = {
  id: true,
  variantId: true,
  quantity: true,
  type: true,
  status: true,
  heldFor: true,
  customerId: true,
  exchangeId: true,
  reason: true,
  expiresAt: true,
  createdAt: true,
  releasedAt: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  customer: { select: { id: true, name: true, phone: true } },
  variant: {
    select: {
      id: true,
      sku: true,
      product: { select: { id: true, name: true } },
      size: { select: { name: true } },
      color: { select: { name: true } },
    },
  },
} as const;

async function findReservations(filters: {
  page: number;
  limit: number;
  variantId?: string | undefined;
  status?: ReservationStatus | undefined;
  type?: ReservationType | undefined;
  customerId?: string | undefined;
}) {
  const where: Prisma.InventoryReservationWhereInput = {};
  if (filters.variantId) where.variantId = filters.variantId;
  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;
  if (filters.customerId) where.customerId = filters.customerId;

  const skip = (filters.page - 1) * filters.limit;

  const [total, data] = await prisma.$transaction([
    prisma.inventoryReservation.count({ where }),
    prisma.inventoryReservation.findMany({
      where,
      select: RESERVATION_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take: filters.limit,
    }),
  ]);

  return { total, data };
}

async function findReservationById(id: string) {
  return prisma.inventoryReservation.findUnique({ where: { id }, select: RESERVATION_SELECT });
}

async function createReservation(
  data: Prisma.InventoryReservationUncheckedCreateInput,
  tx: Prisma.TransactionClient = prisma
) {
  return tx.inventoryReservation.create({ data, select: RESERVATION_SELECT });
}

async function updateReservationStatus(
  id: string,
  data: {
    status: ReservationStatus;
    releasedById?: string | null;
    releasedAt?: Date | null;
  },
  tx: Prisma.TransactionClient = prisma
) {
  return tx.inventoryReservation.update({
    where: { id },
    data,
    select: RESERVATION_SELECT,
  });
}

/** Lapses expired holds in bulk. Idempotent — safe to run on any schedule. */
async function expireStaleReservations(now: Date = new Date()) {
  const result = await prisma.inventoryReservation.updateMany({
    where: { status: "ACTIVE", expiresAt: { not: null, lte: now } },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

// =============================================================================
// MOVEMENTS — reads only. Writes go through inventoryMovement.service.
// =============================================================================

const MOVEMENT_SELECT = {
  id: true,
  variantId: true,
  type: true,
  quantityChanged: true,
  stockBefore: true,
  stockAfter: true,
  reason: true,
  referenceNumber: true,
  relatedPurchaseId: true,
  relatedSaleId: true,
  relatedExchangeId: true,
  createdAt: true,
  employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
  variant: {
    select: {
      id: true,
      sku: true,
      barcode: true,
      product: { select: { id: true, name: true, imageUrls: true } },
      size: { select: { name: true } },
      color: { select: { name: true } },
    },
  },
} as const;

async function findMovements(filters: {
  page: number;
  limit: number;
  variantId?: string | undefined;
  type?: MovementType | undefined;
  employeeId?: string | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
  search?: string | undefined;
}) {
  const where: Prisma.InventoryMovementWhereInput = {};

  if (filters.variantId) where.variantId = filters.variantId;
  if (filters.type) where.type = filters.type;
  if (filters.employeeId) where.employeeId = filters.employeeId;

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }

  if (filters.search) {
    const term = filters.search.trim();
    where.OR = [
      { referenceNumber: { contains: term, mode: "insensitive" } },
      { variant: { sku: { contains: term, mode: "insensitive" } } },
      { variant: { product: { name: { contains: term, mode: "insensitive" } } } },
    ];
  }

  const skip = (filters.page - 1) * filters.limit;

  const [total, data] = await prisma.$transaction([
    prisma.inventoryMovement.count({ where }),
    prisma.inventoryMovement.findMany({
      where,
      select: MOVEMENT_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take: filters.limit,
    }),
  ]);

  return { total, data };
}

/** Most recent movement per variant — the "Last Movement" column. */
async function findLastMovements(variantIds: string[]) {
  if (variantIds.length === 0) return [];

  // ROW_NUMBER() picks the newest row per variant in one index-ordered pass.
  //
  // This was `SELECT DISTINCT ON (m."variantId")`, which is Postgres-only. The
  // window-function form is equivalent, uses the same index, and runs on BOTH
  // Postgres and SQLite — so the offline path shares this query rather than
  // maintaining a second copy of it. Likewise `= ANY(${ids}::text[])` became
  // `IN (…)`: SQLite cannot bind an array parameter, and Prisma.join expands to
  // placeholders both engines accept. The empty case is handled by the guard
  // above, which matters because Prisma.join([]) would emit `IN ()`.
  return prisma.$queryRaw<
    Array<{ variantId: string; type: MovementType; createdAt: Date; quantityChanged: number }>
  >`
    SELECT "variantId", "type", "createdAt", "quantityChanged"
    FROM (
      SELECT
        m."variantId", m."type", m."createdAt", m."quantityChanged",
        ROW_NUMBER() OVER (
          PARTITION BY m."variantId" ORDER BY m."createdAt" DESC
        ) AS rn
      FROM "inventory_movements" m
      WHERE m."variantId" IN (${Prisma.join(variantIds)})
    ) ranked
    WHERE rn = 1
  `;
}

/** Movement totals by type over a window — the dashboard's in/out counters. */
async function sumMovementsByType(dateFrom: Date, dateTo: Date) {
  return prisma.inventoryMovement.groupBy({
    by: ["type"],
    where: { createdAt: { gte: dateFrom, lte: dateTo } },
    _sum: { quantityChanged: true },
    _count: { _all: true },
  });
}

/** Daily movement trend for the dashboard chart. */
async function movementTrend(dateFrom: Date, dateTo: Date) {
  return prisma.$queryRaw<
    Array<{ day: Date; stockIn: bigint; stockOut: bigint }>
  >`
    SELECT
      DATE_TRUNC('day', m."createdAt")                                        AS day,
      COALESCE(SUM(m."quantityChanged") FILTER (WHERE m."quantityChanged" > 0), 0)::bigint AS "stockIn",
      COALESCE(ABS(SUM(m."quantityChanged") FILTER (WHERE m."quantityChanged" < 0)), 0)::bigint AS "stockOut"
    FROM "inventory_movements" m
    WHERE m."createdAt" >= ${dateFrom} AND m."createdAt" <= ${dateTo}
    GROUP BY day
    ORDER BY day ASC
  `;
}

// =============================================================================
// SALES VELOCITY — reads the EXISTING sales tables. No duplicated totals.
// =============================================================================

/**
 * Units sold and last sale date per variant over a window.
 *
 * Drives velocity classification, reorder maths and the dead-stock report from
 * ONE query rather than three, because all three need the same two facts.
 */
async function salesVelocity(variantIds: string[], dateFrom: Date, dateTo: Date) {
  if (variantIds.length === 0) return [];

  return prisma.$queryRaw<
    Array<{ variantId: string; unitsSold: bigint; lastSaleAt: Date | null; revenue: number }>
  >`
    SELECT
      si."variantId",
      COALESCE(SUM(si."quantity"), 0)::bigint                       AS "unitsSold",
      MAX(s."saleDate")                                             AS "lastSaleAt",
      COALESCE(SUM(si."quantity" * si."sellingPrice"), 0)::float    AS revenue
    FROM "sale_items" si
    INNER JOIN "sales" s ON s."id" = si."saleId"
    WHERE si."variantId" IN (${Prisma.join(variantIds)})
      AND s."status" = 'COMPLETED'
      AND s."saleDate" >= ${dateFrom}
      AND s."saleDate" <= ${dateTo}
    GROUP BY si."variantId"
  `;
}

/**
 * Last sale date per variant with NO window — needed for dead stock, where the
 * question is "how long since this last sold", not "did it sell recently".
 */
async function lastSaleDates(variantIds: string[]) {
  if (variantIds.length === 0) return [];

  return prisma.$queryRaw<Array<{ variantId: string; lastSaleAt: Date }>>`
    SELECT si."variantId", MAX(s."saleDate") AS "lastSaleAt"
    FROM "sale_items" si
    INNER JOIN "sales" s ON s."id" = si."saleId"
    WHERE si."variantId" IN (${Prisma.join(variantIds)})
      AND s."status" = 'COMPLETED'
    GROUP BY si."variantId"
  `;
}

// =============================================================================
// DASHBOARD AGGREGATES
// =============================================================================

/**
 * Whole-inventory totals in ONE round trip.
 *
 * Deliberately raw SQL: this is the dashboard's headline strip, and issuing six
 * separate aggregate queries for six cards is the difference between a snappy
 * page and a slow one on a latency-bound database.
 */
async function inventoryTotals() {
  const rows = await prisma.$queryRaw<
    Array<{
      total_skus: bigint;
      total_units: bigint;
      stock_value: number;
      retail_value: number;
      out_of_stock: bigint;
      low_stock: bigint;
      negative_stock: bigint;
    }>
  >`
    SELECT
      COUNT(*)::bigint                                            AS total_skus,
      COALESCE(SUM(GREATEST(v."currentStock", 0)), 0)::bigint     AS total_units,
      COALESCE(SUM(GREATEST(v."currentStock", 0) * v."costPrice"), 0)::float    AS stock_value,
      COALESCE(SUM(GREATEST(v."currentStock", 0) * v."sellingPrice"), 0)::float AS retail_value,
      COUNT(*) FILTER (WHERE v."currentStock" <= 0)::bigint       AS out_of_stock,
      COUNT(*) FILTER (
        WHERE v."currentStock" > 0
          AND v."currentStock" <= COALESCE(v."reorderLevel", 5)
      )::bigint                                                   AS low_stock,
      COUNT(*) FILTER (WHERE v."currentStock" < 0)::bigint        AS negative_stock
    FROM "product_variants" v
    WHERE v."isActive" = true
  `;

  const row = rows[0];
  return {
    totalSkus: Number(row?.total_skus ?? 0),
    totalUnits: Number(row?.total_units ?? 0),
    stockValue: Number(row?.stock_value ?? 0),
    retailValue: Number(row?.retail_value ?? 0),
    outOfStock: Number(row?.out_of_stock ?? 0),
    lowStock: Number(row?.low_stock ?? 0),
    negativeStock: Number(row?.negative_stock ?? 0),
  };
}

/** Total units currently held across all active reservations. */
async function totalReservedUnits(now: Date = new Date()) {
  const result = await prisma.inventoryReservation.aggregate({
    where: {
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

/** Damaged units not yet written off. */
async function totalDamagedUnits() {
  const result = await prisma.damagedStock.aggregate({
    where: { isWrittenOff: false },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

/** Stock value grouped by category — the dashboard's category chart. */
async function valueByCategory(limit = 8) {
  return prisma.$queryRaw<
    Array<{ categoryId: string | null; categoryName: string | null; units: bigint; stockValue: number }>
  >`
    SELECT
      c."id"                                                     AS "categoryId",
      c."name"                                                   AS "categoryName",
      COALESCE(SUM(GREATEST(v."currentStock", 0)), 0)::bigint    AS units,
      COALESCE(SUM(GREATEST(v."currentStock", 0) * v."costPrice"), 0)::float AS "stockValue"
    FROM "product_variants" v
    INNER JOIN "products"   p ON p."id" = v."productId"
    LEFT  JOIN "categories" c ON c."id" = p."categoryId"
    WHERE v."isActive" = true
    GROUP BY c."id", c."name"
    ORDER BY "stockValue" DESC
    LIMIT ${limit}
  `;
}

// =============================================================================
// SNAPSHOTS — the only honest source for a value-over-time chart.
// =============================================================================

async function findSnapshots(dateFrom: Date, dateTo: Date) {
  return prisma.inventorySnapshot.findMany({
    where: { variantId: null, snapshotDate: { gte: dateFrom, lte: dateTo } },
    orderBy: { snapshotDate: "asc" },
  });
}

/** Idempotent by the (snapshotDate, variantId) unique constraint. */
async function upsertSnapshot(data: {
  snapshotDate: Date;
  variantId: string | null;
  quantity: number;
  stockValue: Prisma.Decimal | number;
  retailValue: Prisma.Decimal | number;
  averageCost?: Prisma.Decimal | number | null;
  storeCode?: string | null;
}) {
  return prisma.inventorySnapshot.upsert({
    where: {
      snapshotDate_variantId: {
        snapshotDate: data.snapshotDate,
        variantId: data.variantId as string,
      },
    },
    create: data as Prisma.InventorySnapshotUncheckedCreateInput,
    update: {
      quantity: data.quantity,
      stockValue: data.stockValue,
      retailValue: data.retailValue,
      averageCost: data.averageCost ?? null,
    },
  });
}

// =============================================================================
// ADJUSTMENTS
// =============================================================================

const ADJUSTMENT_SELECT = {
  id: true,
  variantId: true,
  quantityChange: true,
  stockAtRequest: true,
  reason: true,
  notes: true,
  status: true,
  reviewNotes: true,
  reviewedAt: true,
  movementId: true,
  createdAt: true,
  requestedBy: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
  reviewedBy: { select: { id: true, firstName: true, lastName: true } },
  variant: {
    select: {
      id: true,
      sku: true,
      currentStock: true,
      product: { select: { id: true, name: true, imageUrls: true } },
      size: { select: { name: true } },
      color: { select: { name: true } },
    },
  },
} as const;

async function findAdjustments(filters: {
  page: number;
  limit: number;
  status?: AdjustmentStatus | undefined;
  variantId?: string | undefined;
  requestedById?: string | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
}) {
  const where: Prisma.StockAdjustmentWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.variantId) where.variantId = filters.variantId;
  if (filters.requestedById) where.requestedById = filters.requestedById;
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }

  const skip = (filters.page - 1) * filters.limit;

  const [total, data] = await prisma.$transaction([
    prisma.stockAdjustment.count({ where }),
    prisma.stockAdjustment.findMany({
      where,
      select: ADJUSTMENT_SELECT,
      // Pending first, then newest — the approval queue's natural order.
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip,
      take: filters.limit,
    }),
  ]);

  return { total, data };
}

async function findAdjustmentById(id: string) {
  return prisma.stockAdjustment.findUnique({ where: { id }, select: ADJUSTMENT_SELECT });
}

async function createAdjustment(data: Prisma.StockAdjustmentUncheckedCreateInput) {
  return prisma.stockAdjustment.create({ data, select: ADJUSTMENT_SELECT });
}

async function updateAdjustment(
  id: string,
  data: Prisma.StockAdjustmentUncheckedUpdateInput,
  tx: Prisma.TransactionClient = prisma
) {
  return tx.stockAdjustment.update({ where: { id }, data, select: ADJUSTMENT_SELECT });
}

async function countPendingAdjustments() {
  return prisma.stockAdjustment.count({ where: { status: "PENDING" } });
}

// =============================================================================
// CYCLE COUNTS
// =============================================================================

const CYCLE_COUNT_SELECT = {
  id: true,
  reference: true,
  name: true,
  status: true,
  categoryId: true,
  brandId: true,
  supplierId: true,
  startedAt: true,
  completedAt: true,
  totalItems: true,
  countedItems: true,
  varianceItems: true,
  netVariance: true,
  notes: true,
  startedBy: { select: { id: true, firstName: true, lastName: true } },
  completedBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

async function findCycleCounts(filters: {
  page: number;
  limit: number;
  status?: CycleCountStatus | undefined;
}) {
  const where: Prisma.CycleCountWhereInput = {};
  if (filters.status) where.status = filters.status;

  const skip = (filters.page - 1) * filters.limit;

  const [total, data] = await prisma.$transaction([
    prisma.cycleCount.count({ where }),
    prisma.cycleCount.findMany({
      where,
      select: CYCLE_COUNT_SELECT,
      orderBy: { startedAt: "desc" },
      skip,
      take: filters.limit,
    }),
  ]);

  return { total, data };
}

async function findCycleCountById(id: string) {
  return prisma.cycleCount.findUnique({ where: { id }, select: CYCLE_COUNT_SELECT });
}

async function createCycleCount(data: Prisma.CycleCountUncheckedCreateInput) {
  return prisma.cycleCount.create({ data, select: CYCLE_COUNT_SELECT });
}

async function updateCycleCount(
  id: string,
  data: Prisma.CycleCountUncheckedUpdateInput,
  tx: Prisma.TransactionClient = prisma
) {
  return tx.cycleCount.update({ where: { id }, data, select: CYCLE_COUNT_SELECT });
}

const COUNT_ITEM_SELECT = {
  id: true,
  cycleCountId: true,
  variantId: true,
  expectedQuantity: true,
  countedQuantity: true,
  variance: true,
  notes: true,
  countedAt: true,
  countedBy: { select: { id: true, firstName: true, lastName: true } },
  variant: {
    select: {
      id: true,
      sku: true,
      barcode: true,
      currentStock: true,
      product: { select: { id: true, name: true, imageUrls: true } },
      size: { select: { name: true } },
      color: { select: { name: true } },
    },
  },
} as const;

async function findCycleCountItems(cycleCountId: string) {
  return prisma.cycleCountItem.findMany({
    where: { cycleCountId },
    select: COUNT_ITEM_SELECT,
    orderBy: { createdAt: "asc" },
  });
}

/** Seeds a session's lines from the variants in scope. */
async function createCycleCountItems(rows: Prisma.CycleCountItemUncheckedCreateInput[]) {
  if (rows.length === 0) return 0;
  const result = await prisma.cycleCountItem.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

/**
 * Records a physical count. Upsert, not create — scanning the same barcode
 * twice must correct the line, not add a duplicate.
 */
async function upsertCycleCountItem(data: {
  cycleCountId: string;
  variantId: string;
  expectedQuantity: number;
  countedQuantity: number;
  variance: number;
  countedById: string;
  notes?: string | null;
}) {
  return prisma.cycleCountItem.upsert({
    where: {
      cycleCountId_variantId: {
        cycleCountId: data.cycleCountId,
        variantId: data.variantId,
      },
    },
    create: {
      cycleCountId: data.cycleCountId,
      variantId: data.variantId,
      expectedQuantity: data.expectedQuantity,
      countedQuantity: data.countedQuantity,
      variance: data.variance,
      countedById: data.countedById,
      countedAt: new Date(),
      notes: data.notes ?? null,
    },
    update: {
      countedQuantity: data.countedQuantity,
      variance: data.variance,
      countedById: data.countedById,
      countedAt: new Date(),
      notes: data.notes ?? null,
    },
    select: COUNT_ITEM_SELECT,
  });
}

// =============================================================================
// DAMAGED STOCK
// =============================================================================

const DAMAGED_SELECT = {
  id: true,
  variantId: true,
  quantity: true,
  reason: true,
  isWrittenOff: true,
  writtenOffAt: true,
  reportedAt: true,
  movementId: true,
  reportedBy: { select: { id: true, firstName: true, lastName: true } },
  variant: {
    select: {
      id: true,
      sku: true,
      costPrice: true,
      product: { select: { id: true, name: true, imageUrls: true } },
      size: { select: { name: true } },
      color: { select: { name: true } },
    },
  },
} as const;

async function findDamagedStock(filters: {
  page: number;
  limit: number;
  variantId?: string | undefined;
  isWrittenOff?: boolean | undefined;
}) {
  const where: Prisma.DamagedStockWhereInput = {};
  if (filters.variantId) where.variantId = filters.variantId;
  if (filters.isWrittenOff !== undefined) where.isWrittenOff = filters.isWrittenOff;

  const skip = (filters.page - 1) * filters.limit;

  const [total, data] = await prisma.$transaction([
    prisma.damagedStock.count({ where }),
    prisma.damagedStock.findMany({
      where,
      select: DAMAGED_SELECT,
      orderBy: { reportedAt: "desc" },
      skip,
      take: filters.limit,
    }),
  ]);

  return { total, data };
}

async function createDamagedStock(
  data: Prisma.DamagedStockUncheckedCreateInput,
  tx: Prisma.TransactionClient = prisma
) {
  return tx.damagedStock.create({ data, select: DAMAGED_SELECT });
}

// =============================================================================
// PURCHASE / SALE HISTORY for the details drawer
// =============================================================================

async function findVariantPurchases(variantId: string, limit = 25) {
  return prisma.purchaseItem.findMany({
    where: { variantId },
    select: {
      id: true,
      quantity: true,
      costPrice: true,
      purchase: {
        select: {
          id: true,
          // Both: purchaseNumber is OUR reference (the PO), supplierInvoiceNumber
          // is theirs. The drawer shows each under its own label because
          // reconciling a delivery needs both.
          purchaseNumber: true,
          supplierInvoiceNumber: true,
          purchaseDate: true,
          supplier: { select: { id: true, businessName: true } },
        },
      },
    },
    orderBy: { purchase: { purchaseDate: "desc" } },
    take: limit,
  });
}

async function findVariantSales(variantId: string, limit = 25) {
  return prisma.saleItem.findMany({
    where: { variantId, sale: { status: "COMPLETED" } },
    select: {
      id: true,
      quantity: true,
      sellingPrice: true,
      sale: {
        select: {
          id: true,
          saleNumber: true,
          saleDate: true,
          customer: { select: { id: true, name: true } },
          employee: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { sale: { saleDate: "desc" } },
    take: limit,
  });
}

/**
 * Purchase orders awaiting stock — the dashboard's "pending receipts" counter.
 *
 * ORDERED and PARTIAL only. DRAFT is not yet committed to a supplier, so
 * counting it would promise incoming stock that nobody has actually ordered.
 */
async function countPendingPurchases() {
  return prisma.purchase.count({ where: { status: { in: ["ORDERED", "PARTIAL"] } } });
}

export const inventoryRepository = {
  // stock
  findStock,
  findStockIds,
  findVariantById,
  findVariantByCode,
  // reservations
  sumActiveReservations,
  findReservations,
  findReservationById,
  createReservation,
  updateReservationStatus,
  expireStaleReservations,
  // movements
  findMovements,
  findLastMovements,
  sumMovementsByType,
  movementTrend,
  // velocity
  salesVelocity,
  lastSaleDates,
  // dashboard
  inventoryTotals,
  totalReservedUnits,
  totalDamagedUnits,
  valueByCategory,
  countPendingPurchases,
  // snapshots
  findSnapshots,
  upsertSnapshot,
  // adjustments
  findAdjustments,
  findAdjustmentById,
  createAdjustment,
  updateAdjustment,
  countPendingAdjustments,
  // cycle counts
  findCycleCounts,
  findCycleCountById,
  createCycleCount,
  updateCycleCount,
  findCycleCountItems,
  createCycleCountItems,
  upsertCycleCountItem,
  // damaged
  findDamagedStock,
  createDamagedStock,
  // drawer history
  findVariantPurchases,
  findVariantSales,
} as const;
