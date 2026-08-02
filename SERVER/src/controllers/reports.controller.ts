// =============================================================================
// REPORTS CONTROLLER
//
// Thin HTTP adapter: parse → call service → format. Every handler follows the
// identical three-line shape, which is what makes adding a thirteenth report a
// matter of a schema, a service function and one handler rather than a design
// decision.
//
// Exporting a report moves business data OUT of the system, so it is audited
// here — the only place in this controller that writes anything.
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import { asyncHandler } from "../utils/asyncHandler";
import { logger } from "../config/logger";
import { ActionModule, ActionType } from "../../generated/prisma";
import { auditRepository } from "../repositories/audit.repository";
import { reportsValidation as v } from "../validation/reports.validation";
import * as reportsService from "../services/reports.service";
import * as exportService from "../services/reportsExport.service";
import type { ExportPayload } from "../utils/exportRenderer";

function sendExport(res: Response, payload: ExportPayload) {
  res.setHeader("Content-Type", payload.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${payload.filename}"`);
  res.setHeader("Cache-Control", "no-store");
  return res.status(HTTP_STATUS.OK).send(payload.body);
}

// =============================================================================
// DASHBOARD
// =============================================================================

/** GET /reports/dashboard */
export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const query = v.dashboardQuery.parse(req.query);
  const data = await reportsService.getReportDashboard(query);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

// =============================================================================
// REPORTS
// =============================================================================

/** GET /reports/sales */
export const getSales = asyncHandler(async (req: Request, res: Response) => {
  const data = await reportsService.getSalesReport(v.salesReport.parse(req.query));
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /reports/products */
export const getProducts = asyncHandler(async (req: Request, res: Response) => {
  const result = await reportsService.getProductReport(v.productReport.parse(req.query));
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    period: result.period,
    summary: result.summary,
    meta: result.meta,
  });
});

/** GET /reports/categories */
export const getCategories = asyncHandler(async (req: Request, res: Response) => {
  const data = await reportsService.getCategoryReport(v.categoryReport.parse(req.query));
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /reports/brands */
export const getBrands = asyncHandler(async (req: Request, res: Response) => {
  const data = await reportsService.getBrandReport(v.brandReport.parse(req.query));
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /reports/customers */
export const getCustomers = asyncHandler(async (req: Request, res: Response) => {
  const result = await reportsService.getCustomerReport(v.customerReport.parse(req.query));
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    period: result.period,
    segments: result.segments,
    meta: result.meta,
  });
});

/** GET /reports/employees */
export const getEmployees = asyncHandler(async (req: Request, res: Response) => {
  const data = await reportsService.getEmployeeReport(v.employeeReport.parse(req.query));
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /reports/inventory */
export const getInventory = asyncHandler(async (req: Request, res: Response) => {
  const result = await reportsService.getInventoryReport(v.inventoryReport.parse(req.query));
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    period: result.period,
    bucket: result.bucket,
    velocityDays: result.velocityDays,
    valuation: result.valuation,
    movements: result.movements,
    meta: result.meta,
  });
});

/** GET /reports/purchases */
export const getPurchases = asyncHandler(async (req: Request, res: Response) => {
  const data = await reportsService.getPurchaseReport(v.purchaseReport.parse(req.query));
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /reports/payments */
export const getPayments = asyncHandler(async (req: Request, res: Response) => {
  const data = await reportsService.getPaymentReport(v.paymentReport.parse(req.query));
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /reports/returns */
export const getReturns = asyncHandler(async (req: Request, res: Response) => {
  const result = await reportsService.getReturnReport(v.returnReport.parse(req.query));
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    period: result.period,
    summary: result.summary,
    comparison: result.comparison,
    reasons: result.reasons,
    topReturnedProducts: result.topReturnedProducts,
    meta: result.meta,
  });
});

/** GET /reports/profit */
export const getProfit = asyncHandler(async (req: Request, res: Response) => {
  const data = await reportsService.getProfitReport(v.profitReport.parse(req.query));
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

// =============================================================================
// SEARCH & FILTER SOURCES
// =============================================================================

/** GET /reports/search?q=... — global search across five entities. */
export const search = asyncHandler(async (req: Request, res: Response) => {
  const query = v.globalSearch.parse(req.query);
  const data = await reportsService.globalSearch(query);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /reports/filter-options — dropdown sources for the shared filter bar. */
export const getFilterOptions = asyncHandler(async (_req: Request, res: Response) => {
  const data = await reportsService.getFilterOptions();
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

// =============================================================================
// EXPORT
// =============================================================================

/** GET /reports/export/:report?format=csv|excel|pdf */
export const exportReport = asyncHandler(async (req: Request, res: Response) => {
  const { report, format } = v.exportQuery.parse({
    report: req.params["report"],
    format: req.query["format"],
  });

  const payload = await exportService.exportReport(report, format, req.query);

  // Exporting moves business data out of the system. Fire-and-forget so a slow
  // audit write never delays the download.
  void auditRepository
    .create({
      performedBy: req.user.id,
      action: ActionType.REPORT_EXPORTED,
      module: ActionModule.REPORT,
      tableName: "reports",
      recordId: report,
      newData: { report, format, filters: req.query as Record<string, unknown> },
    })
    .catch((err) => logger.error({ err }, "[Reports] export audit write failed"));

  return sendExport(res, payload);
});
