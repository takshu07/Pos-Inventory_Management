// =============================================================================
// CASH REGISTER EXPORT SERVICE
//
// Renders register data through the shared exportRenderer so CSV escaping,
// Excel typing and print styling match every other module's exports. A second
// hand-rolled writer here would eventually disagree with that one about
// escaping, and the one that got it wrong would be the one nobody tested.
//
// The SHIFT SUMMARY is the exception to "everything is a flat table". A shift
// summary is a document — header block, totals block, denomination block,
// itemised drops and payouts — and flattening it into one table would produce
// something a cashier cannot hand to an owner. So the PDF path renders a
// purpose-built document, while CSV/Excel fall back to a labelled key/value
// table, which is the honest tabular representation of a document.
// =============================================================================

import {
  renderExport,
  fileStamp,
  xmlEscape,
  type ExportColumn,
  type ExportFormat,
  type ExportPayload,
} from "../utils/exportRenderer";
import type { AuthenticatedUser } from "../types/employee.types";
import { cashRegisterRepository as repo } from "../repositories/cashRegister.repository";
import * as registerService from "./cashRegister.service";
import type { RegisterHistoryExportQuery } from "../validation/cashRegister.validation";
import { formatDuration } from "../engines/cashRegister.engine";

const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const when = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

// =============================================================================
// REGISTER HISTORY
// =============================================================================

const HISTORY_COLUMNS: ExportColumn[] = [
  { key: "sessionNumber", label: "Session", type: "text" },
  { key: "registerNumber", label: "Register", type: "text" },
  { key: "employee", label: "Employee", type: "text" },
  { key: "status", label: "Status", type: "text" },
  { key: "openedAt", label: "Opened", type: "date" },
  { key: "closedAt", label: "Closed", type: "date" },
  { key: "durationLabel", label: "Duration", type: "text" },
  { key: "openingCash", label: "Opening Cash", type: "currency" },
  { key: "cashSales", label: "Cash Sales", type: "currency" },
  { key: "upiSales", label: "UPI Sales", type: "currency" },
  { key: "cardSales", label: "Card Sales", type: "currency" },
  { key: "cashDropTotal", label: "Drops", type: "currency" },
  { key: "cashPayoutTotal", label: "Payouts", type: "currency" },
  { key: "expectedCash", label: "Expected", type: "currency" },
  { key: "countedCash", label: "Counted", type: "currency" },
  { key: "difference", label: "Difference", type: "currency" },
  { key: "discrepancyReason", label: "Reason", type: "text" },
  { key: "transactionCount", label: "Transactions", type: "number" },
];

/**
 * Exports the register history for the CURRENT filter set.
 *
 * Deliberately capped at 5,000 rows. An unbounded export of a financial table
 * is a memory and timeout hazard on a remote database, and a spreadsheet nobody
 * can open is not a useful deliverable — the cap is surfaced in the subtitle so
 * a truncated export is never mistaken for a complete one.
 */
export async function exportRegisterHistory(
  query: RegisterHistoryExportQuery,
  user: AuthenticatedUser
): Promise<ExportPayload> {
  const MAX_ROWS = 5_000;
  const where = registerService.internals.buildHistoryWhere(query, user);

  const { items, total } = await repo.listSessions({
    skip: 0,
    take: MAX_ROWS,
    where,
    orderBy: { [query.sortBy]: query.sortOrder } as never,
  });

  const rows = items.map(registerService.internals.toSessionDTO).map((s) => ({
    sessionNumber: s.sessionNumber ?? s.id.slice(-8),
    registerNumber: s.registerNumber,
    employee: s.employee?.name ?? "—",
    status: s.status,
    openedAt: s.openedAt,
    closedAt: s.closedAt,
    durationLabel: s.durationLabel,
    openingCash: s.openingCash,
    cashSales: s.cashSales,
    upiSales: s.upiSales,
    cardSales: s.cardSales,
    cashDropTotal: s.cashDropTotal,
    cashPayoutTotal: s.cashPayoutTotal,
    expectedCash: s.expectedCash,
    countedCash: s.countedCash,
    difference: s.difference,
    discrepancyReason: s.discrepancyReason ?? "",
    transactionCount: s.transactionCount,
  }));

  const truncated = total > rows.length;

  return renderExport(query.format as ExportFormat, HISTORY_COLUMNS, rows, {
    base: `register-history-${fileStamp()}`,
    title: "Cash Register History",
    subtitle: truncated
      ? `${rows.length} of ${total} sessions (export capped at ${MAX_ROWS.toLocaleString("en-IN")})`
      : `${rows.length} session${rows.length === 1 ? "" : "s"}`,
    sheet: "Register History",
  });
}

