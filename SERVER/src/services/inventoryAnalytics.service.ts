// =============================================================================
// INVENTORY ANALYTICS SERVICE
//
// The reporting half of the Inventory module: dashboard, valuation, reorder
// centre, and the fast/slow/dead velocity reports.
//
// Split from inventory.service deliberately. That file owns WRITES — the
// ledger, approvals, counts — and this one owns aggregate READS. Keeping them
// apart means the expensive analytics queries cannot accidentally end up
// inside a stock-mutating transaction.
//
// Every figure here is computed by inventory.engine. This service fetches and
// joins; it does not define what "low stock" or "dead stock" means.
// =============================================================================

import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { inventoryRepository } from "../repositories/inventory.repository";
import {
  classifyAbc,
  classifyVelocity,
  computeAvailability,
  computeReorder,
  computeValuation,
  daysOfInventory,
  deriveStockStatus,
  suggestedClearanceDiscount,
  sumValuations,
} from "../engines/inventory.engine";
import {
  daysAgo,
  daysSince,
  inventoryConfig,
  paginate,
  resolvePeriod,
  scopeFor,
  toNumber,
} from "./inventory.service";
import type { AuthenticatedUser } from "../types/employee.types";
import type {
  DashboardQuery,
  ReorderQuery,
  ValuationQuery,
  VelocityQuery,
} from "../validation/inventory.validation";

/**
 * Upper bound on how many variants an analytics pass will load.
 *
 * Analytics ranks across the WHOLE catalogue (a "slowest mover" computed over
 * one page is meaningless), so the query is unbounded by nature. This cap is
 * what stops that from becoming an unbounded read on a large catalogue.
 */
const ANALYTICS_CAP = 2000;

/** Cost figures are owner-only everywhere, including reports. */
function assertCanSeeCost(actor: AuthenticatedUser): void {
  if (!scopeFor(actor).canSeeCost) {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      "Inventory valuation is available to the owner only."
    );
  }
}

// =============================================================================
// DASHBOARD
// =============================================================================

/**
 * The KPI strip and charts.
 *
 * Counters come from ONE aggregate query rather than one per card — this sits
 * above a polled page, so it must not cost a table scan per tile.
 */
