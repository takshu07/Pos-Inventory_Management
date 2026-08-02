// =============================================================================
// REPORTS SERVICE  —  the Business Intelligence layer
//
// Twelve reports, one filter vocabulary, one set of definitions.
//
// WHAT THIS LAYER IS FOR
// ----------------------
// The repository returns rows; this file turns them into ANSWERS. That means
// three things happen here and nowhere else:
//
//   1. bigint → number and Decimal → number. Postgres COUNT() returns bigint,
//      which `JSON.stringify` throws on outright. Converting at this boundary
//      is what stops that landing as a 500 in a controller.
//   2. Derived metrics. Margin, AOV, return rate, share-of-total — computed
//      from the raw aggregates so every report defines them identically.
//   3. Comparison windows. Every report that shows a trend fetches the
//      preceding window of equal length, because "revenue is down 40%" is only
//      meaningful against a like-for-like period.
//
// PERFORMANCE SHAPE
// -----------------
// Every report issues its queries as ONE Promise.all batch. Against a remote
// database, serialising six aggregates costs six round-trips of latency for a
// screen a user expects to feel instant.
// =============================================================================

import { Prisma } from "../../generated/prisma";
import { reportsRepository as repo, type ReportFilters } from "../repositories/reports.repository";
import {
  toDecimal,
  toNumber,
  money,
  percentage,
  growth,
  trend,
  resolvePeriod,
  autoGranularity,
  fillSeries,
  calculateProfitLoss,
  type Granularity,
  type PeriodKeyword,
} from "../engines/finance.engine";
import { financeRepository } from "../repositories/finance.repository";
import type {
  CommonReportQuery,
  SalesReportQuery,
  ProductReportQuery,
  CategoryReportQuery,
  BrandReportQuery,
  CustomerReportQuery,
  EmployeeReportQuery,
  InventoryReportQuery,
  PurchaseReportQuery,
  PaymentReportQuery,
  ReturnReportQuery,
  ProfitReportQuery,
  GlobalSearchQuery,
  DashboardQuery,
} from "../validation/reports.validation";

// =============================================================================
// SHARED
// =============================================================================

/** Postgres COUNT() returns bigint; JSON.stringify throws on it. */
const num = (v: bigint | number | null | undefined): number =>
  v === null || v === undefined ? 0 : Number(v);

const dec = (v: Prisma.Decimal | number | null | undefined): number => toNumber(toDecimal(v));

/**
 * Turns a validated report query into the repository's filter shape, plus the
 * comparison window every trend needs.
 */
function resolveFilters(query: CommonReportQuery): {
  filters: ReportFilters;
  previous: ReportFilters;
  label: string;
  start: Date;
  end: Date;
} {
  const w = resolvePeriod(query.period as PeriodKeyword, {
    ...(query.startDate && { startDate: query.startDate }),
    ...(query.endDate && { endDate: query.endDate }),
  });

  const dimensions = {
    employeeId: query.employeeId,
    customerId: query.customerId,
    supplierId: query.supplierId,
    brandId: query.brandId,
    categoryId: query.categoryId,
    productId: query.productId,
    variantId: query.variantId,
    sku: query.sku,
    invoiceNumber: query.invoiceNumber,
    paymentMethod: query.paymentMethod,
  };

  return {
    filters: { startDate: w.start, endDate: w.end, ...dimensions },
    previous: { startDate: w.previousStart, endDate: w.previousEnd, ...dimensions },
    label: w.label,
    start: w.start,
    end: w.end,
  };
}

function resolveGranularity(
  requested: "auto" | Granularity,
  start: Date,
  end: Date
): Granularity {
  return requested === "auto" ? autoGranularity(start, end) : requested;
}

/** Adds a `percentage` share-of-total to each row of a grouped result. */
function withShare<T extends { revenue: number }>(rows: T[]): Array<T & { share: number }> {
  const total = rows.reduce((sum, r) => sum + r.revenue, 0);
  return rows.map((r) => ({ ...r, share: total === 0 ? 0 : Number(((r.revenue / total) * 100).toFixed(2)) }));
}

// =============================================================================
// REPORT DASHBOARD
// =============================================================================

/**
 * The Business Intelligence landing screen: nine cards, one glance.
 *
 * Deliberately does NOT reuse the finance dashboard. That one answers "how is
 * the money", this one answers "how is the business" — overlapping but not
 * identical questions, and merging them would produce a screen that serves
 * neither well.
 */
