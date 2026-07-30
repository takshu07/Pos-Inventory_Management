// =============================================================================
// INVENTORY EXPORT SERVICE
//
// The ten inventory reports, rendered as CSV / Excel / PDF.
//
// Two decisions carried over from the workforce exports, for the same reasons:
//
//   1. EXPORTS RUN THROUGH THE SAME SERVICE FUNCTIONS THE SCREENS USE. An
//      export must agree with what the user is looking at, and the only way to
//      guarantee that is to read the same code path — including its RBAC
//      scoping, so a manager's file contains exactly the rows and columns a
//      manager's screen does. Cost columns simply arrive undefined and render
//      blank rather than needing a second permission check here.
//
//   2. EXPORTS COVER EVERY MATCHING ROW, NOT THE CURRENT PAGE. "The valuation
//      report" means the whole valuation, not page 3 of it. A hard cap keeps
//      that from becoming an unbounded query.
//
// Table rendering is delegated to utils/exportRenderer, shared with the
// category and workforce modules. Nothing about CSV escaping or SpreadsheetML
// is re-implemented here.
// =============================================================================

import {
  fileStamp,
  renderExport,
  type ExportColumn,
  type ExportFormat,
  type ExportPayload,
} from "../utils/exportRenderer";
import {
  getAgingReport,
  getLowStockReport,
  getReorderSuggestions,
  getValuation,
  getVelocityReport,
} from "./inventoryAnalytics.service";
import { listAdjustments, listMovements, listStock } from "./inventory.service";
import { ADJUSTMENT_REASON_LABEL } from "../constants/inventory";
import { inventoryValidation } from "../validation/inventory.validation";
import type { AuthenticatedUser } from "../types/employee.types";

/**
 * Upper bound on an export.
 *
 * Generous enough for a large catalogue, small enough that a malformed filter
 * cannot pull the whole table into memory.
 */
const EXPORT_LIMIT = 5000;

export type InventoryReport =
  | "stock"
  | "valuation"
  | "movements"
  | "adjustments"
  | "low-stock"
  | "out-of-stock"
  | "dead-stock"
  | "fast-moving"
  | "slow-moving"
  | "aging";

function formatDateTime(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 16).replace("T", " ");
}

// =============================================================================
// COLUMN SETS
//
// Cost columns are always DECLARED. When the actor may not see cost the value
// is simply undefined, so the cell renders blank — which is the honest result
// and avoids two divergent column lists that could drift apart.
// =============================================================================

const STOCK_COLUMNS: ExportColumn[] = [
  { key: "sku", label: "SKU", type: "text" },
  { key: "barcode", label: "Barcode", type: "text" },
  { key: "productName", label: "Product", type: "text" },
  { key: "variantName", label: "Variant", type: "text" },
  { key: "categoryName", label: "Category", type: "text" },
  { key: "brandName", label: "Brand", type: "text" },
  { key: "supplierName", label: "Supplier", type: "text" },
  { key: "currentStock", label: "On Hand", type: "number" },
  { key: "reserved", label: "Reserved", type: "number" },
  { key: "available", label: "Available", type: "number" },
  { key: "reorderLevel", label: "Reorder Level", type: "number" },
  { key: "status", label: "Status", type: "text" },
  { key: "velocity", label: "Velocity", type: "text" },
  { key: "costPrice", label: "Cost Price", type: "currency" },
  { key: "sellingPrice", label: "Selling Price", type: "currency" },
  { key: "stockValue", label: "Stock Value", type: "currency" },
  { key: "retailValue", label: "Retail Value", type: "currency" },
  { key: "unitsSold", label: "Units Sold (30d)", type: "number" },
  { key: "lastSaleAt", label: "Last Sale", type: "date" },
];