// =============================================================================
// CASH DROPS & PAYOUTS
// =============================================================================

const DROP_COLUMNS: ExportColumn[] = [
  { key: "dropNumber", label: "Drop No.", type: "text" },
  { key: "createdAt", label: "Date", type: "date" },
  { key: "register", label: "Register", type: "text" },
  { key: "employee", label: "Employee", type: "text" },
  { key: "amount", label: "Amount", type: "currency" },
  { key: "reason", label: "Reason", type: "text" },
  { key: "destination", label: "Destination", type: "text" },
  { key: "referenceNumber", label: "Reference", type: "text" },
  { key: "witnessedBy", label: "Witnessed By", type: "text" },
];

const PAYOUT_COLUMNS: ExportColumn[] = [
  { key: "payoutNumber", label: "Payout No.", type: "text" },
  { key: "createdAt", label: "Date", type: "date" },
  { key: "register", label: "Register", type: "text" },
  { key: "category", label: "Category", type: "text" },
  { key: "amount", label: "Amount", type: "currency" },
  { key: "reason", label: "Reason", type: "text" },
  { key: "payeeName", label: "Paid To", type: "text" },
  { key: "employee", label: "Recorded By", type: "text" },
  { key: "approvedBy", label: "Approved By", type: "text" },
];

export async function exportCashDrops(
  query: Parameters<typeof registerService.listCashDrops>[0] & { format: ExportFormat },
  user: AuthenticatedUser
): Promise<ExportPayload> {
  const result = await registerService.listCashDrops({ ...query, page: 1, limit: 100 }, user);

  const rows = result.data.map((d) => ({
    dropNumber: d.dropNumber,
    createdAt: d.createdAt,
    register: d.register?.registerNumber ?? "—",
    employee: d.employee?.name ?? "—",
    amount: d.amount,
    reason: d.reason,
    destination: d.destination ?? "",
    referenceNumber: d.referenceNumber ?? "",
    witnessedBy: d.witnessedBy?.name ?? "",
  }));

  return renderExport(query.format, DROP_COLUMNS, rows, {
    base: `cash-drops-${fileStamp()}`,
    title: "Cash Drops",
    subtitle: `${rows.length} drop${rows.length === 1 ? "" : "s"} · ${inr(result.summary.totalAmount)} total`,
    sheet: "Cash Drops",
  });
}

export async function exportCashPayouts(
  query: Parameters<typeof registerService.listCashPayouts>[0] & { format: ExportFormat },
  user: AuthenticatedUser
): Promise<ExportPayload> {
  const result = await registerService.listCashPayouts({ ...query, page: 1, limit: 100 }, user);

  const rows = result.data.map((p) => ({
    payoutNumber: p.payoutNumber,
    createdAt: p.createdAt,
    register: p.register?.registerNumber ?? "—",
    category: p.category,
    amount: p.amount,
    reason: p.reason,
    payeeName: p.payeeName ?? "",
    employee: p.employee?.name ?? "—",
    approvedBy: p.approvedBy?.name ?? "",
  }));

  return renderExport(query.format, PAYOUT_COLUMNS, rows, {
    base: `cash-payouts-${fileStamp()}`,
    title: "Cash Payouts",
    subtitle: `${rows.length} payout${rows.length === 1 ? "" : "s"} · ${inr(result.summary.totalAmount)} total`,
    sheet: "Cash Payouts",
  });
}

// =============================================================================
// SHIFT SUMMARY
// =============================================================================

