// =============================================================================
// FINANCE CONTROLLER
//
// Thin HTTP adapter: parse → call service → format. No business logic and no
// authorization decisions live here — `req.user` is passed through to the
// service, which is the single place that decides what an actor may see or do.
//
// There is deliberately NO delete handler for any financial record. The absence
// is the point: an endpoint that does not exist cannot be called by mistake,
// and financial history in this system is corrected, never erased.
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import { asyncHandler } from "../utils/asyncHandler";
import { financeValidation as v } from "../validation/finance.validation";
import * as financeService from "../services/finance.service";
import * as exportService from "../services/financeExport.service";
import type { ExportPayload } from "../utils/exportRenderer";

function sendExport(res: Response, payload: ExportPayload) {
  res.setHeader("Content-Type", payload.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${payload.filename}"`);
  res.setHeader("Cache-Control", "no-store");
  return res.status(HTTP_STATUS.OK).send(payload.body);
}

// =============================================================================
// DASHBOARD & ANALYTICS
// =============================================================================

/** GET /finance/dashboard */
export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const query = v.dashboardQuery.parse(req.query);
  const data = await financeService.getDashboard(query);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /finance/revenue */
export const getRevenue = asyncHandler(async (req: Request, res: Response) => {
  const query = v.revenueQuery.parse(req.query);
  const data = await financeService.getRevenue(query);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /finance/profit-loss */
export const getProfitLoss = asyncHandler(async (req: Request, res: Response) => {
  const query = v.profitLossQuery.parse(req.query);
  const data = await financeService.getProfitLoss(query);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /finance/cash-flow */
export const getCashFlow = asyncHandler(async (req: Request, res: Response) => {
  const query = v.cashFlowQuery.parse(req.query);
  const data = await financeService.getCashFlow(query);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /finance/payment-analytics */
export const getPaymentAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const query = v.paymentAnalyticsQuery.parse(req.query);
  const data = await financeService.getPaymentAnalytics(query);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

// =============================================================================
// EXPENSES
// =============================================================================

/** POST /finance/expenses */
export const createExpense = asyncHandler(async (req: Request, res: Response) => {
  const payload = v.createExpense.parse(req.body);
  const data = await financeService.createExpense(payload, req.user);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message:
      data.approvalStatus === "PENDING"
        ? "Expense submitted for approval."
        : "Expense recorded.",
    data,
  });
});

/** GET /finance/expenses */
export const listExpenses = asyncHandler(async (req: Request, res: Response) => {
  const query = v.expenseQuery.parse(req.query);
  const result = await financeService.listExpenses(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    summary: result.summary,
    meta: result.meta,
  });
});

/** GET /finance/expenses/:id */
export const getExpense = asyncHandler(async (req: Request, res: Response) => {
  const data = await financeService.getExpense(req.params["id"] as string);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** PATCH /finance/expenses/:id — pending expenses only. */
export const updateExpense = asyncHandler(async (req: Request, res: Response) => {
  const payload = v.updateExpense.parse(req.body);
  const data = await financeService.updateExpense(req.params["id"] as string, payload, req.user);

  return res.status(HTTP_STATUS.OK).json({ success: true, message: "Expense updated.", data });
});

/** POST /finance/expenses/:id/review */
export const reviewExpense = asyncHandler(async (req: Request, res: Response) => {
  const payload = v.reviewExpense.parse(req.body);
  const data = await financeService.reviewExpense(req.params["id"] as string, payload, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: payload.decision === "APPROVE" ? "Expense approved." : "Expense rejected.",
    data,
  });
});

/** GET /finance/expense-categories */
export const listExpenseCategories = asyncHandler(async (_req: Request, res: Response) => {
  const data = await financeService.listExpenseCategories();
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** POST /finance/expense-categories */
export const createExpenseCategory = asyncHandler(async (req: Request, res: Response) => {
  const payload = v.createExpenseCategory.parse(req.body);
  const data = await financeService.createExpenseCategory(payload, req.user);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Expense category created.",
    data,
  });
});

// =============================================================================
// SUPPLIER PAYABLES
// =============================================================================

/** GET /finance/payables */
export const listPayables = asyncHandler(async (req: Request, res: Response) => {
  const query = v.payablesQuery.parse(req.query);
  const result = await financeService.listPayables(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    summary: result.summary,
    bySupplier: result.bySupplier,
    meta: result.meta,
  });
});

/** POST /finance/supplier-payments */
export const recordSupplierPayment = asyncHandler(async (req: Request, res: Response) => {
  const payload = v.recordSupplierPayment.parse(req.body);
  const data = await financeService.recordSupplierPayment(payload, req.user);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Supplier payment recorded.",
    data,
  });
});

/** GET /finance/supplier-payments */
export const listSupplierPayments = asyncHandler(async (req: Request, res: Response) => {
  const query = v.supplierPaymentQuery.parse(req.query);
  const result = await financeService.listSupplierPayments(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    summary: result.summary,
    meta: result.meta,
  });
});

/** PATCH /finance/payables/:id/due-date */
export const setBillDueDate = asyncHandler(async (req: Request, res: Response) => {
  const payload = v.setBillDueDate.parse(req.body);
  const data = await financeService.setBillDueDate(req.params["id"] as string, payload, req.user);

  return res.status(HTTP_STATUS.OK).json({ success: true, message: "Due date updated.", data });
});

/** GET /finance/suppliers/:id/open-bills */
export const listOpenBills = asyncHandler(async (req: Request, res: Response) => {
  const data = await financeService.listOpenBillsForSupplier(req.params["id"] as string);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /finance/suppliers */
export const listSuppliers = asyncHandler(async (_req: Request, res: Response) => {
  const data = await financeService.listSuppliers();
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

// =============================================================================
// PAYROLL
// =============================================================================

/** POST /finance/payroll/generate */
export const generatePayroll = asyncHandler(async (req: Request, res: Response) => {
  const payload = v.generatePayroll.parse(req.body);
  const data = await financeService.generatePayroll(payload, req.user);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: `Payroll generated for ${data.generated} employee${data.generated === 1 ? "" : "s"}.`,
    data,
  });
});

/** GET /finance/salaries */
export const listSalaries = asyncHandler(async (req: Request, res: Response) => {
  const query = v.salaryQuery.parse(req.query);
  const result = await financeService.listSalaries(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    summary: result.summary,
    meta: result.meta,
  });
});

/** GET /finance/salaries/:id */
export const getSalary = asyncHandler(async (req: Request, res: Response) => {
  const data = await financeService.getSalary(req.params["id"] as string);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** POST /finance/salaries/:id/adjustments */
export const addSalaryAdjustment = asyncHandler(async (req: Request, res: Response) => {
  const payload = v.salaryAdjustment.parse(req.body);
  const data = await financeService.addSalaryAdjustment(
    req.params["id"] as string,
    payload,
    req.user
  );

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Salary adjustment recorded.",
    data,
  });
});

/** POST /finance/salaries/:id/pay */
export const paySalary = asyncHandler(async (req: Request, res: Response) => {
  const payload = v.paySalary.parse(req.body);
  const data = await financeService.paySalary(req.params["id"] as string, payload, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: data.status === "PAID" ? "Salary paid in full." : "Part payment recorded.",
    data,
  });
});

// =============================================================================
// EXPORTS
// =============================================================================

/** GET /finance/export/:report?format=csv|excel|pdf */
export const exportReport = asyncHandler(async (req: Request, res: Response) => {
  const { report, format } = v.exportQuery.parse({
    report: req.params["report"],
    format: req.query["format"],
  });

  const payload = await exportService.exportFinanceReport(report, format, req.query, req.user);
  return sendExport(res, payload);
});