export async function getDashboard(query: DashboardQuery, actor: AuthenticatedUser) {
  const scope = scopeFor(actor);
  const window = resolvePeriod(query.period, query.dateFrom, query.dateTo);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    totals, reservedUnits, damagedUnits, pendingPurchases, pendingAdjustments,
    movementsToday, movementTrend, categoryValue, snapshots,
  ] = await Promise.all([
    inventoryRepository.inventoryTotals(),
    inventoryRepository.totalReservedUnits(),
    inventoryRepository.totalDamagedUnits(),
    inventoryRepository.countPendingPurchases(),
    inventoryRepository.countPendingAdjustments(),
    inventoryRepository.sumMovementsByType(todayStart, new Date()),
    inventoryRepository.movementTrend(window.from, window.to),
    inventoryRepository.valueByCategory(8),
    inventoryRepository.findSnapshots(window.from, window.to),
  ]);

  // Stock in / out today, from the ledger rather than a separate counter.
  const stockInToday = movementsToday
    .filter((m) => (m._sum.quantityChanged ?? 0) > 0)
    .reduce((sum, m) => sum + (m._sum.quantityChanged ?? 0), 0);

  const stockOutToday = Math.abs(
    movementsToday
      .filter((m) => (m._sum.quantityChanged ?? 0) < 0)
      .reduce((sum, m) => sum + (m._sum.quantityChanged ?? 0), 0)
  );

  /**
   * Inventory accuracy — from the most recent completed count.
   *
   * NULL when nothing has ever been counted. Showing 100% would claim a
   * verified-accurate inventory that nobody has actually checked.
   */
  const recentCounts = await inventoryRepository.findCycleCounts({
    page: 1, limit: 1, status: "COMPLETED",
  });
  const lastCount = recentCounts.data[0];
  const accuracy =
    lastCount && lastCount.countedItems > 0
      ? Math.round(
          ((lastCount.countedItems - lastCount.varianceItems) / lastCount.countedItems) * 1000
        ) / 10
      : null;

  return {
    period: window,

    totalSkus: totals.totalSkus,
    totalUnits: totals.totalUnits,
    lowStock: totals.lowStock,
    outOfStock: totals.outOfStock,
    negativeStock: totals.negativeStock,
    reservedUnits,
    damagedUnits,
    pendingPurchaseReceipts: pendingPurchases,
    pendingAdjustments,

    stockInToday,
    stockOutToday,

    inventoryAccuracy: accuracy,
    lastCountedAt: lastCount?.completedAt ?? null,

    // Valuation is owner-only; the keys are absent entirely otherwise.
    ...(scope.canSeeCost
      ? {
          inventoryValue: totals.stockValue,
          retailValue: totals.retailValue,
          potentialProfit: Math.round((totals.retailValue - totals.stockValue) * 100) / 100,
        }
      : {}),

    charts: {
      movementTrend: movementTrend.map((t) => ({
        date: t.day,
        stockIn: Number(t.stockIn),
        stockOut: Number(t.stockOut),
      })),
      // Value trend can only come from snapshots — cost prices are a moving
      // average that gets overwritten, so yesterday's value is not
      // recoverable by replaying the ledger.
      valueTrend: scope.canSeeCost
        ? snapshots.map((s) => ({
            date: s.snapshotDate,
            stockValue: toNumber(s.stockValue),
            retailValue: toNumber(s.retailValue),
          }))
        : [],
      topCategories: categoryValue.map((c) => ({
        categoryId: c.categoryId,
        categoryName: c.categoryName ?? "Uncategorised",
        units: Number(c.units),
        ...(scope.canSeeCost ? { stockValue: c.stockValue } : {}),
      })),
    },
  };
}

// =============================================================================
// VALUATION
// =============================================================================

/**
 * Inventory valuation, with a breakdown by category / brand / supplier.
 *
 * Average-cost method: `costPrice` is already maintained as a moving average
 * by the purchase module, so this reads it rather than recomputing. A future
 * FIFO implementation replaces the cost SOURCE without changing this shape —
 * which is why every figure comes from computeValuation() rather than being
 * multiplied out inline.
 */