const VALUATION_COLUMNS: ExportColumn[] = [
  { key: "name", label: "Group", type: "text" },
  { key: "skuCount", label: "SKUs", type: "number" },
  { key: "quantity", label: "Units", type: "number" },
  { key: "stockValue", label: "Stock Value", type: "currency" },
  { key: "retailValue", label: "Retail Value", type: "currency" },
  { key: "potentialProfit", label: "Potential Profit", type: "currency" },
  { key: "marginPercentage", label: "Margin %", type: "percent" },
  { key: "sharePercentage", label: "Share of Value %", type: "percent" },
];

const MOVEMENT_COLUMNS: ExportColumn[] = [
  { key: "createdAt", label: "When", type: "text" },
  { key: "sku", label: "SKU", type: "text" },
  { key: "productName", label: "Product", type: "text" },
  { key: "variantName", label: "Variant", type: "text" },
  { key: "type", label: "Type", type: "text" },
  { key: "quantityChanged", label: "Change", type: "number" },
  { key: "stockBefore", label: "Stock Before", type: "number" },
  { key: "stockAfter", label: "Stock After", type: "number" },
  { key: "reason", label: "Reason", type: "text" },
  { key: "referenceNumber", label: "Reference", type: "text" },
  { key: "employeeName", label: "By", type: "text" },
];

const ADJUSTMENT_COLUMNS: ExportColumn[] = [
  { key: "createdAt", label: "Requested", type: "text" },
  { key: "sku", label: "SKU", type: "text" },
  { key: "productName", label: "Product", type: "text" },
  { key: "quantityChange", label: "Change", type: "number" },
  { key: "stockAtRequest", label: "Stock at Request", type: "number" },
  { key: "reason", label: "Reason", type: "text" },
  { key: "notes", label: "Notes", type: "text" },
  { key: "status", label: "Status", type: "text" },
  { key: "requestedByName", label: "Requested By", type: "text" },
  { key: "reviewedByName", label: "Reviewed By", type: "text" },
  { key: "reviewedAt", label: "Reviewed", type: "text" },
  { key: "reviewNotes", label: "Review Notes", type: "text" },
];

const REPLENISH_COLUMNS: ExportColumn[] = [
  { key: "sku", label: "SKU", type: "text" },
  { key: "productName", label: "Product", type: "text" },
  { key: "variantName", label: "Variant", type: "text" },
  { key: "categoryName", label: "Category", type: "text" },
  { key: "supplierName", label: "Supplier", type: "text" },
  { key: "currentStock", label: "On Hand", type: "number" },
  { key: "available", label: "Available", type: "number" },
  { key: "reorderLevel", label: "Reorder Level", type: "number" },
  { key: "averageDailySales", label: "Avg Daily Sales", type: "number" },
  { key: "daysRemaining", label: "Days of Cover", type: "number" },
  { key: "recommendedQuantity", label: "Recommended Order", type: "number" },
  { key: "leadTimeDays", label: "Lead Time (days)", type: "number" },
  { key: "estimatedCost", label: "Estimated Cost", type: "currency" },
  { key: "lastSaleAt", label: "Last Sale", type: "date" },
];

const VELOCITY_COLUMNS: ExportColumn[] = [
  { key: "sku", label: "SKU", type: "text" },
  { key: "productName", label: "Product", type: "text" },
  { key: "variantName", label: "Variant", type: "text" },
  { key: "categoryName", label: "Category", type: "text" },
  { key: "brandName", label: "Brand", type: "text" },
  { key: "currentStock", label: "On Hand", type: "number" },
  { key: "unitsSold", label: "Units Sold", type: "number" },
  { key: "revenue", label: "Revenue", type: "currency" },
  { key: "daysSinceLastSale", label: "Days Since Last Sale", type: "number" },
  { key: "daysToSell", label: "Days to Clear", type: "number" },
  { key: "stockValue", label: "Stock Value", type: "currency" },
  { key: "retailValue", label: "Retail Value", type: "currency" },
  { key: "suggestedDiscount", label: "Suggested Discount %", type: "percent" },
  { key: "lastSaleAt", label: "Last Sale", type: "date" },
];