export async function getReportDashboard(query: DashboardQuery) {
  const { filters, previous, label, start, end } = resolveFilters(query);
  const today = resolvePeriod("today");
  const month = resolvePeriod("month");

  const todayFilters: ReportFilters = { ...filters, startDate: today.start, endDate: today.end };
  const monthFilters: ReportFilters = { ...filters, startDate: month.start, endDate: month.end };

  const [
    todayKpis, monthKpis, periodKpis, prevKpis,
    returns, prevReturns,
    inventory, customers,
  ] = await Promise.all([
    repo.salesKpis(todayFilters),
    repo.salesKpis(monthFilters),
    repo.salesKpis(filters),
    repo.salesKpis(previous),
    repo.returnExchangeTotals(filters),
    repo.returnExchangeTotals(previous),
    financeRepository.inventoryValue(),
    repo.customerSegments(filters, 90),
  ]);

  const periodRevenue = dec(periodKpis.grossSales);
  const periodProfit = periodRevenue - dec(periodKpis.cogs);
  const prevRevenue = dec(prevKpis.grossSales);
  const prevProfit = prevRevenue - dec(prevKpis.cogs);

  const revenueGrowth = growth(periodRevenue, prevRevenue);
  const profitGrowth = growth(periodProfit, prevProfit);
  const orderGrowth = growth(num(periodKpis.orders), num(prevKpis.orders));

  return {
    period: { label, start, end },

    cards: {
      todaySales: dec(todayKpis.grossSales),
      todayOrders: num(todayKpis.orders),
      monthlySales: dec(monthKpis.grossSales),
      monthlyOrders: num(monthKpis.orders),

      revenue: periodRevenue,
      grossProfit: Number(periodProfit.toFixed(2)),
      orders: num(periodKpis.orders),
      unitsSold: num(periodKpis.unitsSold),

      returns: num(returns.returnedUnits),
      returnValue: dec(returns.returnedValue),
      exchanges: num(returns.exchangeCount),

      inventoryValue: toNumber(inventory.costValue),
      inventoryUnits: inventory.units,

      customers: num(customers.totalCustomers),
      newCustomers: num(customers.newCustomers),
      returningCustomers: num(customers.returningCustomers),
    },

    comparison: {
      revenue: { value: revenueGrowth, trend: trend(revenueGrowth), previous: prevRevenue },
      profit: { value: profitGrowth, trend: trend(profitGrowth), previous: Number(prevProfit.toFixed(2)) },
      orders: { value: orderGrowth, trend: trend(orderGrowth), previous: num(prevKpis.orders) },
      returns: {
        value: growth(num(returns.returnedUnits), num(prevReturns.returnedUnits)),
        // More returns is bad news, so the polarity is inverted next to the
        // number that needs it rather than in the UI.
        trend: trend(-growth(num(returns.returnedUnits), num(prevReturns.returnedUnits))),
        previous: num(prevReturns.returnedUnits),
      },
    },
  };
}

// =============================================================================
// SALES REPORT
// =============================================================================

export async function getSalesReport(query: SalesReportQuery) {
  const { filters, previous, label, start, end } = resolveFilters(query);
  const granularity = resolveGranularity(query.granularity, start, end);

  const [kpis, prevKpis, series, returns] = await Promise.all([
    repo.salesKpis(filters),
    repo.salesKpis(previous),
    repo.salesSeries(filters, granularity),
    repo.returnExchangeTotals(filters),
  ]);

  const grossSales = toDecimal(kpis.grossSales);
  const refunds = toDecimal(returns.refundValue);
  const netSales = money(grossSales.minus(refunds));
  const orders = num(kpis.orders);
  const cogs = toDecimal(kpis.cogs);

  const revenueGrowth = growth(grossSales, toDecimal(prevKpis.grossSales));

  return {
    period: { label, start, end, granularity },

    metrics: {
      grossSales: toNumber(grossSales),
      netSales: toNumber(netSales),
      averageOrderValue: orders === 0 ? 0 : toNumber(money(grossSales.dividedBy(orders))),
      orders,
      itemsSold: num(kpis.unitsSold),
      returns: num(returns.returnedUnits),
      returnValue: dec(returns.returnedValue),
      exchanges: num(returns.exchangeCount),
      exchangeValue: dec(returns.issuedValue),
      discounts: dec(kpis.discounts),
      tax: dec(kpis.tax),
      cogs: toNumber(cogs),
      grossProfit: toNumber(money(netSales.minus(cogs))),
      grossMarginPercent: percentage(netSales.minus(cogs), netSales),
      // Return rate is measured in UNITS, not in currency: returning one ₹5,000
      // jacket and one ₹200 tee are two return events, and a value-weighted
      // rate would make the cheap one invisible.
      returnRatePercent: percentage(num(returns.returnedUnits), num(kpis.unitsSold)),
    },

    comparison: {
      previousGrossSales: dec(prevKpis.grossSales),
      previousOrders: num(prevKpis.orders),
      revenueGrowth,
      trend: trend(revenueGrowth),
      orderGrowth: growth(orders, num(prevKpis.orders)),
    },

    series: fillSeries(
      series.map((r) => ({
        bucket: r.bucket,
        revenue: dec(r.revenue),
        orders: num(r.orders),
        discounts: dec(r.discounts),
      })),
      start,
      end,
      granularity,
      { revenue: 0, orders: 0, discounts: 0 }
    ),
  };
}