export async function getValuation(query: ValuationQuery, actor: AuthenticatedUser) {
  assertCanSeeCost(actor);

  const { data: rows } = await inventoryRepository.findStock({
    page: 1,
    limit: ANALYTICS_CAP,
    isActive: true,
    categoryId: query.categoryId,
    brandId: query.brandId,
    supplierId: query.supplierId,
    sortBy: "sku",
    sortOrder: "asc",
  });

  const valued = rows.map((row) => {
    const valuation = computeValuation({
      quantity: row.currentStock,
      costPrice: toNumber(row.costPrice),
      sellingPrice: toNumber(row.sellingPrice),
    });

    return {
      row,
      valuation,
      groupId:
        query.groupBy === "category"
          ? (row.product.category?.id ?? null)
          : query.groupBy === "brand"
            ? (row.product.brand?.id ?? null)
            : query.groupBy === "supplier"
              ? (row.supplier?.id ?? null)
              : null,
      groupName:
        query.groupBy === "category"
          ? (row.product.category?.name ?? "Uncategorised")
          : query.groupBy === "brand"
            ? (row.product.brand?.name ?? "No brand")
            : query.groupBy === "supplier"
              ? (row.supplier?.businessName ?? "No supplier")
              : "All inventory",
    };
  });

  const totals = sumValuations(valued.map((v) => v.valuation));

  // ── Group breakdown ──────────────────────────────────────────────────────
  const groups = new Map<string, { name: string; items: typeof valued }>();
  for (const item of valued) {
    const key = item.groupId ?? "__none__";
    const bucket = groups.get(key) ?? { name: item.groupName, items: [] };
    bucket.items.push(item);
    groups.set(key, bucket);
  }

  const breakdown = [...groups.entries()]
    .map(([id, bucket]) => {
      const groupTotals = sumValuations(bucket.items.map((i) => i.valuation));
      return {
        id: id === "__none__" ? null : id,
        name: bucket.name,
        skuCount: bucket.items.length,
        ...groupTotals,
        // Share of total value — what makes the breakdown readable at a glance.
        sharePercentage:
          totals.stockValue > 0
            ? Math.round((groupTotals.stockValue / totals.stockValue) * 1000) / 10
            : 0,
      };
    })
    .sort((a, b) => b.stockValue - a.stockValue);

  // ── ABC classification over the whole set ────────────────────────────────
  const sortedByValue = [...valued].sort(
    (a, b) => b.valuation.stockValue - a.valuation.stockValue
  );
  const abcClasses = classifyAbc(sortedByValue.map((v) => v.valuation.stockValue));

  const abcSummary = { A: 0, B: 0, C: 0 };
  abcClasses.forEach((cls) => { abcSummary[cls] += 1; });

  return {
    method: "AVERAGE_COST" as const,
    totals: {
      skuCount: valued.length,
      ...totals,
      averageCost:
        totals.quantity > 0
          ? Math.round((totals.stockValue / totals.quantity) * 100) / 100
          : 0,
    },
    breakdown,
    abc: abcSummary,
    // Top items by value — where the money actually sits.
    topByValue: sortedByValue.slice(0, 20).map((item, index) => ({
      variantId: item.row.id,
      sku: item.row.sku,
      productName: item.row.product.name,
      quantity: item.valuation.quantity,
      stockValue: item.valuation.stockValue,
      retailValue: item.valuation.retailValue,
      abcClass: abcClasses[index] ?? "C",
    })),
  };
}

// =============================================================================
// REORDER CENTRE
// =============================================================================

/**
 * What to buy, and how much.
 *
 * Ranked across the whole catalogue rather than a page, because "what needs
 * ordering" is inherently a global question — paging first would hide the most
 * urgent item behind an alphabetical accident.
 */
export async function getReorderSuggestions(query: ReorderQuery, actor: AuthenticatedUser) {
  const scope = scopeFor(actor);

  const { data: rows } = await inventoryRepository.findStock({
    page: 1,
    limit: ANALYTICS_CAP,
    isActive: true,
    categoryId: query.categoryId,
    supplierId: query.supplierId,
    sortBy: "sku",
    sortOrder: "asc",
  });

  if (rows.length === 0) return paginate([], 0, query.page, query.limit);

  const ids = rows.map((r) => r.id);
  const windowFrom = daysAgo(query.windowDays);

  const [velocity, reservations] = await Promise.all([
    inventoryRepository.salesVelocity(ids, windowFrom, new Date()),
    inventoryRepository.sumActiveReservations(ids),
  ]);

  const velocityBy = new Map(velocity.map((v) => [v.variantId, v]));
  const reservedBy = new Map(reservations.map((r) => [r.variantId, r._sum.quantity ?? 0]));

  const suggestions = rows.map((row) => {
    const sales = velocityBy.get(row.id);
    const unitsSold = Number(sales?.unitsSold ?? 0);
    const reserved = reservedBy.get(row.id) ?? 0;

    const reorder = computeReorder({
      currentStock: row.currentStock,
      reserved,
      averageDailySales: unitsSold / query.windowDays,
      leadTimeDays: query.leadTimeDays,
      safetyDays: query.safetyDays,
      reorderLevel: row.reorderLevel,
    });

    return {
      variantId: row.id,
      sku: row.sku,
      barcode: row.barcode,
      productName: row.product.name,
      imageUrl: row.product.imageUrls?.[0] ?? null,
      variantName: `${row.size?.name ?? ""} / ${row.color?.name ?? ""}`.trim(),
      categoryName: row.product.category?.name ?? null,
      supplierId: row.supplier?.id ?? null,
      supplierName: row.supplier?.businessName ?? null,

      currentStock: row.currentStock,
      reserved,
      ...reorder,
      unitsSold,

      // Estimated spend is a cost figure — owner-only like the rest.
      ...(scope.canSeeCost
        ? {
            costPrice: toNumber(row.costPrice),
            estimatedCost:
              Math.round(reorder.recommendedQuantity * toNumber(row.costPrice) * 100) / 100,
          }
        : {}),
    };
  });

  const filtered = query.dueOnly ? suggestions.filter((s) => s.shouldReorder) : suggestions;

  // Most urgent first: fewest days of cover. Items that never sell (null days)
  // sort last — they are a clearance problem, not a reordering one.
  filtered.sort((a, b) => {
    if (a.daysRemaining === null) return 1;
    if (b.daysRemaining === null) return -1;
    return a.daysRemaining - b.daysRemaining;
  });

  const start = (query.page - 1) * query.limit;
  return paginate(
    filtered.slice(start, start + query.limit),
    filtered.length,
    query.page,
    query.limit
  );
}

