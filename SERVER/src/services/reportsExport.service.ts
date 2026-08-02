// =============================================================================
// REPORTS EXPORT SERVICE
//
// One entry point, eleven reports, three formats.
//
// Each export calls the SAME service function the screen calls, so an exported
// figure can never disagree with the on-screen one. The alternative — a second,
// export-specific query per report — is exactly how a spreadsheet ends up
// contradicting the dashboard it was exported from.
//
// Reports whose primary output is a grouped breakdown rather than a row list
// (categories, brands, payments) export the breakdown. Reports with a paginated
// row list export the rows, walking pages up to a cap.
// =============================================================================

import {
  renderExport,
  fileStamp,
  type ExportColumn,
  type ExportFormat,
  type ExportPayload,
} from "../utils/exportRenderer";
import * as reportsService from "./reports.service";
import { reportsValidation as v } from "../validation/reports.validation";
import type { ReportKey } from "../validation/reports.validation";

/** Row cap for paginated exports. See the note in cashRegisterExport. */
const MAX_ROWS = 5_000;
const PAGE_SIZE = 200;

const inr = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// =============================================================================
// COLUMN SETS
// =============================================================================

const SALES_COLUMNS: ExportColumn[] = [
  { key: "bucket", label: "Period", type: "text" },
  { key: "revenue", label: "Revenue", type: "currency" },
  { key: "orders", label: "Orders", type: "number" },
  { key: "discounts", label: "Discounts", type: "currency" },
];

const PRODUCT_COLUMNS: ExportColumn[] = [
  { key: "sku", label: "SKU", type: "text" },
  { key: "productName", label: "Product", type: "text" },
  { key: "variantLabel", label: "Variant", type: "text" },
  { key: "categoryName", label: "Category", type: "text" },
  { key: "brandName", label: "Brand", type: "text" },
  { key: "unitsSold", label: "Units Sold", type: "number" },
  { key: "revenue", label: "Revenue", type: "currency" },
  { key: "cost", label: "Cost", type: "currency" },
  { key: "grossProfit", label: "Gross Profit", type: "currency" },
  { key: "marginPercent", label: "Margin %", type: "percent" },
  { key: "currentStock", label: "Stock", type: "number" },
  { key: "returnedUnits", label: "Returned", type: "number" },
  { key: "exchangedUnits", label: "Exchanged", type: "number" },
];

const CATEGORY_COLUMNS: ExportColumn[] = [
  { key: "categoryName", label: "Category", type: "text" },
  { key: "unitsSold", label: "Units Sold", type: "number" },
  { key: "revenue", label: "Revenue", type: "currency" },
  { key: "cost", label: "Cost", type: "currency" },
  { key: "grossProfit", label: "Gross Profit", type: "currency" },
  { key: "marginPercent", label: "Margin %", type: "percent" },
  { key: "share", label: "Share %", type: "percent" },
  { key: "productCount", label: "Products", type: "number" },
];

const BRAND_COLUMNS: ExportColumn[] = [
  { key: "brandName", label: "Brand", type: "text" },
  { key: "unitsSold", label: "Units Sold", type: "number" },
  { key: "revenue", label: "Revenue", type: "currency" },
  { key: "grossProfit", label: "Gross Profit", type: "currency" },
  { key: "marginPercent", label: "Margin %", type: "percent" },
  { key: "currentStock", label: "Current Stock", type: "number" },
  { key: "stockValue", label: "Stock Value", type: "currency" },
  { key: "share", label: "Share %", type: "percent" },
];

const CUSTOMER_COLUMNS: ExportColumn[] = [
  { key: "customerCode", label: "Code", type: "text" },
  { key: "name", label: "Customer", type: "text" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "segment", label: "Segment", type: "text" },
  { key: "orderCount", label: "Orders", type: "number" },
  { key: "periodSpend", label: "Period Spend", type: "currency" },
  { key: "lifetimeSpend", label: "Lifetime Spend", type: "currency" },
  { key: "averageOrderValue", label: "Avg Order", type: "currency" },
  { key: "visitsPerMonth", label: "Visits / Month", type: "number" },
  { key: "lastPurchase", label: "Last Purchase", type: "date" },
  { key: "daysSinceLastPurchase", label: "Days Since", type: "number" },
  { key: "rewardPoints", label: "Points", type: "number" },
];

