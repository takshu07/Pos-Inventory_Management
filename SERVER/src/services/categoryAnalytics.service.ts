// =============================================================================
// CATEGORY ANALYTICS SERVICE  —  Phase 3 business intelligence
//
// Every number here is derived from committed transactional data. Nothing is
// mocked, estimated or seeded with placeholder values.
//
// WHY RAW SQL:
//   Revenue by category requires joining sale_items → product_variants →
//   products → categories and aggregating. Prisma's `groupBy` cannot group
//   across relations, so the alternative is loading every sale item into Node
//   and reducing in JS — which is O(sales) memory and gets slower every day the
//   shop trades. One indexed GROUP BY keeps this flat.
//
//   Table names are the @@map()'d lowercase names ("categories", not "Category")
//   — Prisma's model names do not exist in Postgres.
//
// FINANCIAL DEFINITIONS (single source of truth for the whole module):
//   revenue      Σ sale_items.totalPrice           — what the customer paid
//   cost         Σ sale_items.costAtSale × qty     — snapshotted at sale time,
//                                                    so historical margin stays
//                                                    correct after a re-price
//   profit       revenue − cost
//   margin %     profit / revenue × 100
//   discount     Σ sale_items.discountAmount
//   ASP          revenue / units
//
// Only COMPLETED sales count. DRAFT/CANCELLED baskets are not revenue.
// =============================================================================

import { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { categoryRepository } from "../repositories/category.repository";
import type { CategoryAnalyticsQuery } from "../validation/category.validation";

// ── Period resolution ────────────────────────────────────────────────────────

export interface ResolvedPeriod {
  from: Date;
  to: Date;
  /** The immediately preceding window of equal length, for growth comparison. */
  previousFrom: Date;
  previousTo: Date;
  label: string;
}

/**
 * Turns a period token into an explicit window plus the comparable previous
 * window. Growth is always "this window vs the one before it of the same
 * length", so a 7d growth figure never silently compares against 30 days.
 */
export function resolvePeriod(query: CategoryAnalyticsQuery): ResolvedPeriod {
  const to = query.to ?? new Date();
  let from: Date;

  switch (query.period) {
    case "7d":
      from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "90d":
      from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case "12m":
      from = new Date(to);
      from.setMonth(from.getMonth() - 12);
      break;
    case "custom":
      // Validation guarantees both bounds are present for `custom`.
      from = query.from as Date;
      break;
    case "30d":
    default:
      from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
  }

  const span = to.getTime() - from.getTime();

  return {
    from,
    to,
    previousFrom: new Date(from.getTime() - span),
    previousTo: from,
    label: query.period,
  };
}

// ── Row shapes returned by the raw aggregates ────────────────────────────────

interface CategorySalesRow {
  categoryId: string;
  categoryName: string;
  revenue: number;
  cost: number;
  units: number;
  discount: number;
  orders: number;
}

interface InventoryRow {
  categoryId: string;
  inventoryValue: number;
  retailValue: number;
  stockUnits: number;
  productCount: number;
  lowStockProducts: number;
}

/** Postgres NUMERIC arrives as string|Decimal; coerce defensively. */
function num(value: unknown): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 10000) / 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ── Core aggregates ──────────────────────────────────────────────────────────

/**
 * Sales rollup per category for a window. One GROUP BY over the join path.
 * Categories with no sales are absent — callers left-join them back in so an
 * unsold category still shows as a zero row rather than vanishing.
 */
