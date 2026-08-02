// =============================================================================
// FINANCE EXPORT SERVICE
//
// One entry point, seven reports, three formats. Each report reuses the SERVICE
// function the screen itself calls, so an export can never disagree with what
// the user was looking at — the alternative (a second query per report) is how
// exported figures drift from on-screen ones.
//
// Analytical reports (P&L, cash flow, revenue) are STATEMENTS, not tables. They
// flatten to labelled rows rather than being forced into a wide grid, because a
// P&L presented as one row of 12 columns is not something anyone can read.
// =============================================================================

import {
  renderExport,
  fileStamp,
  type ExportColumn,
  type ExportFormat,
  type ExportPayload,
} from "../utils/exportRenderer";
import type { AuthenticatedUser } from "../types/employee.types";
import * as financeService from "./finance.service";
import { financeValidation as v } from "../validation/finance.validation";
import type { FinanceExportQuery } from "../validation/finance.validation";

/** Exports read up to this many rows. See the note in cashRegisterExport. */
const MAX_ROWS = 5_000;

const inr = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${Number(n).toFixed(2)}%`;

// =============================================================================
// COLUMN SETS
// =============================================================================

const EXPENSE_COLUMNS: ExportColumn[] = [
  { key: "expenseCode", label: "Code", type: "text" },
  { key: "expenseDate", label: "Date", type: "date" },
  { key: "title", label: "Title", type: "text" },
  { key: "category", label: "Category", type: "text" },
  { key: "vendorName", label: "Vendor", type: "text" },
  { key: "amount", label: "Amount", type: "currency" },
  { key: "paymentMethod", label: "Method", type: "text" },
  { key: "approvalStatus", label: "Status", type: "text" },
  { key: "employee", label: "Recorded By", type: "text" },
  { key: "approvedBy", label: "Approved By", type: "text" },
  { key: "referenceNumber", label: "Reference", type: "text" },
];

const PAYABLES_COLUMNS: ExportColumn[] = [
  { key: "purchaseNumber", label: "Bill No.", type: "text" },
  { key: "supplierInvoiceNumber", label: "Supplier Invoice", type: "text" },
  { key: "supplier", label: "Supplier", type: "text" },
  { key: "purchaseDate", label: "Bill Date", type: "date" },
  { key: "dueDate", label: "Due Date", type: "date" },
  { key: "daysOverdue", label: "Days Overdue", type: "number" },
  { key: "ageingBucket", label: "Ageing", type: "text" },
  { key: "totalAmount", label: "Total", type: "currency" },
  { key: "paidAmount", label: "Paid", type: "currency" },
  { key: "dueAmount", label: "Outstanding", type: "currency" },
  { key: "paymentStatus", label: "Status", type: "text" },
];

const SUPPLIER_PAYMENT_COLUMNS: ExportColumn[] = [
  { key: "paymentNumber", label: "Payment No.", type: "text" },
  { key: "paidAt", label: "Date", type: "date" },
  { key: "supplier", label: "Supplier", type: "text" },
  { key: "purchase", label: "Against Bill", type: "text" },
  { key: "amount", label: "Amount", type: "currency" },
  { key: "paymentMethod", label: "Method", type: "text" },
  { key: "referenceNumber", label: "Reference", type: "text" },
  { key: "createdBy", label: "Recorded By", type: "text" },
];

const SALARY_COLUMNS: ExportColumn[] = [
  { key: "paymentNumber", label: "Payslip No.", type: "text" },
  { key: "employee", label: "Employee", type: "text" },
  { key: "employeeCode", label: "Code", type: "text" },
  { key: "period", label: "Period", type: "text" },
  { key: "baseSalary", label: "Base", type: "currency" },
  { key: "totalBonus", label: "Bonus", type: "currency" },
  { key: "totalAdvance", label: "Advance", type: "currency" },
  { key: "totalDeduction", label: "Deduction", type: "currency" },
  { key: "netPayable", label: "Net Payable", type: "currency" },
  { key: "paidAmount", label: "Paid", type: "currency" },
  { key: "dueAmount", label: "Due", type: "currency" },
  { key: "status", label: "Status", type: "text" },
  { key: "paidAt", label: "Paid On", type: "date" },
];

const REVENUE_COLUMNS: ExportColumn[] = [
  { key: "bucket", label: "Period", type: "text" },
  { key: "revenue", label: "Revenue", type: "currency" },
  { key: "orders", label: "Orders", type: "number" },
  { key: "discount", label: "Discounts", type: "currency" },
  { key: "tax", label: "Tax", type: "currency" },
];

const STATEMENT_COLUMNS: ExportColumn[] = [
  { key: "label", label: "Line", type: "text" },
  { key: "value", label: "Amount", type: "text" },
];

const CASH_FLOW_COLUMNS: ExportColumn[] = [
  { key: "bucket", label: "Period", type: "text" },
  { key: "moneyIn", label: "Money In", type: "currency" },
  { key: "moneyOut", label: "Money Out", type: "currency" },
  { key: "netFlow", label: "Net Flow", type: "currency" },
];

// =============================================================================
// DISPATCH
// =============================================================================

/**
 * Renders one finance report.
 *
 * The raw query string is re-parsed through each report's OWN schema rather
 * than trusted as-is. An export URL is hand-editable, and the filters it
 * carries reach a database query — validating them here is the same boundary
 * the screen's endpoint enforces, not a formality.
 */
export async function exportFinanceReport(
  report: FinanceExportQuery["report"],
  format: ExportFormat,
  rawQuery: unknown,
  _user: AuthenticatedUser
): Promise<ExportPayload> {
  switch (report) {
    case "expenses":
      return exportExpenses(rawQuery, format);
    case "payables":
      return exportPayables(rawQuery, format);
    case "supplier-payments":
      return exportSupplierPayments(rawQuery, format);
    case "salaries":
      return exportSalaries(rawQuery, format);
    case "revenue":
      return exportRevenue(rawQuery, format);
    case "profit-loss":
      return exportProfitLoss(rawQuery, format);
    case "cash-flow":
    default:
      return exportCashFlow(rawQuery, format);
  }
}

// =============================================================================
// TABULAR REPORTS
// =============================================================================

async function exportExpenses(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.expenseQuery.parse(rawQuery);
  const result = await financeService.listExpenses({ ...query, page: 1, limit: 100 });

  // The list endpoint caps at 100 per page; walk the pages so the export is the
  // whole filtered set rather than the first screenful.
  const rows = [...result.data];
  const totalPages = Math.min(result.meta.totalPages, Math.ceil(MAX_ROWS / 100));
  for (let page = 2; page <= totalPages; page++) {
    const next = await financeService.listExpenses({ ...query, page, limit: 100 });
    rows.push(...next.data);
  }

  return renderExport(
    format,
    EXPENSE_COLUMNS,
    rows.map((e) => ({
      expenseCode: e.expenseCode,
      expenseDate: e.expenseDate,
      title: e.title,
      category: e.category?.name ?? "—",
      vendorName: e.vendorName ?? "",
      amount: e.amount,
      paymentMethod: e.paymentMethod,
      approvalStatus: e.approvalStatus,
      employee: e.employee?.name ?? "—",
      approvedBy: e.approvedBy?.name ?? "",
      referenceNumber: e.referenceNumber ?? "",
    })),
    {
      base: `expenses-${fileStamp()}`,
      title: "Expense Report",
      subtitle: `${rows.length} expense${rows.length === 1 ? "" : "s"} · ${inr(result.summary.totalAmount)} total · ${inr(result.summary.approved.amount)} approved`,
      sheet: "Expenses",
    }
  );
}

async function exportPayables(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.payablesQuery.parse(rawQuery);
  const result = await financeService.listPayables({ ...query, page: 1, limit: 100 });

  const rows = [...result.data];
  const totalPages = Math.min(result.meta.totalPages, Math.ceil(MAX_ROWS / 100));
  for (let page = 2; page <= totalPages; page++) {
    const next = await financeService.listPayables({ ...query, page, limit: 100 });
    rows.push(...next.data);
  }

  return renderExport(
    format,
    PAYABLES_COLUMNS,
    rows.map((p) => ({
      purchaseNumber: p.purchaseNumber,
      supplierInvoiceNumber: p.supplierInvoiceNumber ?? "",
      supplier: p.supplier?.businessName ?? "—",
      purchaseDate: p.purchaseDate,
      dueDate: p.dueDate,
      daysOverdue: p.daysOverdue ?? "",
      ageingBucket: p.ageingBucket,
      totalAmount: p.totalAmount,
      paidAmount: p.paidAmount,
      dueAmount: p.dueAmount,
      paymentStatus: p.paymentStatus,
    })),
    {
      base: `supplier-payables-${fileStamp()}`,
      title: "Supplier Payables",
      subtitle: `${rows.length} bill${rows.length === 1 ? "" : "s"} · ${inr(result.summary.dueAmount)} outstanding`,
      sheet: "Payables",
    }
  );
}

async function exportSupplierPayments(
  rawQuery: unknown,
  format: ExportFormat
): Promise<ExportPayload> {
  const query = v.supplierPaymentQuery.parse(rawQuery);
  const result = await financeService.listSupplierPayments({ ...query, page: 1, limit: 100 });

  const rows = [...result.data];
  const totalPages = Math.min(result.meta.totalPages, Math.ceil(MAX_ROWS / 100));
  for (let page = 2; page <= totalPages; page++) {
    const next = await financeService.listSupplierPayments({ ...query, page, limit: 100 });
    rows.push(...next.data);
  }

  return renderExport(
    format,
    SUPPLIER_PAYMENT_COLUMNS,
    rows.map((p) => ({
      paymentNumber: p.paymentNumber,
      paidAt: p.paidAt,
      supplier: p.supplier?.businessName ?? "—",
      purchase: p.purchase?.purchaseNumber ?? "On account",
      amount: p.amount,
      paymentMethod: p.paymentMethod,
      referenceNumber: p.referenceNumber ?? "",
      createdBy: p.createdBy?.name ?? "—",
    })),
    {
      base: `supplier-payments-${fileStamp()}`,
      title: "Supplier Payments",
      subtitle: `${rows.length} payment${rows.length === 1 ? "" : "s"} · ${inr(result.summary.totalAmount)} total`,
      sheet: "Supplier Payments",
    }
  );
}

async function exportSalaries(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.salaryQuery.parse(rawQuery);
  const result = await financeService.listSalaries({ ...query, page: 1, limit: 100 });

  const rows = [...result.data];
  const totalPages = Math.min(result.meta.totalPages, Math.ceil(MAX_ROWS / 100));
  for (let page = 2; page <= totalPages; page++) {
    const next = await financeService.listSalaries({ ...query, page, limit: 100 });
    rows.push(...next.data);
  }

  return renderExport(
    format,
    SALARY_COLUMNS,
    rows.map((s) => ({
      paymentNumber: s.paymentNumber,
      employee: s.employee?.name ?? "—",
      employeeCode: s.employee?.employeeCode ?? "",
      period: s.period.label,
      baseSalary: s.baseSalary,
      totalBonus: s.totalBonus,
      totalAdvance: s.totalAdvance,
      totalDeduction: s.totalDeduction,
      netPayable: s.netPayable,
      paidAmount: s.paidAmount,
      dueAmount: s.dueAmount,
      status: s.status,
      paidAt: s.paidAt,
    })),
    {
      base: `salaries-${fileStamp()}`,
      title: "Salary Register",
      subtitle: `${rows.length} record${rows.length === 1 ? "" : "s"} · ${inr(result.summary.totalNetPayable)} payable · ${inr(result.summary.totalDue)} outstanding`,
      sheet: "Salaries",
    }
  );
}

// =============================================================================
// ANALYTICAL REPORTS
// =============================================================================

async function exportRevenue(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.revenueQuery.parse(rawQuery);
  const data = await financeService.getRevenue(query);

  return renderExport(format, REVENUE_COLUMNS, data.series, {
    base: `revenue-${fileStamp()}`,
    title: "Revenue Report",
    subtitle: `${data.period.label} · ${inr(data.totals.grossRevenue)} gross · ${data.totals.orders} orders · AOV ${inr(data.totals.averageOrderValue)}`,
    sheet: "Revenue",
  });
}

async function exportProfitLoss(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.profitLossQuery.parse(rawQuery);
  const data = await financeService.getProfitLoss({ ...query, includeBreakdown: true });
  const s = data.statement;

  const rows: Array<{ label: string; value: string }> = [
    { label: "Gross Sales", value: inr(s.grossSales) },
    { label: "Less: Refunds", value: inr(s.refunds) },
    { label: "NET SALES", value: inr(s.netSales) },
    { label: "", value: "" },
    { label: "Less: Cost of Goods Sold", value: inr(s.cogs) },
    { label: "GROSS PROFIT", value: inr(s.grossProfit) },
    { label: "Gross Margin", value: pct(s.grossMarginPercent) },
    { label: "", value: "" },
    { label: "Less: Operating Expenses", value: inr(s.operatingExpenses) },
  ];

  for (const b of data.expenseBreakdown) {
    rows.push({ label: `    ${b.category}`, value: `${inr(b.amount)}  (${pct(b.percentage)})` });
  }

  rows.push(
    { label: "", value: "" },
    { label: "NET PROFIT", value: inr(s.netProfit) },
    { label: "Net Margin", value: pct(s.netMarginPercent) },
    { label: "", value: "" },
    { label: "Memo: Discounts Given", value: inr(s.discounts) },
    { label: "Memo: Tax Collected", value: inr(s.tax) },
    { label: "", value: "" },
    { label: `Previous period (${inr(data.previous.netSales)} net sales)`, value: "" },
    { label: "    Previous Net Profit", value: inr(data.previous.netProfit) },
    { label: "    Profit Growth", value: pct(data.comparison.profitGrowth) },
    { label: "    Margin Change", value: `${data.comparison.marginChange >= 0 ? "+" : ""}${data.comparison.marginChange.toFixed(2)} pts` }
  );

  return renderExport(format, STATEMENT_COLUMNS, rows, {
    base: `profit-and-loss-${fileStamp()}`,
    title: "Profit & Loss Statement",
    subtitle: `${data.period.label} · Net profit ${inr(s.netProfit)} at ${pct(s.netMarginPercent)} margin`,
    sheet: "Profit and Loss",
  });
}

async function exportCashFlow(rawQuery: unknown, format: ExportFormat): Promise<ExportPayload> {
  const query = v.cashFlowQuery.parse(rawQuery);
  const data = await financeService.getCashFlow(query);

  // The time series is the table; the summary and the labelled breakdown ride
  // in the subtitle and as leading rows, so one sheet carries the whole story.
  const rows: Array<Record<string, unknown>> = [
    { bucket: "Opening Balance", moneyIn: "", moneyOut: "", netFlow: data.summary.openingBalance },
    ...data.series,
    { bucket: "TOTAL", moneyIn: data.summary.moneyIn, moneyOut: data.summary.moneyOut, netFlow: data.summary.netFlow },
    { bucket: "Closing Balance", moneyIn: "", moneyOut: "", netFlow: data.summary.closingBalance },
  ];

  return renderExport(format, CASH_FLOW_COLUMNS, rows, {
    base: `cash-flow-${fileStamp()}`,
    title: "Cash Flow Statement",
    subtitle: `${data.period.label} · In ${inr(data.summary.moneyIn)} · Out ${inr(data.summary.moneyOut)} · Net ${inr(data.summary.netFlow)}`,
    sheet: "Cash Flow",
  });
}