const EMPLOYEE_COLUMNS: ExportColumn[] = [
  { key: "rank", label: "Rank", type: "number" },
  { key: "employeeCode", label: "Code", type: "text" },
  { key: "name", label: "Employee", type: "text" },
  { key: "role", label: "Role", type: "text" },
  { key: "orders", label: "Orders", type: "number" },
  { key: "revenue", label: "Revenue", type: "currency" },
  { key: "averageBill", label: "Avg Bill", type: "currency" },
  { key: "unitsSold", label: "Units Sold", type: "number" },
  { key: "discountsGiven", label: "Discounts", type: "currency" },
  { key: "discountRatePercent", label: "Discount %", type: "percent" },
  { key: "exchanges", label: "Exchanges", type: "number" },
  { key: "refundValue", label: "Refunds", type: "currency" },
  { key: "share", label: "Share %", type: "percent" },
];

const INVENTORY_COLUMNS: ExportColumn[] = [
  { key: "sku", label: "SKU", type: "text" },
  { key: "productName", label: "Product", type: "text" },
  { key: "variantLabel", label: "Variant", type: "text" },
  { key: "categoryName", label: "Category", type: "text" },
  { key: "brandName", label: "Brand", type: "text" },
  { key: "supplierName", label: "Supplier", type: "text" },
  { key: "currentStock", label: "Stock", type: "number" },
  { key: "reorderLevel", label: "Reorder At", type: "number" },
  { key: "costPrice", label: "Cost", type: "currency" },
  { key: "stockValue", label: "Stock Value", type: "currency" },
  { key: "retailValue", label: "Retail Value", type: "currency" },
  { key: "unitsSold", label: "Units Sold", type: "number" },
  { key: "dailyVelocity", label: "Daily Velocity", type: "number" },
  { key: "daysOfCover", label: "Days of Cover", type: "number" },
  { key: "state", label: "State", type: "text" },
];

const PURCHASE_COLUMNS: ExportColumn[] = [
  { key: "businessName", label: "Supplier", type: "text" },
  { key: "purchaseCount", label: "Purchases", type: "number" },
  { key: "unitsReceived", label: "Units", type: "number" },
  { key: "totalCost", label: "Total Cost", type: "currency" },
  { key: "paidAmount", label: "Paid", type: "currency" },
  { key: "dueAmount", label: "Outstanding", type: "currency" },
  { key: "share", label: "Share %", type: "percent" },
];

const PAYMENT_COLUMNS: ExportColumn[] = [
  { key: "method", label: "Method", type: "text" },
  { key: "amount", label: "Amount", type: "currency" },
  { key: "count", label: "Transactions", type: "number" },
  { key: "averageTicket", label: "Avg Ticket", type: "currency" },
  { key: "percentage", label: "Share %", type: "percent" },
  { key: "previousAmount", label: "Previous", type: "currency" },
  { key: "growth", label: "Growth %", type: "percent" },
];

const RETURN_COLUMNS: ExportColumn[] = [
  { key: "exchangeNumber", label: "Exchange No.", type: "text" },
  { key: "exchangeDate", label: "Date", type: "date" },
  { key: "originalSaleNumber", label: "Original Bill", type: "text" },
  { key: "customerName", label: "Customer", type: "text" },
  { key: "customerPhone", label: "Phone", type: "text" },
  { key: "employeeName", label: "Employee", type: "text" },
  { key: "reason", label: "Reason", type: "text" },
  { key: "returnedUnits", label: "Returned Units", type: "number" },
  { key: "issuedUnits", label: "Issued Units", type: "number" },
  { key: "returnedValue", label: "Returned Value", type: "currency" },
  { key: "issuedValue", label: "Issued Value", type: "currency" },
  { key: "priceDifference", label: "Difference", type: "currency" },
];

const STATEMENT_COLUMNS: ExportColumn[] = [
  { key: "label", label: "Line", type: "text" },
  { key: "value", label: "Amount", type: "text" },
];

// =============================================================================
// DISPATCH
// =============================================================================

/**
 * Renders one report.
 *
 * The raw query string is re-parsed through the report's OWN schema rather than
 * trusted as-is. An export URL is hand-editable and the filters it carries
 * reach a database query, so this is the same boundary the screen's endpoint
 * enforces — not a formality.
 */
export async function exportReport(
  report: ReportKey,
  format: ExportFormat,
  rawQuery: unknown
): Promise<ExportPayload> {
  switch (report) {
    case "sales": return exportSales(rawQuery, format);
    case "products": return exportProducts(rawQuery, format);
    case "categories": return exportCategories(rawQuery, format);
    case "brands": return exportBrands(rawQuery, format);
    case "customers": return exportCustomers(rawQuery, format);
    case "employees": return exportEmployees(rawQuery, format);
    case "inventory": return exportInventory(rawQuery, format);
    case "purchases": return exportPurchases(rawQuery, format);
    case "payments": return exportPayments(rawQuery, format);
    case "returns": return exportReturns(rawQuery, format);
    case "profit":
    default: return exportProfit(rawQuery, format);
  }
}

