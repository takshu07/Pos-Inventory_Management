// =============================================================================
// EXPORT RENDERER  —  shared CSV / Excel / PDF table writer
//
// Extracted from categoryExport.service so every module exports the same way.
// A second hand-rolled CSV writer elsewhere in the codebase would eventually
// disagree with this one about escaping, encoding or injection guarding — and
// the one that got it wrong would be the one nobody tested.
//
// Dependency policy: ZERO npm packages. Pulling in exceljs + a PDF stack
// (~15 MB, native bindings) to render a flat table is not a trade worth making.
//
//   CSV    RFC-4180 text with a UTF-8 BOM, so Excel opens rupee symbols and
//          accented names correctly instead of as mojibake.
//   Excel  SpreadsheetML 2003 (.xls XML). Excel, LibreOffice and Google Sheets
//          all open it natively with real typed cells, column widths and a
//          styled header row — a renamed CSV gives none of that.
//   PDF    A print-ready HTML document with @page rules, rendered to PDF by the
//          browser's own engine via Print → Save as PDF. Producing genuine PDF
//          bytes needs a real library or a headless browser; claiming
//          `application/pdf` for HTML would be a lie, so the content type stays
//          text/html and the client opens a print window.
// =============================================================================

export type ExportFormat = "csv" | "excel" | "pdf";

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

export interface ExportMeta {
  /** Filename without extension. */
  base: string;
  title: string;
  subtitle: string;
  sheet: string;
}

// ── Escaping ─────────────────────────────────────────────────────────────────

/**
 * RFC-4180 CSV escaping.
 *
 * The leading-apostrophe guard neutralises CSV injection: a cell beginning
 * =, +, - or @ is executed as a formula when the file is opened in Excel, so an
 * employee literally named `=cmd|...` would otherwise become an attack on
 * whoever opens the export.
 */
export function csvCell(value: unknown): string {
  if (value == null) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function xmlEscape(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function formatExportDate(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function isNumericColumn(type: ExportColumn["type"]): boolean {
  return type === "number" || type === "currency" || type === "percent";
}

/** Timestamp suffix so two exports on the same day never overwrite each other. */
export function fileStamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

// ── Renderers ────────────────────────────────────────────────────────────────

function toCsv(columns: ExportColumn[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map((c) => csvCell(c.label)).join(",")];

  for (const row of rows) {
    lines.push(
      columns
        .map((c) => csvCell(c.type === "date" ? formatExportDate(row[c.key]) : row[c.key]))
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

          const text = c.type === "date" ? formatExportDate(raw) : String(raw);
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
    .map((c) => `<th class="${isNumericColumn(c.type) ? "num" : ""}">${xmlEscape(c.label)}</th>`)
    .join("");

  const body = rows
    .map((row) => {
      const cells = columns
        .map((c) => {
          const raw = row[c.key];
          const text =
            c.type === "date"
              ? formatExportDate(raw)
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

/** Renders a column set + rows into the requested format. */
export function renderExport(
  format: ExportFormat,
  columns: ExportColumn[],
  rows: Record<string, unknown>[],
  meta: ExportMeta
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