async function getSalesByCategory(from: Date, to: Date): Promise<CategorySalesRow[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT
      c.id                                             AS "categoryId",
      c.name                                           AS "categoryName",
      COALESCE(SUM(si."totalPrice"), 0)                AS "revenue",
      COALESCE(SUM(si."costAtSale" * si.quantity), 0)  AS "cost",
      COALESCE(SUM(si.quantity), 0)                    AS "units",
      COALESCE(SUM(si."discountAmount"), 0)            AS "discount",
      COUNT(DISTINCT s.id)                             AS "orders"
    FROM categories c
    JOIN products p          ON p."categoryId" = c.id
    JOIN product_variants pv ON pv."productId" = p.id
    JOIN sale_items si       ON si."variantId" = pv.id
    JOIN sales s             ON s.id = si."saleId"
    WHERE s.status = 'COMPLETED'
      AND s."saleDate" >= ${from}
      AND s."saleDate" <= ${to}
    GROUP BY c.id, c.name
  `;

  return rows.map((r) => ({
    categoryId: String(r["categoryId"]),
    categoryName: String(r["categoryName"]),
    revenue: num(r["revenue"]),
    cost: num(r["cost"]),
    units: num(r["units"]),
    discount: num(r["discount"]),
    orders: num(r["orders"]),
  }));
}

/**
 * Current inventory position per category. Point-in-time (not windowed) —
 * stock is a "now" quantity, not something that accumulates over a period.
 */
async function getInventoryByCategory(): Promise<Map<string, InventoryRow>> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT
      c.id                                                          AS "categoryId",
      COALESCE(SUM(pv."costPrice"    * pv."currentStock"), 0)       AS "inventoryValue",
      COALESCE(SUM(pv."sellingPrice" * pv."currentStock"), 0)       AS "retailValue",
      COALESCE(SUM(pv."currentStock"), 0)                           AS "stockUnits",
      COUNT(DISTINCT p.id)                                          AS "productCount",
      -- reorderLevel is nullable: a variant with no threshold configured is not
      -- "low stock", it is simply unmonitored. NULL comparison already yields
      -- false, but the IS NOT NULL makes that intent explicit.
      COUNT(DISTINCT p.id) FILTER (
        WHERE pv."reorderLevel" IS NOT NULL
          AND pv."currentStock" <= pv."reorderLevel"
      )                                                             AS "lowStockProducts"
    FROM categories c
    LEFT JOIN products p          ON p."categoryId" = c.id
    LEFT JOIN product_variants pv ON pv."productId" = p.id
    GROUP BY c.id
  `;

  const map = new Map<string, InventoryRow>();
  for (const r of rows) {
    const categoryId = String(r["categoryId"]);
    map.set(categoryId, {
      categoryId,
      inventoryValue: num(r["inventoryValue"]),
      retailValue: num(r["retailValue"]),
      stockUnits: num(r["stockUnits"]),
      productCount: num(r["productCount"]),
      lowStockProducts: num(r["lowStockProducts"]),
    });
  }
  return map;
}