const AGING_COLUMNS: ExportColumn[] = [
  { key: "label", label: "Age Bucket", type: "text" },
  { key: "skuCount", label: "SKUs", type: "number" },
  { key: "units", label: "Units", type: "number" },
  { key: "stockValue", label: "Stock Value", type: "currency" },
  { key: "retailValue", label: "Retail Value", type: "currency" },
];

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Builds one of the ten inventory reports.
 *
 * `query` is the SAME shape the list endpoints take, so the client passes its
 * current filters straight through and gets a file matching the screen.
 */
export async function exportInventoryReport(
  report: InventoryReport,
  format: ExportFormat,
  query: Record<string, unknown>,
  actor: AuthenticatedUser
): Promise<ExportPayload> {
  switch (report) {
    case "valuation": return exportValuation(format, query, actor);
    case "movements": return exportMovements(format, query);
    case "adjustments": return exportAdjustments(format, query);
    case "low-stock": return exportReplenishment(format, query, actor, false);
    case "out-of-stock": return exportReplenishment(format, query, actor, true);
    case "dead-stock": return exportVelocity(format, query, actor, "DEAD_STOCK");
    case "fast-moving": return exportVelocity(format, query, actor, "FAST_MOVING");
    case "slow-moving": return exportVelocity(format, query, actor, "SLOW_MOVING");
    case "aging": return exportAging(format, actor);
    case "stock":
    default: return exportStock(format, query, actor);
  }
}

async function exportStock(
  format: ExportFormat,
  query: Record<string, unknown>,
  actor: AuthenticatedUser
): Promise<ExportPayload> {
  // Parsed through the SAME schema the list endpoint uses so defaults apply.
  // Spreading a raw query string straight in leaves `velocityDays` undefined,
  // which propagates as NaN into the date arithmetic and produces an invalid
  // timestamp at the database — a 500 that typecheck cannot see.
  const parsed = inventoryValidation.stockQuery.parse(query);

  const result = await listStock({ ...parsed, page: 1, limit: EXPORT_LIMIT }, actor);

  return renderExport(format, STOCK_COLUMNS, result.data as unknown as Record<string, unknown>[], {
    base: `stock-${fileStamp()}`,
    title: "Stock Report",
    subtitle: `${result.data.length} item${result.data.length === 1 ? "" : "s"}`,
    sheet: "Stock",
  });
}

async function exportValuation(
  format: ExportFormat,
  query: Record<string, unknown>,
  actor: AuthenticatedUser
): Promise<ExportPayload> {
  // OWNER-only; the service throws for anyone else rather than silently
  // returning a report with every money column blank.
  const valuation = await getValuation(
    inventoryValidation.valuationQuery.parse(query),
    actor
  );

  return renderExport(
    format,
    VALUATION_COLUMNS,
    valuation.breakdown as unknown as Record<string, unknown>[],
    {
      base: `inventory-valuation-${fileStamp()}`,
      title: "Inventory Valuation",
      subtitle:
        `Average cost · ${valuation.totals.skuCount} SKUs · ` +
        `${valuation.totals.quantity} units · stock value ${valuation.totals.stockValue}`,
      sheet: "Valuation",
    }
  );
}

async function exportMovements(
  format: ExportFormat,
  query: Record<string, unknown>
): Promise<ExportPayload> {
  const parsed = inventoryValidation.movementQuery.parse(query);
  const result = await listMovements({ ...parsed, page: 1, limit: EXPORT_LIMIT });

  const rows = result.data.map((m) => ({
    ...m,
    createdAt: formatDateTime(m.createdAt),
  }));

  return renderExport(format, MOVEMENT_COLUMNS, rows as unknown as Record<string, unknown>[], {
    base: `inventory-movements-${fileStamp()}`,
    title: "Inventory Movement Report",
    subtitle: `${rows.length} movement${rows.length === 1 ? "" : "s"}`,
    sheet: "Movements",
  });
}

