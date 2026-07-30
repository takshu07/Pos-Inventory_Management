// =============================================================================
// CATEGORY EXPORT SERVICE  —  Phase 3 (CSV / Excel / PDF)
//
// Dependency policy: this module adds ZERO npm packages. The server currently
// ships no export library, and pulling in exceljs + pdfkit (~15 MB, native
// bindings) to render a flat table is not a trade worth making. Instead:
//
//   CSV    RFC-4180 text, with a UTF-8 BOM so Excel opens Indian rupee symbols
//          and accented product names correctly instead of mojibake.
//   Excel  SpreadsheetML 2003 (.xls XML). Excel, LibreOffice and Google Sheets
//          all open it natively with real typed cells, column widths and a
//          styled header row — a renamed CSV would give none of that.
//   PDF    A print-ready HTML document with @page rules. The browser's own
//          engine renders it via Print → Save as PDF. Producing genuine PDF
//          bytes would need a real library or a headless browser; claiming
//          `application/pdf` for HTML would be a lie, so the controller sends
//          it as HTML and the client opens a print window.
//
// Everything is streamed as a string from data the caller already filtered —
// export reuses the LIST filters verbatim, so "export what I'm looking at" is
// literally what happens.
// =============================================================================

import { categoryRepository } from "../repositories/category.repository";
import { toCategoryDTO } from "./category.service";
import { getCategoryPerformance } from "./categoryAnalytics.service";
import type { CategoryExportQuery } from "../validation/category.validation";

// The CSV / Excel / PDF writers this module used to define inline now live in
// utils/exportRenderer, shared with the workforce exports. One escaping and
// encoding implementation, not two that can disagree.
export type { ExportColumn, ExportPayload } from "../utils/exportRenderer";

import {
  fileStamp,
  formatExportDate as formatDate,
  renderExport as render,
  type ExportColumn,
  type ExportPayload,
} from "../utils/exportRenderer";

// ── Column sets ──────────────────────────────────────────────────────────────

const BASE_COLUMNS: ExportColumn[] = [
  { key: "name", label: "Category", type: "text" },
  { key: "description", label: "Description", type: "text" },
  { key: "status", label: "Status", type: "text" },
  { key: "productCount", label: "Products", type: "number" },
  { key: "searchKeywords", label: "Keywords", type: "text" },
  { key: "createdByName", label: "Created By", type: "text" },
  { key: "createdAt", label: "Created", type: "date" },
  { key: "updatedAt", label: "Updated", type: "date" },
];

const ANALYTICS_COLUMNS: ExportColumn[] = [
  { key: "revenue", label: "Revenue", type: "currency" },
  { key: "cost", label: "Cost", type: "currency" },
  { key: "profit", label: "Profit", type: "currency" },
  { key: "margin", label: "Margin %", type: "percent" },
  { key: "units", label: "Units Sold", type: "number" },
  { key: "averageSellingPrice", label: "Avg Selling Price", type: "currency" },
  { key: "returns", label: "Returns", type: "number" },
  { key: "inventoryValue", label: "Inventory Value", type: "currency" },
  { key: "growth", label: "Growth %", type: "percent" },
];


// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Export the category list under the caller's current filters, optionally
 * enriched with the analytics columns.
 */
export async function exportCategories(query: CategoryExportQuery): Promise<ExportPayload> {
  const categories = await categoryRepository.findAllForExport(query);
  const dtos = categories.map(toCategoryDTO);

  let columns = [...BASE_COLUMNS];
  let rows: Record<string, unknown>[] = dtos.map((c) => ({
    name: c.name,
    description: c.description ?? "",
    status: c.status,
    productCount: c.productCount,
    searchKeywords: c.searchKeywords ?? "",
    createdByName: c.createdBy?.name ?? "—",
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));

  if (query.includeAnalytics) {
    // Reuse the SAME performance table the dashboard renders, so an exported
    // number always matches what was on screen.
    const { rows: performance } = await getCategoryPerformance({
      period: "30d",
      limit: 50,
    } as never);
    const byId = new Map(performance.map((p) => [p.categoryId, p]));

    columns = [...columns, ...ANALYTICS_COLUMNS];
    rows = dtos.map((c, i) => {
      const perf = byId.get(c.id);
      return {
        ...rows[i],
        revenue: perf?.revenue ?? 0,
        cost: perf?.cost ?? 0,
        profit: perf?.profit ?? 0,
        margin: perf?.margin ?? 0,
        units: perf?.units ?? 0,
        averageSellingPrice: perf?.averageSellingPrice ?? 0,
        returns: perf?.returns ?? 0,
        inventoryValue: perf?.inventoryValue ?? 0,
        growth: perf?.growth ?? 0,
      };
    });
  }

  const filters = [
    query.search ? `search: "${query.search}"` : null,
    query.status ? `status: ${query.status}` : null,
    query.hasProducts === true ? "with products" : null,
    query.hasProducts === false ? "empty only" : null,
  ].filter(Boolean);

  return render(query.format, columns, rows, {
    base: `categories-${fileStamp()}`,
    title: "Category Export",
    subtitle: `${rows.length} categor${rows.length === 1 ? "y" : "ies"}${
      filters.length ? ` · ${filters.join(" · ")}` : " · all filters cleared"
    }`,
    sheet: "Categories",
  });
}

/** Export a named analytics report (Phase 3 advanced reporting). */
export function exportReport(
  format: (typeof import("../validation/category.validation").EXPORT_FORMATS)[number],
  report: { title: string; rows: Record<string, unknown>[]; period: { from: Date; to: Date } }
): ExportPayload {
  const first = report.rows[0] ?? {};

  // Derive columns from the report shape — reports choose their own projection,
  // so hard-coding a column list here would silently drop new fields.
  const columns: ExportColumn[] = Object.keys(first).map((key) => ({
    key,
    label: key
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (m) => m.toUpperCase())
      .trim(),
    type:
      key === "categoryName"
        ? "text"
        : /margin|growth|share|rate/i.test(key)
          ? "percent"
          : /revenue|cost|profit|price|value|discount/i.test(key)
            ? "currency"
            : "number",
  }));

  return render(format, columns, report.rows, {
    base: `${report.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${fileStamp()}`,
    title: report.title,
    subtitle: `${formatDate(report.period.from)} → ${formatDate(report.period.to)}`,
    sheet: report.title.slice(0, 31),
  });
}