// =============================================================================
// IMPLEMENTATIONS
// =============================================================================

async function exportSales(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.salesReport.parse(rawQuery);
  const data = await reportsService.getSalesReport(query);
  const m = data.metrics;

  return renderExport(format, SALES_COLUMNS, data.series, {
    base: `sales-report-${fileStamp()}`,
    title: "Sales Report",
    subtitle: `${data.period.label} · ${inr(m.grossSales)} gross · ${m.orders} orders · AOV ${inr(m.averageOrderValue)} · margin ${m.grossMarginPercent}%`,
    sheet: "Sales",
  });
}

async function exportProducts(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.productReport.parse(rawQuery);
  const first = await reportsService.getProductReport({ ...query, page: 1, limit: PAGE_SIZE });

  const rows = [...first.data];
  const pages = Math.min(first.meta.totalPages, Math.ceil(MAX_ROWS / PAGE_SIZE));
  for (let page = 2; page <= pages; page++) {
    const next = await reportsService.getProductReport({ ...query, page, limit: PAGE_SIZE });
    rows.push(...next.data);
  }

  return renderExport(format, PRODUCT_COLUMNS, rows, {
    base: `product-report-${fileStamp()}`,
    title: "Product Performance Report",
    subtitle: `${first.period.label} · ${rows.length} of ${first.meta.total} products · sorted by ${query.sortBy} ${query.sortOrder}`,
    sheet: "Products",
  });
}

async function exportCategories(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.categoryReport.parse(rawQuery);
  const data = await reportsService.getCategoryReport(query);

  return renderExport(format, CATEGORY_COLUMNS, data.data, {
    base: `category-report-${fileStamp()}`,
    title: "Category Report",
    subtitle: `${data.period.label} · ${data.summary.categories} categories · ${inr(data.summary.revenue)} revenue`,
    sheet: "Categories",
  });
}

async function exportBrands(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.brandReport.parse(rawQuery);
  const data = await reportsService.getBrandReport(query);

  return renderExport(format, BRAND_COLUMNS, data.data, {
    base: `brand-report-${fileStamp()}`,
    title: "Brand Report",
    subtitle: `${data.period.label} · ${data.summary.brands} brands · ${inr(data.summary.revenue)} revenue · ${inr(data.summary.stockValue)} stock at cost`,
    sheet: "Brands",
  });
}

async function exportCustomers(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.customerReport.parse(rawQuery);
  const first = await reportsService.getCustomerReport({ ...query, page: 1, limit: PAGE_SIZE });

  const rows = [...first.data];
  const pages = Math.min(first.meta.totalPages, Math.ceil(MAX_ROWS / PAGE_SIZE));
  for (let page = 2; page <= pages; page++) {
    const next = await reportsService.getCustomerReport({ ...query, page, limit: PAGE_SIZE });
    rows.push(...next.data);
  }

  const s = first.segments;

  return renderExport(format, CUSTOMER_COLUMNS, rows, {
    base: `customer-report-${fileStamp()}`,
    title: "Customer Report",
    subtitle: `${first.period.label} · ${s.newCustomers} new · ${s.returningCustomers} returning · ${s.inactiveCustomers} inactive (>${s.inactiveDays}d)`,
    sheet: "Customers",
  });
}

async function exportEmployees(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.employeeReport.parse(rawQuery);
  const data = await reportsService.getEmployeeReport(query);

  return renderExport(format, EMPLOYEE_COLUMNS, data.data, {
    base: `employee-report-${fileStamp()}`,
    title: "Employee Performance Report",
    subtitle: `${data.period.label} · ${data.summary.activeSellers} of ${data.summary.employees} selling · ${inr(data.summary.revenue)} revenue`,
    sheet: "Employees",
  });
}

async function exportInventory(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.inventoryReport.parse(rawQuery);
  const first = await reportsService.getInventoryReport({ ...query, page: 1, limit: PAGE_SIZE });

  const rows = [...first.data];
  const pages = Math.min(first.meta.totalPages, Math.ceil(MAX_ROWS / PAGE_SIZE));
  for (let page = 2; page <= pages; page++) {
    const next = await reportsService.getInventoryReport({ ...query, page, limit: PAGE_SIZE });
    rows.push(...next.data);
  }

  // The four derived booleans collapse into one readable column. A spreadsheet
  // with four TRUE/FALSE columns is unusable for the person doing a stock walk.
  const withState = rows.map((r) => ({
    ...r,
    state: r.isOutOfStock
      ? "Out of stock"
      : r.isLowStock
        ? "Low stock"
        : r.isOverstocked
          ? "Overstocked"
          : r.isDeadStock
            ? "Dead stock"
            : "Healthy",
  }));

  return renderExport(format, INVENTORY_COLUMNS, withState, {
    base: `inventory-report-${fileStamp()}`,
    title: "Inventory Report",
    subtitle: `${rows.length} of ${first.meta.total} variants · ${first.bucket} · ${inr(first.valuation.totals.costValue)} at cost · ${first.velocityDays}-day velocity`,
    sheet: "Inventory",
  });
}