const SUMMARY_COLUMNS: ExportColumn[] = [
  { key: "label", label: "Item", type: "text" },
  { key: "value", label: "Value", type: "text" },
];

type Summary = Awaited<ReturnType<typeof registerService.getShiftSummary>>;

/** Flattens a shift summary into the labelled rows CSV/Excel can carry. */
function summaryRows(summary: Summary): Array<{ label: string; value: string }> {
  const t = summary.totals;
  const s = summary.shift;
  const d = summary.drawer;
  const totalCollected = t.cashSales + t.upiSales + t.cardSales + t.otherSales;

  return [
    { label: "Session", value: summary.session.sessionNumber ?? summary.session.id },
    { label: "Register", value: s.registerNumber },
    { label: "Employee", value: `${s.employee}${s.employeeCode ? ` (${s.employeeCode})` : ""}` },
    { label: "Opened At", value: when(s.openedAt) },
    { label: "Closed At", value: when(s.closedAt) },
    { label: "Shift Duration", value: s.durationLabel },
    { label: "Status", value: summary.session.status },
    { label: "—", value: "—" },
    { label: "Cash Sales", value: inr(t.cashSales) },
    { label: "UPI Sales", value: inr(t.upiSales) },
    { label: "Card Sales", value: inr(t.cardSales) },
    { label: "Other Tenders", value: inr(t.otherSales) },
    { label: "Total Money Collected", value: inr(totalCollected) },
    { label: "Cash Refunds", value: inr(t.refunds) },
    { label: "Net Collected", value: inr(totalCollected - t.refunds) },
    { label: "Split Payments", value: inr(t.splitSales) },
    { label: "Discounts", value: inr(t.discounts) },
    { label: "Transactions", value: String(t.transactionCount) },
    { label: "—", value: "—" },
    // Drawer reconciliation — cash only, and these lines sum to the total.
    { label: "Opening Float", value: inr(d.openingFloat) },
    { label: "Cash Collected", value: inr(d.cashCollected) },
    { label: "Cash Refunds (out)", value: inr(d.cashRefunds) },
    { label: "Cash Payouts", value: inr(d.cashPayouts) },
    { label: "Cash Drops", value: inr(d.cashDrops) },
    { label: "Other Cash Adjustments", value: inr(d.otherAdjustments) },
    { label: "Expected in Drawer", value: inr(d.expectedInDrawer) },
    { label: "Closing Cash (Counted)", value: inr(t.countedCash) },
    {
      label: "Difference",
      value:
        t.difference === null
          ? "—"
          : `${inr(t.difference)} (${t.difference === 0 ? "Balanced" : t.difference > 0 ? "Over" : "Short"})`,
    },
    { label: "Discrepancy Reason", value: s.discrepancyReason ?? "—" },
    { label: "Closed By", value: s.closedBy ?? "—" },
    { label: "Reconciled By", value: s.reconciledBy ?? "—" },
    { label: "—", value: "—" },
    // Informational: merchandise and account credit, not money. Excluded from
    // every cash total above.
    { label: "Exchange Value Issued (informational)", value: inr(t.exchanges) },
    {
      label: "Store Credit Refunds (informational)",
      value: inr(t.storeCreditRefunds ?? 0),
    },
  ];
}

/**
 * A print-ready shift summary document.
 *
 * Served as text/html rather than a fabricated application/pdf, matching the
 * policy documented in exportRenderer: the client opens it in a print window
 * and the browser's own engine produces the PDF. Claiming a content type we do
 * not produce would break every consumer that trusts it.
 */