// =============================================================================
// VELOCITY REPORTS — fast / slow / dead
// =============================================================================

/**
 * One function for all three buckets.
 *
 * They differ only in which classification they keep, so implementing them
 * separately would mean three chances for "dead stock" to be defined
 * differently from the badge shown on the stock table.
 */
export async function getVelocityReport(query: VelocityQuery, actor: AuthenticatedUser) {
  const scope = scopeFor(actor);

  const { data: rows } = await inventoryRepository.findStock({
    page: 1,
    limit: ANALYTICS_CAP,
    isActive: true,
    categoryId: query.categoryId,
    brandId: query.brandId,
    sortBy: "sku",
    sortOrder: "asc",
  });

  if (rows.length === 0) return paginate([], 0, query.page, query.limit);

  const ids = rows.map((r) => r.id);
  const windowFrom = daysAgo(query.windowDays);

  const [velocity, lastSales] = await Promise.all([
    inventoryRepository.salesVelocity(ids, windowFrom, new Date()),
    inventoryRepository.lastSaleDates(ids),
  ]);

  const velocityBy = new Map(velocity.map((v) => [v.variantId, v]));
  const lastSaleBy = new Map(lastSales.map((s) => [s.variantId, s.lastSaleAt]));

  const classified = rows.map((row) => {
    const sales = velocityBy.get(row.id);
    const unitsSold = Number(sales?.unitsSold ?? 0);
    const lastSaleAt = lastSaleBy.get(row.id) ?? null;
    const sinceLastSale = daysSince(lastSaleAt);

    const bucket = classifyVelocity({
      unitsSold,
      windowDays: query.windowDays,
      daysSinceLastSale: sinceLastSale,
      currentStock: row.currentStock,
    });

    const valuation = computeValuation({
      quantity: row.currentStock,
      costPrice: toNumber(row.costPrice),
      sellingPrice: toNumber(row.sellingPrice),
    });

    const dailySales = unitsSold / query.windowDays;

    return {
      variantId: row.id,
      sku: row.sku,
      productName: row.product.name,
      imageUrl: row.product.imageUrls?.[0] ?? null,
      variantName: `${row.size?.name ?? ""} / ${row.color?.name ?? ""}`.trim(),
      categoryName: row.product.category?.name ?? null,
      brandName: row.product.brand?.name ?? null,
      supplierName: row.supplier?.businessName ?? null,

      currentStock: row.currentStock,
      velocity: bucket,
      unitsSold,
      revenue: Number(sales?.revenue ?? 0),
      lastSaleAt,
      daysSinceLastSale: sinceLastSale,
      daysOfInventory: daysOfInventory({
        currentStock: row.currentStock,
        averageDailySales: dailySales,
      }),
      /** Days to clear the shelf at the observed rate. NULL when nothing sells. */
      daysToSell:
        dailySales > 0 ? Math.round((row.currentStock / dailySales) * 10) / 10 : null,

      retailValue: valuation.retailValue,
      ...(scope.canSeeCost ? { stockValue: valuation.stockValue } : {}),

      // Only meaningful for the stagnant buckets; 0 elsewhere.
      suggestedDiscount:
        bucket === "DEAD_STOCK" || bucket === "SLOW_MOVING"
          ? suggestedClearanceDiscount(sinceLastSale)
          : 0,
    };
  });

  const matching = classified.filter((row) => row.velocity === query.bucket);

  // Fast movers rank by units sold (the top sellers); stagnant buckets rank by
  // capital tied up, because that is what a clearance decision is about.
  matching.sort((a, b) =>
    query.bucket === "FAST_MOVING"
      ? b.unitsSold - a.unitsSold
      : b.retailValue - a.retailValue
  );

  const start = (query.page - 1) * query.limit;
  return paginate(
    matching.slice(start, start + query.limit),
    matching.length,
    query.page,
    query.limit
  );
}