// =============================================================================
// PRODUCT REPORT
// =============================================================================

export async function getProductReport(query: ProductReportQuery) {
  const { filters, label, start, end } = resolveFilters(query);

  const rows = await repo.productPerformance(filters, {
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });

  const total = num(rows[0]?.total);

  const data = rows.map((r) => ({
    variantId: r.variantId,
    productId: r.productId,
    productName: r.productName,
    sku: r.sku,
    variantLabel: `${r.sizeName} / ${r.colorName}`,
    categoryName: r.categoryName,
    brandName: r.brandName,
    unitsSold: num(r.unitsSold),
    revenue: dec(r.revenue),
    cost: dec(r.cost),
    grossProfit: dec(r.grossProfit),
    marginPercent: dec(r.marginPercent),
    currentStock: r.currentStock,
    returnedUnits: num(r.returnedUnits),
    exchangedUnits: num(r.exchangedUnits),
    orders: num(r.orders),
    returnRatePercent: percentage(num(r.returnedUnits), num(r.unitsSold)),
  }));

  // The spec's six "top/least" lists are derived from THIS page rather than
  // fetched separately. The caller controls the sort, so asking for
  // sortBy=revenue&limit=10 IS the top-selling list — six extra queries would
  // return the same rows in a different order.
  return {
    period: { label, start, end },
    data,
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    },
    summary: {
      products: total,
      unitsSold: data.reduce((n, r) => n + r.unitsSold, 0),
      revenue: Number(data.reduce((n, r) => n + r.revenue, 0).toFixed(2)),
      grossProfit: Number(data.reduce((n, r) => n + r.grossProfit, 0).toFixed(2)),
    },
  };
}

// =============================================================================
// CATEGORY & BRAND REPORTS
// =============================================================================

export async function getCategoryReport(query: CategoryReportQuery) {
  const { filters, previous, label, start, end } = resolveFilters(query);

  const [rows, prevRows] = await Promise.all([
    repo.categoryPerformance(filters),
    repo.categoryPerformance(previous),
  ]);

  const prevByCategory = new Map(prevRows.map((r) => [r.categoryId, dec(r.revenue)]));

  const data = withShare(
    rows.map((r) => {
      const revenue = dec(r.revenue);
      const previousRevenue = prevByCategory.get(r.categoryId) ?? 0;
      const g = growth(revenue, previousRevenue);
      return {
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        unitsSold: num(r.unitsSold),
        revenue,
        cost: dec(r.cost),
        grossProfit: dec(r.grossProfit),
        marginPercent: dec(r.marginPercent),
        productCount: num(r.productCount),
        orders: num(r.orders),
        previousRevenue,
        growth: g,
        trend: trend(g),
      };
    })
  );

  return {
    period: { label, start, end },
    data,
    summary: {
      categories: data.length,
      revenue: Number(data.reduce((n, r) => n + r.revenue, 0).toFixed(2)),
      grossProfit: Number(data.reduce((n, r) => n + r.grossProfit, 0).toFixed(2)),
      unitsSold: data.reduce((n, r) => n + r.unitsSold, 0),
    },
  };
}