function renderSummaryDocument(summary: Summary): string {
  const t = summary.totals;
  const s = summary.shift;
  const d = summary.drawer;

  const row = (label: string, value: string, cls = "") =>
    `<tr class="${cls}"><td>${xmlEscape(label)}</td><td class="num">${xmlEscape(value)}</td></tr>`;

  const denomRows = summary.denominations.length
    ? summary.denominations
        .map(
          (d) =>
            `<tr><td>₹${d.denomination}</td><td class="num">${d.count}</td><td class="num">${xmlEscape(inr(d.value))}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="3" class="muted">No denomination count recorded.</td></tr>`;

  const dropRows = summary.drops.length
    ? summary.drops
        .map(
          (d) =>
            `<tr><td>${xmlEscape(d.dropNumber)}</td><td>${xmlEscape(when(d.createdAt))}</td><td>${xmlEscape(d.reason)}</td><td class="num">${xmlEscape(inr(d.amount))}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="muted">No cash drops this shift.</td></tr>`;

  const payoutRows = summary.payouts.length
    ? summary.payouts
        .map(
          (p) =>
            `<tr><td>${xmlEscape(p.payoutNumber)}</td><td>${xmlEscape(p.category)}</td><td>${xmlEscape(p.reason)}</td><td class="num">${xmlEscape(inr(p.amount))}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="muted">No payouts this shift.</td></tr>`;

  const varianceClass =
    t.difference === null || t.difference === 0 ? "ok" : t.difference > 0 ? "over" : "short";
  const varianceLabel =
    t.difference === null
      ? "Shift still open"
      : t.difference === 0
        ? "Balanced"
        : t.difference > 0
          ? `Over by ${inr(t.difference)}`
          : `Short by ${inr(Math.abs(t.difference))}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Shift Summary — ${xmlEscape(summary.session.sessionNumber ?? summary.session.id)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #111827; margin: 0; padding: 24px; font-size: 12px; }
  header { border-bottom: 2px solid #111827; padding-bottom: 12px; margin-bottom: 18px; }
  h1 { margin: 0 0 4px; font-size: 20px; letter-spacing: -0.01em; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em;
       color: #6b7280; margin: 22px 0 8px; }
  .sub { color: #6b7280; font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 24px; margin-bottom: 4px; }
  .grid div { display: flex; justify-content: space-between; padding: 3px 0;
              border-bottom: 1px dotted #e5e7eb; }
  .grid span:last-child { font-variant-numeric: tabular-nums; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  th { background: #1f2937; color: #fff; font-weight: 600; font-size: 10px;
       text-transform: uppercase; letter-spacing: .04em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 700; border-top: 2px solid #111827; }
  .muted { color: #9ca3af; font-style: italic; }
  .variance { margin-top: 14px; padding: 12px 14px; border-radius: 8px; font-weight: 700;
              display: flex; justify-content: space-between; }
  .variance.ok    { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .variance.over  { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
  .variance.short { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
  .reason { margin-top: 8px; padding: 10px 12px; background: #f9fafb;
            border-left: 3px solid #9ca3af; color: #374151; }
  .sign { margin-top: 34px; display: flex; gap: 40px; }
  .sign div { flex: 1; border-top: 1px solid #9ca3af; padding-top: 6px; color: #6b7280; }
  footer { margin-top: 24px; color: #9ca3af; font-size: 10px;
           display: flex; justify-content: space-between; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <header>
    <h1>Shift Summary</h1>
    <div class="sub">
      ${xmlEscape(summary.session.sessionNumber ?? summary.session.id)} ·
      Register ${xmlEscape(s.registerNumber)} ·
      ${xmlEscape(s.employee)}${s.employeeCode ? ` (${xmlEscape(s.employeeCode)})` : ""}
      ${summary.isLive ? " · <strong>SHIFT STILL OPEN — figures are provisional</strong>" : ""}
    </div>
  </header>

  <h2>Shift</h2>
  <div class="grid">
    <div><span>Opened</span><span>${xmlEscape(when(s.openedAt))}</span></div>
    <div><span>Closed</span><span>${xmlEscape(when(s.closedAt))}</span></div>
    <div><span>Duration</span><span>${xmlEscape(s.durationLabel)}</span></div>
    <div><span>Transactions</span><span>${t.transactionCount}</span></div>
  </div>

  <h2>Sales by Tender</h2>
  <table>
    <tbody>
      ${row("Cash Sales", inr(t.cashSales))}
      ${row("UPI Sales", inr(t.upiSales))}
      ${row("Card Sales", inr(t.cardSales))}
      ${row("Other Tenders", inr(t.otherSales))}
      ${row("Split Payments", inr(t.splitSales))}
      ${row("Discounts Given", inr(t.discounts))}
      ${row("Total Collected", inr(t.cashSales + t.upiSales + t.cardSales + t.otherSales), "total")}
      ${row("− Cash Refunds", inr(t.refunds))}
      ${row("Net Collected", inr(t.cashSales + t.upiSales + t.cardSales + t.otherSales - t.refunds), "total")}
    </tbody>
  </table>

  <h2>Drawer Reconciliation</h2>
  <table>
    <tbody>
      ${row("Opening Float", inr(d.openingFloat))}
      ${row("+ Cash Collected", inr(d.cashCollected))}
      ${row("− Cash Refunds", inr(d.cashRefunds))}
      ${row("− Cash Payouts", inr(d.cashPayouts))}
      ${row("− Cash Drops", inr(d.cashDrops))}
      ${d.otherAdjustments !== 0 ? row("± Other Cash Adjustments", inr(d.otherAdjustments)) : ""}
      ${row("Expected in Drawer", inr(d.expectedInDrawer), "total")}
      ${row("Closing Cash (Counted)", inr(t.countedCash))}
    </tbody>
  </table>

  <h2>Informational — Not Cash</h2>
  <table>
    <tbody>
      ${row("Exchange Value Issued", inr(t.exchanges))}
      ${row("Store Credit Refunds", inr(t.storeCreditRefunds ?? 0))}
    </tbody>
  </table>
  <div class="reason">
    These are merchandise and account-credit values. They move no notes and are
    excluded from every cash and drawer total above.
  </div>

  <div class="variance ${varianceClass}">
    <span>${xmlEscape(varianceLabel)}</span>
    <span>${xmlEscape(t.difference === null ? "" : inr(t.difference))}</span>
  </div>
  ${s.discrepancyReason ? `<div class="reason"><strong>Reason:</strong> ${xmlEscape(s.discrepancyReason)}</div>` : ""}

  <h2>Denomination Count</h2>
  <table>
    <thead><tr><th>Denomination</th><th class="num">Count</th><th class="num">Value</th></tr></thead>
    <tbody>${denomRows}</tbody>
  </table>

  <h2>Cash Drops</h2>
  <table>
    <thead><tr><th>Drop No.</th><th>Time</th><th>Reason</th><th class="num">Amount</th></tr></thead>
    <tbody>${dropRows}</tbody>
  </table>

  <h2>Cash Payouts</h2>
  <table>
    <thead><tr><th>Payout No.</th><th>Category</th><th>Reason</th><th class="num">Amount</th></tr></thead>
    <tbody>${payoutRows}</tbody>
  </table>

  <div class="sign">
    <div>Cashier — ${xmlEscape(s.employee)}</div>
    <div>Verified by — ${xmlEscape(s.reconciledBy ?? s.closedBy ?? "")}</div>
  </div>

  <footer>
    <span>${xmlEscape(summary.session.sessionNumber ?? "")}</span>
    <span>Generated ${new Date().toLocaleString("en-IN")}</span>
  </footer>
  <script>window.addEventListener("load", function () { window.print(); });</script>
</body>
</html>`;
}

export async function exportShiftSummary(
  registerId: string,
  format: ExportFormat,
  user: AuthenticatedUser
): Promise<ExportPayload> {
  const summary = await registerService.getShiftSummary(registerId, user);
  const base = `shift-summary-${summary.session.sessionNumber ?? registerId.slice(-8)}`;

  if (format === "pdf") {
    return {
      filename: `${base}.html`,
      contentType: "text/html; charset=utf-8",
      body: renderSummaryDocument(summary),
    };
  }

  return renderExport(format, SUMMARY_COLUMNS, summaryRows(summary), {
    base,
    title: "Shift Summary",
    subtitle: `${summary.shift.registerNumber} · ${summary.shift.employee} · ${formatDuration(summary.shift.durationMinutes)}`,
    sheet: "Shift Summary",
  });
}