// =============================================================================
// LOW STOCK / OUT OF STOCK
// =============================================================================

/**
 * The low-stock and out-of-stock pages.
 *
 * Shares the reorder maths so the "recommended order" on this page and the one
 * in the Reorder Centre are the same number — two different figures for the
 * same decision is how a feature loses trust.
 */
export async function getLowStockReport(
  params: { page: number; limit: number; outOfStockOnly?: boolean | undefined; windowDays?: number },
  actor: AuthenticatedUser
) {
  const scope = scopeFor(actor);
  const windowDays = params.windowDays ?? 30;

  const { data: rows } = await inventoryRepository.findStock({
    page: 1,
    limit: ANALYTICS_CAP,
    isActive: true,
    ...(params.outOfStockOnly ? { outOfStockOnly: true } : { lowStockOnly: true }),
    sortBy: "currentStock",
    sortOrder: "asc",
  });

  if (rows.length === 0) return paginate([], 0, params.page, params.limit);

  const ids = rows.map((r) => r.id);
  const [velocity, lastSales, reservations] = await Promise.all([
    inventoryRepository.salesVelocity(ids, daysAgo(windowDays), new Date()),
    inventoryRepository.lastSaleDates(ids),
    inventoryRepository.sumActiveReservations(ids),
  ]);

  const velocityBy = new Map(velocity.map((v) => [v.variantId, v]));
  const lastSaleBy = new Map(lastSales.map((s) => [s.variantId, s.lastSaleAt]));
  const reservedBy = new Map(reservations.map((r) => [r.variantId, r._sum.quantity ?? 0]));

  const config = inventoryConfig();

  const items = rows.map((row) => {
    const unitsSold = Number(velocityBy.get(row.id)?.unitsSold ?? 0);
    const reserved = reservedBy.get(row.id) ?? 0;
    const lastSaleAt = lastSaleBy.get(row.id) ?? null;

    const reorder = computeReorder({
      currentStock: row.currentStock,
      reserved,
      averageDailySales: unitsSold / windowDays,
      reorderLevel: row.reorderLevel,
    });

    const availability = computeAvailability({
      currentStock: row.currentStock,
      reservedQuantity: reserved,
    });

    return {
      variantId: row.id,
      sku: row.sku,
      barcode: row.barcode,
      productName: row.product.name,
      imageUrl: row.product.imageUrls?.[0] ?? null,
      variantName: `${row.size?.name ?? ""} / ${row.color?.name ?? ""}`.trim(),
      categoryName: row.product.category?.name ?? null,
      supplierId: row.supplier?.id ?? null,
      supplierName: row.supplier?.businessName ?? null,

      currentStock: row.currentStock,
      reserved,
      available: availability.available,
      reorderLevel: row.reorderLevel ?? config.lowStockThreshold,
      status: deriveStockStatus({
        currentStock: row.currentStock,
        available: availability.available,
        reorderLevel: row.reorderLevel,
      }),

      averageDailySales: reorder.averageDailySales,
      daysRemaining: reorder.daysRemaining,
      recommendedQuantity: reorder.recommendedQuantity,
      leadTimeDays: reorder.leadTimeDays,

      lastSaleAt,
      /** For the out-of-stock page: how long it has been unavailable. */
      daysOutOfStock: row.currentStock <= 0 ? daysSince(lastSaleAt) : null,

      ...(scope.canSeeCost
        ? {
            estimatedCost:
              Math.round(reorder.recommendedQuantity * toNumber(row.costPrice) * 100) / 100,
          }
        : {}),
    };
  });

  const start = (params.page - 1) * params.limit;
  return paginate(
    items.slice(start, start + params.limit),
    items.length,
    params.page,
    params.limit
  );
}