export async function getBrandReport(query: BrandReportQuery) {
  const { filters, previous, label, start, end } = resolveFilters(query);

  const [rows, prevRows] = await Promise.all([
    repo.brandPerformance(filters),
    repo.brandPerformance(previous),
  ]);

  const prevByBrand = new Map(prevRows.map((r) => [r.brandId, dec(r.revenue)]));

  const data = withShare(
    rows.map((r) => {
      const revenue = dec(r.revenue);
      const previousRevenue = prevByBrand.get(r.brandId) ?? 0;
      const g = growth(revenue, previousRevenue);
      return {
        brandId: r.brandId,
        brandName: r.brandName,
        unitsSold: num(r.unitsSold),
        revenue,
        cost: dec(r.cost),
        grossProfit: dec(r.grossProfit),
        marginPercent: dec(r.marginPercent),
        currentStock: num(r.currentStock),
        stockValue: dec(r.stockValue),
        productCount: num(r.productCount),
        previousRevenue,
        growth: g,
        trend: trend(g),
      };
    })
  );

  return {
    period: { label, start, end },
    data,
    summary: {
      brands: data.length,
      revenue: Number(data.reduce((n, r) => n + r.revenue, 0).toFixed(2)),
      grossProfit: Number(data.reduce((n, r) => n + r.grossProfit, 0).toFixed(2)),
      stockValue: Number(data.reduce((n, r) => n + r.stockValue, 0).toFixed(2)),
    },
  };
}

// =============================================================================
// CUSTOMER REPORT
// =============================================================================