async function exportPurchases(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.purchaseReport.parse(rawQuery);
  const data = await reportsService.getPurchaseReport(query);

  return renderExport(format, PURCHASE_COLUMNS, data.bySupplier, {
    base: `purchase-report-${fileStamp()}`,
    title: "Purchase Report",
    subtitle: `${data.period.label} · ${data.summary.purchaseCount} purchases · ${inr(data.summary.totalCost)} cost · ${inr(data.summary.dueAmount)} outstanding · ${data.summary.pendingDeliveries} pending`,
    sheet: "Purchases",
  });
}

async function exportPayments(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.paymentReport.parse(rawQuery);
  const data = await reportsService.getPaymentReport(query);

  return renderExport(format, PAYMENT_COLUMNS, data.methods, {
    base: `payment-report-${fileStamp()}`,
    title: "Payment Report",
    subtitle: `${data.period.label} · ${inr(data.total)} collected · ${data.splitPayments.count} split bills (${data.splitPayments.percentage}%)`,
    sheet: "Payments",
  });
}

async function exportReturns(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.returnReport.parse(rawQuery);
  const first = await reportsService.getReturnReport({ ...query, page: 1, limit: PAGE_SIZE });

  const rows = [...first.data];
  const pages = Math.min(first.meta.totalPages, Math.ceil(MAX_ROWS / PAGE_SIZE));
  for (let page = 2; page <= pages; page++) {
    const next = await reportsService.getReturnReport({ ...query, page, limit: PAGE_SIZE });
    rows.push(...next.data);
  }

  const s = first.summary;

  return renderExport(format, RETURN_COLUMNS, rows, {
    base: `return-exchange-report-${fileStamp()}`,
    title: "Return & Exchange Report",
    subtitle: `${first.period.label} · ${s.exchanges} exchanges · ${s.returnedUnits} units returned · ${s.returnRatePercent}% return rate · ${inr(s.refundValue)} refunded`,
    sheet: "Returns",
  });
}

async function exportProfit(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.profitReport.parse(rawQuery);
  const data = await reportsService.getProfitReport({ ...query, includeBreakdown: true });
  const s = data.statement;

  const rows: Array<{ label: string; value: string }> = [
    { label: "Gross Sales", value: inr(s.grossSales) },
    { label: "Less: Refunds", value: inr(s.refunds) },
    { label: "NET SALES", value: inr(s.netSales) },
    { label: "", value: "" },
    { label: "Less: Cost of Goods Sold", value: inr(s.cogs) },
    { label: "GROSS PROFIT", value: inr(s.grossProfit) },
    { label: "Gross Margin", value: `${s.grossMarginPercent}%` },
    { label: "", value: "" },
    { label: "Less: Operating Expenses", value: inr(s.operatingExpenses) },
  ];

  for (const b of data.expenseBreakdown) {
    rows.push({ label: `    ${b.category}`, value: `${inr(b.amount)}  (${b.percentage}%)` });
  }

  rows.push(
    { label: "", value: "" },
    { label: "NET PROFIT", value: inr(s.netProfit) },
    { label: "Net Margin", value: `${s.netMarginPercent}%` },
    { label: "", value: "" },
    { label: "Memo: Discounts Given", value: inr(s.discounts) },
    { label: "Memo: Tax Collected", value: inr(s.tax) },
    { label: "", value: "" },
    { label: "Previous period — Net Profit", value: inr(data.previous.netProfit) },
    { label: "Previous period — Net Margin", value: `${data.previous.netMarginPercent}%` },
    { label: "Profit Growth", value: `${data.comparison.profitGrowth}%` },
    {
      label: "Margin Change",
      value: `${data.comparison.marginChange >= 0 ? "+" : ""}${data.comparison.marginChange} pts`,
    }
  );

  return renderExport(format, STATEMENT_COLUMNS, rows, {
    base: `profit-report-${fileStamp()}`,
    title: "Profit Report",
    subtitle: `${data.period.label} · Net profit ${inr(s.netProfit)} at ${s.netMarginPercent}% margin`,
    sheet: "Profit",
  });
}