/** Units returned per category in the window — the Returns metric. */
async function getReturnsByCategory(from: Date, to: Date): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT
      c.id                              AS "categoryId",
      COALESCE(SUM(eri.quantity), 0)    AS "returnedUnits"
    FROM categories c
    JOIN products p                ON p."categoryId" = c.id
    JOIN product_variants pv       ON pv."productId" = p.id
    JOIN exchange_return_items eri ON eri."variantId" = pv.id
    JOIN exchanges e               ON e.id = eri."exchangeId"
    WHERE e.status = 'COMPLETED'
      AND e."createdAt" >= ${from}
      AND e."createdAt" <= ${to}
    GROUP BY c.id
  `;

  return new Map(rows.map((r) => [String(r["categoryId"]), num(r["returnedUnits"])]));
}

/** Monthly revenue/profit/units trend, for the charts. */
async function getMonthlyTrend(
  from: Date,
  to: Date,
  categoryId?: string
): Promise<{ month: string; revenue: number; profit: number; units: number; orders: number }[]> {
  // Prisma.sql / Prisma.empty compose a parameterised fragment. Never string
  // concatenation — categoryId still binds as a parameter, not inline SQL.
  const categoryFilter = categoryId
    ? Prisma.sql`AND p."categoryId" = ${categoryId}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT
      TO_CHAR(DATE_TRUNC('month', s."saleDate"), 'YYYY-MM')          AS "month",
      COALESCE(SUM(si."totalPrice"), 0)                              AS "revenue",
      COALESCE(SUM(si."totalPrice" - si."costAtSale" * si.quantity), 0) AS "profit",
      COALESCE(SUM(si.quantity), 0)                                  AS "units",
      COUNT(DISTINCT s.id)                                           AS "orders"
    FROM sale_items si
    JOIN sales s             ON s.id = si."saleId"
    JOIN product_variants pv ON pv.id = si."variantId"
    JOIN products p          ON p.id = pv."productId"
    WHERE s.status = 'COMPLETED'
      AND s."saleDate" >= ${from}
      AND s."saleDate" <= ${to}
      ${categoryFilter}
    GROUP BY DATE_TRUNC('month', s."saleDate")
    ORDER BY DATE_TRUNC('month', s."saleDate") ASC
  `;

  return rows.map((r) => ({
    month: String(r["month"]),
    revenue: round2(num(r["revenue"])),
    profit: round2(num(r["profit"])),
    units: num(r["units"]),
    orders: num(r["orders"]),
  }));
}

// ── Public DTOs ──────────────────────────────────────────────────────────────

export interface CategoryPerformance {
  categoryId: string;
  categoryName: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  units: number;
  orders: number;
  discount: number;
  averageSellingPrice: number;
  returns: number;
  returnRate: number;
  inventoryValue: number;
  retailValue: number;
  stockUnits: number;
  productCount: number;
  lowStockProducts: number;
  /** Revenue growth vs the equivalent preceding window, as a percentage. */
  growth: number;
  revenueShare: number;
}

/**
 * Builds the full per-category performance table. Everything else in this
 * service (dashboard widgets, reports, export) is a projection of this, so the
 * numbers can never disagree between two screens.
 */
export async function getCategoryPerformance(
  query: CategoryAnalyticsQuery
): Promise<{ period: ResolvedPeriod; rows: CategoryPerformance[]; totals: ReturnType<typeof summarise> }> {
  const period = resolvePeriod(query);

  const [current, previous, inventory, returns, categories] = await Promise.all([
    getSalesByCategory(period.from, period.to),
    getSalesByCategory(period.previousFrom, period.previousTo),
    getInventoryByCategory(),
    getReturnsByCategory(period.from, period.to),
    prisma.category.findMany({
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const currentBy = new Map(current.map((r) => [r.categoryId, r]));
  const previousBy = new Map(previous.map((r) => [r.categoryId, r]));

  const totalRevenue = current.reduce((sum, r) => sum + r.revenue, 0);

  // Left-join every category back in: a category with zero sales is a finding,
  // not a row to omit. The "Least Sold" widget depends on it.
  const rows: CategoryPerformance[] = categories.map((c) => {
    const cur = currentBy.get(c.id);
    const prev = previousBy.get(c.id);
    const inv = inventory.get(c.id);

    const revenue = cur?.revenue ?? 0;
    const cost = cur?.cost ?? 0;
    const units = cur?.units ?? 0;
    const profit = revenue - cost;
    const prevRevenue = prev?.revenue ?? 0;
    const returnedUnits = returns.get(c.id) ?? 0;

    return {
      categoryId: c.id,
      categoryName: c.name,
      revenue: round2(revenue),
      cost: round2(cost),
      profit: round2(profit),
      margin: pct(profit, revenue),
      units,
      orders: cur?.orders ?? 0,
      discount: round2(cur?.discount ?? 0),
      averageSellingPrice: units > 0 ? round2(revenue / units) : 0,
      returns: returnedUnits,
      returnRate: pct(returnedUnits, units),
      inventoryValue: round2(inv?.inventoryValue ?? 0),
      retailValue: round2(inv?.retailValue ?? 0),
      stockUnits: inv?.stockUnits ?? 0,
      productCount: inv?.productCount ?? 0,
      lowStockProducts: inv?.lowStockProducts ?? 0,
      // No prior revenue: 100% growth if we sold something now, else flat. A
      // literal division would be Infinity, which no chart can render.
      growth: prevRevenue > 0 ? pct(revenue - prevRevenue, prevRevenue) : revenue > 0 ? 100 : 0,
      revenueShare: pct(revenue, totalRevenue),
    };
  });

  return { period, rows, totals: summarise(rows) };
}

function summarise(rows: CategoryPerformance[]) {
  const revenue = rows.reduce((s, r) => s + r.revenue, 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const units = rows.reduce((s, r) => s + r.units, 0);
  const profit = revenue - cost;

  return {
    revenue: round2(revenue),
    cost: round2(cost),
    profit: round2(profit),
    margin: pct(profit, revenue),
    units,
    orders: rows.reduce((s, r) => s + r.orders, 0),
    discount: round2(rows.reduce((s, r) => s + r.discount, 0)),
    returns: rows.reduce((s, r) => s + r.returns, 0),
    inventoryValue: round2(rows.reduce((s, r) => s + r.inventoryValue, 0)),
    retailValue: round2(rows.reduce((s, r) => s + r.retailValue, 0)),
    averageSellingPrice: units > 0 ? round2(revenue / units) : 0,
    categoriesWithSales: rows.filter((r) => r.revenue > 0).length,
  };
}

// ── Dashboard ────────────────────────────────────────────────────────────────

/**
 * The executive dashboard: KPI totals, ranked widgets and the trend charts, in
 * one response. Delivered as a single call because these panels are always
 * rendered together — six separate endpoints would mean six round-trips and six
 * chances for the panels to disagree.
 */
export async function getAnalyticsDashboard(query: CategoryAnalyticsQuery) {
  const { period, rows, totals } = await getCategoryPerformance(query);
  const limit = query.limit;

  const withSales = rows.filter((r) => r.revenue > 0);
  const byRevenueDesc = [...rows].sort((a, b) => b.revenue - a.revenue);
  const byUnitsDesc = [...rows].sort((a, b) => b.units - a.units);

  const [monthly, discountedCategoryIds] = await Promise.all([
    getMonthlyTrend(period.from, period.to),
    prisma.discountRule
      .findMany({
        where: { scope: "CATEGORY", isEnabled: true, categoryId: { not: null } },
        select: { categoryId: true },
        distinct: ["categoryId"],
      })
      .then((r) => new Set(r.map((x) => x.categoryId).filter(Boolean) as string[])),
  ]);

  return {
    period: { from: period.from, to: period.to, label: period.label },
    totals,
    widgets: {
      topByRevenue: byRevenueDesc.slice(0, limit),
      // "Lowest revenue" means worst *performing seller*, not "never sold" —
      // categories with zero sales are their own widget below.
      lowestByRevenue: [...withSales].sort((a, b) => a.revenue - b.revenue).slice(0, limit),
      mostSold: byUnitsDesc.slice(0, limit),
      leastSold: [...withSales].sort((a, b) => a.units - b.units).slice(0, limit),
      topByProfit: [...rows].sort((a, b) => b.profit - a.profit).slice(0, limit),
      topByMargin: [...withSales].sort((a, b) => b.margin - a.margin).slice(0, limit),
      fastestGrowing: [...withSales].sort((a, b) => b.growth - a.growth).slice(0, limit),
      declining: [...withSales].filter((r) => r.growth < 0).sort((a, b) => a.growth - b.growth).slice(0, limit),
      discounted: rows.filter((r) => discountedCategoryIds.has(r.categoryId)).slice(0, limit),
      lowStock: rows
        .filter((r) => r.lowStockProducts > 0)
        .sort((a, b) => b.lowStockProducts - a.lowStockProducts)
        .slice(0, limit),
      noSales: rows.filter((r) => r.revenue === 0 && r.productCount > 0).slice(0, limit),
      highestInventoryValue: [...rows]
        .sort((a, b) => b.inventoryValue - a.inventoryValue)
        .slice(0, limit),
    },
    charts: {
      monthly,
      revenueByCategory: byRevenueDesc
        .slice(0, limit)
        .map((r) => ({ name: r.categoryName, value: r.revenue })),
      unitsByCategory: byUnitsDesc
        .slice(0, limit)
        .map((r) => ({ name: r.categoryName, value: r.units })),
      inventoryByCategory: [...rows]
        .sort((a, b) => b.inventoryValue - a.inventoryValue)
        .slice(0, limit)
        .map((r) => ({ name: r.categoryName, value: r.inventoryValue })),
      marginByCategory: withSales
        .slice(0, limit)
        .map((r) => ({ name: r.categoryName, value: r.margin })),
    },
  };
}

/** Per-category analytics for the drawer's Analytics tab. */
export async function getSingleCategoryAnalytics(
  categoryId: string,
  query: CategoryAnalyticsQuery
) {
  const category = await categoryRepository.findById(categoryId);
  if (!category) throw new AppError(HTTP_STATUS.NOT_FOUND, "Category not found.");

  const { period, rows, totals } = await getCategoryPerformance(query);
  const mine = rows.find((r) => r.categoryId === categoryId);

  if (!mine) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Category analytics unavailable.");
  }

  const monthly = await getMonthlyTrend(period.from, period.to, categoryId);
  const ranked = [...rows].sort((a, b) => b.revenue - a.revenue);

  return {
    period: { from: period.from, to: period.to, label: period.label },
    metrics: mine,
    // Rank is only meaningful next to the field it ranks by.
    rank: { byRevenue: ranked.findIndex((r) => r.categoryId === categoryId) + 1, of: ranked.length },
    storeTotals: totals,
    charts: { monthly },
  };
}

// ── Advanced reporting ───────────────────────────────────────────────────────

export const CATEGORY_REPORTS = [
  "revenue",
  "profit",
  "sales",
  "inventory",
  "margin",
  "discountImpact",
  "topPerforming",
  "worstPerforming",
  "growth",
] as const;

export type CategoryReportKey = (typeof CATEGORY_REPORTS)[number];

/**
 * Named executive reports. All are projections of the one performance table, so
 * "Revenue by Category" and the dashboard's revenue widget can never disagree.
 */
export async function getReport(report: CategoryReportKey, query: CategoryAnalyticsQuery) {
  const { period, rows, totals } = await getCategoryPerformance(query);
  const withSales = rows.filter((r) => r.revenue > 0);

  const pick = <K extends keyof CategoryPerformance>(
    source: CategoryPerformance[],
    columns: K[]
  ) => source.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]])));

  const shape = (() => {
    switch (report) {
      case "revenue":
        return {
          title: "Revenue by Category",
          rows: pick([...rows].sort((a, b) => b.revenue - a.revenue), [
            "categoryName", "revenue", "units", "orders", "revenueShare", "growth",
          ]),
        };
      case "profit":
        return {
          title: "Profit by Category",
          rows: pick([...rows].sort((a, b) => b.profit - a.profit), [
            "categoryName", "revenue", "cost", "profit", "margin",
          ]),
        };
      case "sales":
        return {
          title: "Sales by Category",
          rows: pick([...rows].sort((a, b) => b.units - a.units), [
            "categoryName", "units", "orders", "averageSellingPrice", "returns", "returnRate",
          ]),
        };
      case "inventory":
        return {
          title: "Inventory Value by Category",
          rows: pick([...rows].sort((a, b) => b.inventoryValue - a.inventoryValue), [
            "categoryName", "productCount", "stockUnits", "inventoryValue", "retailValue", "lowStockProducts",
          ]),
        };
      case "margin":
        return {
          title: "Average Margin by Category",
          rows: pick([...withSales].sort((a, b) => b.margin - a.margin), [
            "categoryName", "revenue", "profit", "margin", "averageSellingPrice",
          ]),
        };
      case "discountImpact":
        return {
          title: "Discount Impact by Category",
          rows: pick([...rows].sort((a, b) => b.discount - a.discount), [
            "categoryName", "revenue", "discount", "margin", "units",
          ]),
        };
      case "topPerforming":
        return {
          title: "Top Performing Categories",
          rows: pick([...rows].sort((a, b) => b.profit - a.profit).slice(0, query.limit), [
            "categoryName", "revenue", "profit", "margin", "units", "growth",
          ]),
        };
      case "worstPerforming":
        return {
          title: "Worst Performing Categories",
          rows: pick([...rows].sort((a, b) => a.profit - b.profit).slice(0, query.limit), [
            "categoryName", "revenue", "profit", "margin", "units", "growth",
          ]),
        };
      case "growth":
        return {
          title: "Category Growth",
          rows: pick([...rows].sort((a, b) => b.growth - a.growth), [
            "categoryName", "revenue", "growth", "units", "revenueShare",
          ]),
        };
      default:
        throw new AppError(HTTP_STATUS.BAD_REQUEST, "Unknown report.");
    }
  })();

  return {
    report,
    title: shape.title,
    period: { from: period.from, to: period.to, label: period.label },
    totals,
    rows: shape.rows,
  };
}