export async function getCustomerReport(query: CustomerReportQuery) {
  const { filters, label, start, end } = resolveFilters(query);

  const [rows, segments] = await Promise.all([
    repo.customerPerformance(filters, {
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    }),
    repo.customerSegments(filters, query.inactiveDays),
  ]);

  const total = num(rows[0]?.total);
  const now = Date.now();

  const data = rows.map((r) => {
    const first = r.firstPurchase ? new Date(r.firstPurchase).getTime() : null;
    const last = r.lastPurchase ? new Date(r.lastPurchase).getTime() : null;

    // Visit frequency: orders per 30 days of relationship. Measured over the
    // customer's whole lifetime rather than the window, because "how often does
    // this person shop" is not a property of an arbitrary date range.
    const tenureDays = first ? Math.max(1, Math.round((now - first) / 86_400_000)) : null;
    const orders = num(r.orderCount);

    return {
      customerId: r.customerId,
      name: r.name,
      phone: r.phone,
      customerCode: r.customerCode,
      isWalkIn: r.isWalkIn,
      orderCount: orders,
      periodSpend: dec(r.periodSpend),
      lifetimeSpend: dec(r.lifetimeSpend),
      averageOrderValue: dec(r.averageOrderValue),
      firstPurchase: r.firstPurchase,
      lastPurchase: r.lastPurchase,
      daysSinceLastPurchase: last === null ? null : Math.floor((now - last) / 86_400_000),
      tenureDays,
      visitsPerMonth:
        tenureDays === null ? 0 : Number(((orders / tenureDays) * 30).toFixed(2)),
      rewardPoints: r.rewardPoints,
      storeCredit: dec(r.storeCredit),
      segment:
        first !== null && first >= start.getTime() ? ("NEW" as const) : ("RETURNING" as const),
    };
  });

  return {
    period: { label, start, end },
    segments: {
      newCustomers: num(segments.newCustomers),
      returningCustomers: num(segments.returningCustomers),
      inactiveCustomers: num(segments.inactiveCustomers),
      totalCustomers: num(segments.totalCustomers),
      inactiveDays: query.inactiveDays,
    },
    data,
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

// =============================================================================
// EMPLOYEE REPORT
// =============================================================================

export async function getEmployeeReport(query: EmployeeReportQuery) {
  const { filters, previous, label, start, end } = resolveFilters(query);

  const [rows, prevRows] = await Promise.all([
    repo.employeePerformance(filters),
    repo.employeePerformance(previous),
  ]);

  const prevByEmployee = new Map(prevRows.map((r) => [r.employeeId, dec(r.revenue)]));
  const totalRevenue = rows.reduce((n, r) => n + dec(r.revenue), 0);

  const data = rows.map((r, index) => {
    const revenue = dec(r.revenue);
    const previousRevenue = prevByEmployee.get(r.employeeId) ?? 0;
    const g = growth(revenue, previousRevenue);
    const orders = num(r.orders);

    return {
      // Rank comes from the SQL ordering (revenue DESC), so it is stable and
      // needs no second sort here.
      rank: index + 1,
      employeeId: r.employeeId,
      name: r.name,
      employeeCode: r.employeeCode,
      role: r.role,
      orders,
      revenue,
      averageBill: dec(r.averageBill),
      unitsSold: num(r.unitsSold),
      discountsGiven: dec(r.discountsGiven),
      // Discount rate against the pre-discount value, which is the figure a
      // manager actually questions: "how much did you give away".
      discountRatePercent: percentage(dec(r.discountsGiven), revenue + dec(r.discountsGiven)),
      exchanges: num(r.exchanges),
      exchangeValue: dec(r.exchangeValue),
      refundValue: dec(r.refundValue),
      share: percentage(revenue, totalRevenue),
      previousRevenue,
      growth: g,
      trend: trend(g),
    };
  });

  return {
    period: { label, start, end },
    data,
    leaderboard: data.slice(0, 10),
    summary: {
      employees: data.length,
      activeSellers: data.filter((r) => r.orders > 0).length,
      revenue: Number(totalRevenue.toFixed(2)),
      orders: data.reduce((n, r) => n + r.orders, 0),
      discountsGiven: Number(data.reduce((n, r) => n + r.discountsGiven, 0).toFixed(2)),
    },
  };
}

// =============================================================================
// INVENTORY REPORT
// =============================================================================

export async function getInventoryReport(query: InventoryReportQuery) {
  const { filters, label, start, end } = resolveFilters(query);

  const [rows, valuation, movements] = await Promise.all([
    repo.inventoryPosition({
      velocityDays: query.velocityDays,
      categoryId: query.categoryId,
      brandId: query.brandId,
      supplierId: query.supplierId,
      bucket: query.bucket,
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    }),
    repo.inventoryValuation(query.groupBy),
    repo.inventoryMovementSummary(filters),
  ]);

  const total = num(rows[0]?.total);

  const data = rows.map((r) => ({
    variantId: r.variantId,
    productName: r.productName,
    sku: r.sku,
    variantLabel: `${r.sizeName} / ${r.colorName}`,
    categoryName: r.categoryName,
    brandName: r.brandName,
    supplierName: r.supplierName,
    currentStock: r.currentStock,
    reorderLevel: r.reorderLevel,
    maximumStock: r.maximumStock,
    costPrice: dec(r.costPrice),
    sellingPrice: dec(r.sellingPrice),
    stockValue: dec(r.stockValue),
    retailValue: dec(r.retailValue),
    unitsSold: num(r.unitsSold),
    dailyVelocity: dec(r.dailyVelocity),
    daysOfCover: r.daysOfCover === null ? null : dec(r.daysOfCover),
    lastMovementAt: r.lastMovementAt,
    // Derived states, computed once here so the client never re-derives them
    // with slightly different thresholds.
    isLowStock:
      r.currentStock > 0 && r.reorderLevel !== null && r.currentStock <= r.reorderLevel,
    isOutOfStock: r.currentStock <= 0,
    isOverstocked: r.maximumStock !== null && r.currentStock > r.maximumStock,
    isDeadStock: num(r.unitsSold) === 0 && r.currentStock > 0,
  }));

  const valuationRows = valuation.map((v) => ({
    groupId: v.groupId,
    groupName: v.groupName ?? "Unassigned",
    variantCount: num(v.variantCount),
    units: num(v.units),
    costValue: dec(v.costValue),
    retailValue: dec(v.retailValue),
    potentialProfit: dec(v.potentialProfit),
  }));

  return {
    period: { label, start, end },
    bucket: query.bucket,
    velocityDays: query.velocityDays,

    data,

    valuation: {
      groupBy: query.groupBy,
      rows: valuationRows,
      totals: {
        units: valuationRows.reduce((n, r) => n + r.units, 0),
        costValue: Number(valuationRows.reduce((n, r) => n + r.costValue, 0).toFixed(2)),
        retailValue: Number(valuationRows.reduce((n, r) => n + r.retailValue, 0).toFixed(2)),
        potentialProfit: Number(valuationRows.reduce((n, r) => n + r.potentialProfit, 0).toFixed(2)),
      },
    },

    movements: movements.map((m) => ({
      type: m.type,
      movements: num(m.movements),
      unitsIn: num(m.unitsIn),
      unitsOut: num(m.unitsOut),
    })),

    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

// =============================================================================
// PURCHASE REPORT
// =============================================================================

export async function getPurchaseReport(query: PurchaseReportQuery) {
  const { filters, previous, label, start, end } = resolveFilters(query);

  const [summary, prevSummary, bySupplier, byBrand, pending] = await Promise.all([
    repo.purchaseSummary(filters),
    repo.purchaseSummary(previous),
    repo.purchasesBySupplier(filters),
    repo.purchasesByBrand(filters),
    repo.pendingDeliveries(filters),
  ]);

  const totalCost = dec(summary.totalCost);
  const costGrowth = growth(totalCost, dec(prevSummary.totalCost));

  return {
    period: { label, start, end },

    summary: {
      purchaseCount: num(summary.purchaseCount),
      totalCost,
      paidAmount: dec(summary.paidAmount),
      dueAmount: dec(summary.dueAmount),
      unitsReceived: num(summary.unitsReceived),
      pendingDeliveries: num(summary.pendingDeliveries),
      averagePurchaseValue:
        num(summary.purchaseCount) === 0
          ? 0
          : Number((totalCost / num(summary.purchaseCount)).toFixed(2)),
    },

    comparison: {
      previousCost: dec(prevSummary.totalCost),
      growth: costGrowth,
      // Higher purchasing is not inherently good or bad, so the trend is
      // reported without polarity inversion — the reader supplies the context.
      trend: trend(costGrowth),
    },

    bySupplier: bySupplier.map((s) => ({
      supplierId: s.supplierId,
      businessName: s.businessName,
      purchaseCount: num(s.purchaseCount),
      totalCost: dec(s.totalCost),
      paidAmount: dec(s.paidAmount),
      dueAmount: dec(s.dueAmount),
      unitsReceived: num(s.unitsReceived),
      share: percentage(dec(s.totalCost), totalCost),
    })),

    byBrand: byBrand.map((b) => ({
      brandId: b.brandId,
      brandName: b.brandName ?? "Unbranded",
      unitsReceived: num(b.unitsReceived),
      totalCost: dec(b.totalCost),
      share: percentage(dec(b.totalCost), totalCost),
    })),

    pendingDeliveries: pending.map((p) => ({
      id: p.id,
      purchaseNumber: p.purchaseNumber,
      supplierInvoiceNumber: p.supplierInvoiceNumber,
      purchaseDate: p.purchaseDate,
      totalAmount: dec(p.totalAmount),
      status: p.status,
      supplier: p.supplier,
      lineCount: p._count.items,
    })),
  };
}

// =============================================================================
// PAYMENT REPORT
// =============================================================================

export async function getPaymentReport(query: PaymentReportQuery) {
  const { filters, previous, label, start, end } = resolveFilters(query);
  const granularity = resolveGranularity(query.granularity, start, end);

  const [breakdown, prevBreakdown, series, splits] = await Promise.all([
    repo.paymentBreakdown(filters),
    repo.paymentBreakdown(previous),
    repo.paymentSeries(filters, granularity),
    repo.splitPaymentStats(filters),
  ]);

  const total = breakdown.reduce((n, r) => n + dec(r.amount), 0);
  const prevByMethod = new Map(prevBreakdown.map((r) => [r.method, dec(r.amount)]));

  // Pivot the long (bucket, method, amount) series into one row per bucket with
  // a column per method — the shape a stacked area chart consumes directly.
  const methods = [...new Set(series.map((r) => r.method))];
  const byBucket = new Map<string, Record<string, number>>();

  for (const row of series) {
    const key = row.bucket.toISOString().slice(0, 10);
    const entry = byBucket.get(key) ?? Object.fromEntries(methods.map((m) => [m, 0]));
    entry[row.method] = dec(row.amount);
    byBucket.set(key, entry);
  }

  // The row type is dynamic (one numeric column per payment method actually
  // used), so it is asserted rather than inferred — TypeScript folds the spread
  // of a Record<string, number> into the literal and loses the index signature.
  const pivoted = [...byBucket.entries()].map(
    ([key, values]) => ({ bucket: new Date(key), ...values })
  ) as Array<{ bucket: Date } & Record<string, number>>;

  return {
    period: { label, start, end, granularity },

    total,
    methods: breakdown.map((r) => {
      const amount = dec(r.amount);
      const previousAmount = prevByMethod.get(r.method) ?? 0;
      const g = growth(amount, previousAmount);
      return {
        method: r.method,
        amount,
        count: num(r.count),
        averageTicket: dec(r.averageTicket),
        percentage: percentage(amount, total),
        previousAmount,
        growth: g,
        trend: trend(g),
      };
    }),

    splitPayments: {
      count: num(splits.splitCount),
      value: dec(splits.splitValue),
      totalBills: num(splits.totalBills),
      percentage: percentage(num(splits.splitCount), num(splits.totalBills)),
    },

    series: fillSeries(
      pivoted,
      start,
      end,
      granularity,
      Object.fromEntries(methods.map((m) => [m, 0]))
    ),
    seriesMethods: methods,
  };
}

// =============================================================================
// RETURN & EXCHANGE REPORT
// =============================================================================

export async function getReturnReport(query: ReturnReportQuery) {
  const { filters, previous, label, start, end } = resolveFilters(query);

  const [totals, prevTotals, rows, reasons, products, salesKpis] = await Promise.all([
    repo.returnExchangeTotals(filters),
    repo.returnExchangeTotals(previous),
    repo.exchangeList(filters, {
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    }),
    repo.exchangeReasons(filters),
    repo.mostReturnedProducts(filters, 15),
    repo.salesKpis(filters),
  ]);

  const total = num(rows[0]?.total);
  const returnedUnits = num(totals.returnedUnits);
  const unitGrowth = growth(returnedUnits, num(prevTotals.returnedUnits));
  const reasonTotal = reasons.reduce((n, r) => n + num(r.count), 0);

  return {
    period: { label, start, end },

    summary: {
      exchanges: num(totals.exchangeCount),
      returnedUnits,
      returnedValue: dec(totals.returnedValue),
      issuedValue: dec(totals.issuedValue),
      refundValue: dec(totals.refundValue),
      // Net movement: positive means customers paid more on upgrades than the
      // shop refunded on downgrades.
      netValue: Number((dec(totals.issuedValue) - dec(totals.returnedValue)).toFixed(2)),
      unitsSold: num(salesKpis.unitsSold),
      returnRatePercent: percentage(returnedUnits, num(salesKpis.unitsSold)),
    },

    comparison: {
      previousReturnedUnits: num(prevTotals.returnedUnits),
      growth: unitGrowth,
      trend: trend(-unitGrowth),
    },

    reasons: reasons.map((r) => ({
      reason: r.reason,
      count: num(r.count),
      value: dec(r.value),
      percentage: percentage(num(r.count), reasonTotal),
    })),

    topReturnedProducts: products.map((p) => ({
      variantId: p.variantId,
      productName: p.productName,
      sku: p.sku,
      returnedUnits: num(p.returnedUnits),
      returnedValue: dec(p.returnedValue),
      exchangeCount: num(p.exchangeCount),
    })),

    data: rows.map((r) => ({
      exchangeId: r.exchangeId,
      exchangeNumber: r.exchangeNumber,
      exchangeDate: r.exchangeDate,
      reason: r.reason ?? "Not specified",
      notes: r.notes,
      returnedValue: dec(r.returnedValue),
      issuedValue: dec(r.issuedValue),
      priceDifference: dec(r.priceDifference),
      returnedUnits: num(r.returnedUnits),
      issuedUnits: num(r.issuedUnits),
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      employeeName: r.employeeName,
      originalSaleNumber: r.originalSaleNumber,
    })),

    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

// =============================================================================
// PROFIT REPORT
//
// Shares its definitions with the finance module's P&L (via
// calculateProfitLoss) rather than re-deriving them. Two screens showing two
// different net profits for the same month is the failure mode this avoids.
// =============================================================================

export async function getProfitReport(query: ProfitReportQuery) {
  const { filters, previous, label, start, end } = resolveFilters(query);
  const granularity = resolveGranularity(query.granularity, start, end);

  const [kpis, prevKpis, returns, prevReturns, expenses, prevExpenses, series, cogsSeries, expenseSeries, breakdown] =
    await Promise.all([
      repo.salesKpis(filters),
      repo.salesKpis(previous),
      repo.returnExchangeTotals(filters),
      repo.returnExchangeTotals(previous),
      financeRepository.approvedExpenseTotal({ start, end }),
      financeRepository.approvedExpenseTotal({ start: previous.startDate, end: previous.endDate }),
      repo.salesSeries(filters, granularity),
      financeRepository.cogsSeries({ start, end }, granularity),
      financeRepository.expenseSeries({ start, end }, granularity),
      query.includeBreakdown
        ? financeRepository.expensesByCategory({ start, end })
        : Promise.resolve([]),
    ]);

  const statement = calculateProfitLoss({
    grossSales: kpis.grossSales,
    refunds: returns.refundValue,
    discounts: kpis.discounts,
    tax: kpis.tax,
    cogs: kpis.cogs,
    operatingExpenses: expenses,
  });

  const previousStatement = calculateProfitLoss({
    grossSales: prevKpis.grossSales,
    refunds: prevReturns.refundValue,
    discounts: prevKpis.discounts,
    tax: prevKpis.tax,
    cogs: prevKpis.cogs,
    operatingExpenses: prevExpenses,
  });

  const cogsByBucket = new Map(
    cogsSeries.map((r) => [r.bucket.toISOString().slice(0, 10), dec(r.cogs)])
  );
  const expenseByBucket = new Map(
    expenseSeries.map((r) => [r.bucket.toISOString().slice(0, 10), dec(r.expense)])
  );

  const merged = series.map((r) => {
    const key = r.bucket.toISOString().slice(0, 10);
    const revenue = dec(r.revenue);
    const bucketCogs = cogsByBucket.get(key) ?? 0;
    const bucketExpense = expenseByBucket.get(key) ?? 0;
    return {
      bucket: r.bucket,
      revenue,
      cogs: bucketCogs,
      expenses: bucketExpense,
      grossProfit: Number((revenue - bucketCogs).toFixed(2)),
      netProfit: Number((revenue - bucketCogs - bucketExpense).toFixed(2)),
    };
  });

  const profitGrowth = growth(statement.netProfit, previousStatement.netProfit);

  return {
    period: { label, start, end, granularity },
    statement,
    previous: previousStatement,
    comparison: {
      revenueGrowth: growth(statement.grossSales, previousStatement.grossSales),
      profitGrowth,
      trend: trend(profitGrowth),
      marginChange: Number(
        (statement.netMarginPercent - previousStatement.netMarginPercent).toFixed(2)
      ),
    },
    series: fillSeries(merged, start, end, granularity, {
      revenue: 0, cogs: 0, expenses: 0, grossProfit: 0, netProfit: 0,
    }),
    expenseBreakdown: breakdown.map((b) => ({
      categoryId: b.categoryId,
      category: b.name,
      isRecurring: b.isRecurring,
      amount: dec(b.amount),
      count: num(b.count),
      percentage: percentage(dec(b.amount), toDecimal(expenses)),
    })),
  };
}

// =============================================================================
// GLOBAL SEARCH
// =============================================================================

export async function globalSearch(query: GlobalSearchQuery) {
  const results = await repo.globalSearch(query.q, query.limit);

  return {
    query: query.q,
    invoices: results.invoices.map((s) => ({
      id: s.id,
      label: s.saleNumber,
      sublabel: `${s.customer?.name ?? "Walk-in"} · ${s.customer?.phone ?? ""}`.trim(),
      amount: dec(s.grandTotal),
      date: s.saleDate,
      status: s.status,
      href: `/sales/${s.id}`,
    })),
    products: results.products.map((v) => ({
      id: v.id,
      label: v.product.name,
      sublabel: `${v.sku} · ${v.size.name} / ${v.color.name}`,
      amount: dec(v.sellingPrice),
      stock: v.currentStock,
      barcode: v.barcode,
      href: `/admin/inventory/stock?variantId=${v.id}`,
    })),
    customers: results.customers.map((c) => ({
      id: c.id,
      label: c.name,
      sublabel: `${c.customerCode} · ${c.phone}`,
      rewardPoints: c.rewardPoints,
      href: `/customers/${c.id}`,
    })),
    suppliers: results.suppliers.map((s) => ({
      id: s.id,
      label: s.businessName,
      sublabel: `${s.contactPerson ?? ""} ${s.phone}`.trim(),
      href: `/admin/suppliers?supplierId=${s.id}`,
    })),
    employees: results.employees.map((e) => ({
      id: e.id,
      label: `${e.firstName} ${e.lastName}`.trim(),
      sublabel: `${e.employeeCode} · ${e.role}`,
      href: `/admin/staff?employeeId=${e.id}`,
    })),
  };
}

/** Dropdown sources for the shared report filter bar. */
export async function getFilterOptions() {
  const options = await repo.filterOptions();

  return {
    categories: options.categories,
    brands: options.brands,
    suppliers: options.suppliers.map((s) => ({ id: s.id, name: s.businessName })),
    employees: options.employees.map((e) => ({
      id: e.id,
      name: `${e.firstName} ${e.lastName}`.trim(),
      employeeCode: e.employeeCode,
      role: e.role,
    })),
  };
}