// =============================================================================
// INVENTORY AGING
// =============================================================================

/**
 * How long stock has been sitting, in buckets.
 *
 * Measured from the LAST SALE rather than from receipt: the question aging
 * answers is "how long has this been failing to sell", and receipt date would
 * make a briskly-selling item look old simply because it was first stocked
 * long ago.
 */
export async function getAgingReport(actor: AuthenticatedUser) {
  const scope = scopeFor(actor);

  const { data: rows } = await inventoryRepository.findStock({
    page: 1,
    limit: ANALYTICS_CAP,
    isActive: true,
    sortBy: "sku",
    sortOrder: "asc",
  });

  const ids = rows.map((r) => r.id);
  const lastSales = await inventoryRepository.lastSaleDates(ids);
  const lastSaleBy = new Map(lastSales.map((s) => [s.variantId, s.lastSaleAt]));

  const buckets = [
    { label: "0–30 days", min: 0, max: 30, skuCount: 0, units: 0, stockValue: 0, retailValue: 0 },
    { label: "31–60 days", min: 31, max: 60, skuCount: 0, units: 0, stockValue: 0, retailValue: 0 },
    { label: "61–90 days", min: 61, max: 90, skuCount: 0, units: 0, stockValue: 0, retailValue: 0 },
    { label: "91–180 days", min: 91, max: 180, skuCount: 0, units: 0, stockValue: 0, retailValue: 0 },
    { label: "Over 180 days", min: 181, max: Infinity, skuCount: 0, units: 0, stockValue: 0, retailValue: 0 },
  ];

  for (const row of rows) {
    if (row.currentStock <= 0) continue;

    const age = daysSince(lastSaleBy.get(row.id) ?? null);
    // Never sold goes in the oldest bucket — it is the most stagnant case
    // there is, and excluding it would understate the problem.
    const effectiveAge = age ?? Infinity;

    const bucket = buckets.find((b) => effectiveAge >= b.min && effectiveAge <= b.max);
    if (!bucket) continue;

    const valuation = computeValuation({
      quantity: row.currentStock,
      costPrice: toNumber(row.costPrice),
      sellingPrice: toNumber(row.sellingPrice),
    });

    bucket.skuCount += 1;
    bucket.units += valuation.quantity;
    bucket.stockValue = Math.round((bucket.stockValue + valuation.stockValue) * 100) / 100;
    bucket.retailValue = Math.round((bucket.retailValue + valuation.retailValue) * 100) / 100;
  }

  return {
    buckets: buckets.map((b) => ({
      label: b.label,
      skuCount: b.skuCount,
      units: b.units,
      retailValue: b.retailValue,
      ...(scope.canSeeCost ? { stockValue: b.stockValue } : {}),
    })),
  };
}
