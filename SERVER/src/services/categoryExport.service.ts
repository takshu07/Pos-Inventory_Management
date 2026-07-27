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

export interface ExportColumn {
  key: string;
  label: string;
  /** Drives Excel cell typing and PDF column alignment. */
  type: "text" | "number" | "currency" | "percent" | "date";
}

export interface ExportPayload {
  filename: string;
  contentType: string;
  body: string;
}

// ── Escaping ─────────────────────────────────────────────────────────────────

/**
 * RFC-4180 CSV escaping.
 *
 * The leading-apostrophe guard neutralises CSV injection: a cell beginning
 * =, +, - or @ is executed as a formula when the file is opened in Excel, so a
 * category literally named `=cmd|...` would otherwise become an attack on
 * whoever opens the export.
 */
function csvCell(value: unknown): string {
  if (value == null) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function xmlEscape(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDate(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function isNumericColumn(type: ExportColumn["type"]): boolean {
  return type === "number" || type === "currency" || type === "percent";
}

// ── Renderers ────────────────────────────────────────────────────────────────

function toCsv(columns: ExportColumn[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map((c) => csvCell(c.label)).join(",")];

  for (const row of rows) {
    lines.push(
      columns
        .map((c) => csvCell(c.type === "date" ? formatDate(row[c.key]) : row[c.key]))
        .join(",")
    );
  }

  // BOM first — without it Excel decodes UTF-8 as Latin-1.
  return `﻿${lines.join("\r\n")}`;
}

function toExcel(
  columns: ExportColumn[],
  rows: Record<string, unknown>[],
  sheetName: string
): string {
  const header = columns
    .map((c) => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${xmlEscape(c.label)}</Data></Cell>`)
    .join("");

  const body = rows
    .map((row) => {
      const cells = columns
        .map((c) => {
          const raw = row[c.key];
          if (raw == null || raw === "") return "<Cell/>";

          if (isNumericColumn(c.type)) {
            const n = Number(raw);
            if (Number.isFinite(n)) {
              const style = c.type === "currency" ? ' ss:StyleID="cur"' : "";
              return `<Cell${style}><Data ss:Type="Number">${n}</Data></Cell>`;
            }
          }

          const text = c.type === "date" ? formatDate(raw) : String(raw);
          return `<Cell><Data ss:Type="String">${xmlEscape(text)}</Data></Cell>`;
        })
        .join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");

  const cols = columns
    .map((c) => `<Column ss:Width="${c.type === "text" ? 160 : 100}"/>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
          xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="hdr">
      <Font ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#1F2937" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="cur">
      <NumberFormat ss:Format="#,##0.00"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="${xmlEscape(sheetName.slice(0, 31))}">
    <Table>${cols}<Row>${header}</Row>${body}</Table>
  </Worksheet>
</Workbook>`;
}

function toPrintableHtml(
  columns: ExportColumn[],
  rows: Record<string, unknown>[],
  meta: { title: string; subtitle: string }
): string {
  const head = columns
    .map(
      (c) =>
        `<th class="${isNumericColumn(c.type) ? "num" : ""}">${xmlEscape(c.label)}</th>`
    )
    .join("");

  const body = rows
    .map((row) => {
      const cells = columns
        .map((c) => {
          const raw = row[c.key];
          const text =
            c.type === "date"
              ? formatDate(raw)
              : isNumericColumn(c.type) && raw != null && raw !== ""
                ? Number(raw).toLocaleString("en-IN", {
                    minimumFractionDigits: c.type === "number" ? 0 : 2,
                    maximumFractionDigits: 2,
                  })
                : (raw ?? "");
          const suffix = c.type === "percent" && raw != null && raw !== "" ? "%" : "";
          return `<td class="${isNumericColumn(c.type) ? "num" : ""}">${xmlEscape(text)}${suffix}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  // Self-contained: no external CSS or fonts, so it renders identically offline.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${xmlEscape(meta.title)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #111827; margin: 0; padding: 24px; font-size: 12px; }
  header { border-bottom: 2px solid #111827; padding-bottom: 12px; margin-bottom: 18px; }
  h1 { margin: 0 0 4px; font-size: 20px; letter-spacing: -0.01em; }
  .sub { color: #6b7280; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  th { background: #1f2937; color: #fff; font-weight: 600; font-size: 11px;
       text-transform: uppercase; letter-spacing: .04em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(even) { background: #f9fafb; }
  /* Repeat the header on every printed page. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  footer { margin-top: 18px; color: #9ca3af; font-size: 10px;
           display: flex; justify-content: space-between; }
  @media print { body { padding: 0; } .no-print { display: none; } }
</style>
</head>
<body>
  <header>
    <h1>${xmlEscape(meta.title)}</h1>
    <div class="sub">${xmlEscape(meta.subtitle)}</div>
  </header>
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body || `<tr><td colspan="${columns.length}">No data for the selected filters.</td></tr>`}</tbody>
  </table>
  <footer>
    <span>${rows.length} row${rows.length === 1 ? "" : "s"}</span>
    <span>Generated ${new Date().toLocaleString("en-IN")}</span>
  </footer>
  <script>window.addEventListener("load", function () { window.print(); });</script>
</body>
</html>`;
}

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

function fileStamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

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

function render(
  format: "csv" | "excel" | "pdf",
  columns: ExportColumn[],
  rows: Record<string, unknown>[],
  meta: { base: string; title: string; subtitle: string; sheet: string }
): ExportPayload {
  switch (format) {
    case "excel":
      return {
        filename: `${meta.base}.xls`,
        contentType: "application/vnd.ms-excel; charset=utf-8",
        body: toExcel(columns, rows, meta.sheet),
      };
    case "pdf":
      // Deliberately text/html — see the header note. The client opens this in
      // a print window; mislabelling it application/pdf would break every
      // consumer that trusts the content type.
      return {
        filename: `${meta.base}.html`,
        contentType: "text/html; charset=utf-8",
        body: toPrintableHtml(columns, rows, meta),
      };
    case "csv":
    default:
      return {
        filename: `${meta.base}.csv`,
        contentType: "text/csv; charset=utf-8",
        body: toCsv(columns, rows),
      };
  }
}