async function exportAdjustments(
  format: ExportFormat,
  query: Record<string, unknown>
): Promise<ExportPayload> {
  const parsed = inventoryValidation.adjustmentQuery.parse(query);
  const result = await listAdjustments({ ...parsed, page: 1, limit: EXPORT_LIMIT });

  const rows = result.data.map((a) => ({
    createdAt: formatDateTime(a.createdAt),
    sku: a.variant?.sku ?? "",
    productName: a.variant?.product?.name ?? "",
    quantityChange: a.quantityChange,
    stockAtRequest: a.stockAtRequest,
    reason: ADJUSTMENT_REASON_LABEL[a.reason] ?? a.reason,
    notes: a.notes ?? "",
    status: a.status,
    requestedByName: a.requestedBy
      ? `${a.requestedBy.firstName} ${a.requestedBy.lastName}`.trim()
      : "",
    reviewedByName: a.reviewedBy
      ? `${a.reviewedBy.firstName} ${a.reviewedBy.lastName}`.trim()
      : "",
    reviewedAt: formatDateTime(a.reviewedAt),
    reviewNotes: a.reviewNotes ?? "",
  }));

  return renderExport(format, ADJUSTMENT_COLUMNS, rows, {
    base: `stock-adjustments-${fileStamp()}`,
    title: "Stock Adjustment Report",
    subtitle: `${rows.length} adjustment${rows.length === 1 ? "" : "s"}`,
    sheet: "Adjustments",
  });
}

async function exportReplenishment(
  format: ExportFormat,
  query: Record<string, unknown>,
  actor: AuthenticatedUser,
  outOfStockOnly: boolean
): Promise<ExportPayload> {
  const result = await getLowStockReport(
    { page: 1, limit: EXPORT_LIMIT, outOfStockOnly, windowDays: 30 },
    actor
  );

  return renderExport(
    format,
    REPLENISH_COLUMNS,
    result.data as unknown as Record<string, unknown>[],
    {
      base: `${outOfStockOnly ? "out-of-stock" : "low-stock"}-${fileStamp()}`,
      title: outOfStockOnly ? "Out of Stock Report" : "Low Stock Report",
      subtitle: `${result.data.length} item${result.data.length === 1 ? "" : "s"}`,
      sheet: outOfStockOnly ? "Out of Stock" : "Low Stock",
    }
  );
}

async function exportVelocity(
  format: ExportFormat,
  query: Record<string, unknown>,
  actor: AuthenticatedUser,
  bucket: "DEAD_STOCK" | "FAST_MOVING" | "SLOW_MOVING"
): Promise<ExportPayload> {
  const parsed = inventoryValidation.velocityQuery.parse({ ...query, bucket });
  const result = await getVelocityReport(
    { ...parsed, bucket, page: 1, limit: EXPORT_LIMIT },
    actor
  );

  const titles = {
    DEAD_STOCK: "Dead Stock Report",
    FAST_MOVING: "Fast Moving Report",
    SLOW_MOVING: "Slow Moving Report",
  } as const;

  return renderExport(
    format,
    VELOCITY_COLUMNS,
    result.data as unknown as Record<string, unknown>[],
    {
      base: `${bucket.toLowerCase().replace("_", "-")}-${fileStamp()}`,
      title: titles[bucket],
      subtitle: `${result.data.length} item${result.data.length === 1 ? "" : "s"} · 90-day window`,
      sheet: titles[bucket].replace(" Report", ""),
    }
  );
}

async function exportAging(
  format: ExportFormat,
  actor: AuthenticatedUser
): Promise<ExportPayload> {
  const report = await getAgingReport(actor);

  return renderExport(
    format,
    AGING_COLUMNS,
    report.buckets as unknown as Record<string, unknown>[],
    {
      base: `inventory-aging-${fileStamp()}`,
      title: "Inventory Aging Report",
      subtitle: "Measured from each item's last sale",
      sheet: "Aging",
    }
  );
}
