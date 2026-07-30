// =============================================================================
// INVENTORY CONTROLLER
//
// Thin HTTP adapter: parse → call service → format. No business logic and no
// authorization decisions live here — `req.user` is passed through to the
// service, which is the single place that decides what an actor may see or do.
//
// One controller serves ALL THREE route trees (owner / manager / cashier). The
// trees differ in which handlers they expose and what guard they sit behind;
// the handlers are identical because the service already narrows per actor.
// That is what stops the three surfaces from drifting apart.
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import * as inventoryService from "../services/inventory.service";
import * as analyticsService from "../services/inventoryAnalytics.service";
import * as inventoryExportService from "../services/inventoryExport.service";
import { asyncHandler } from "../utils/asyncHandler";
import { inventoryValidation } from "../validation/inventory.validation";

// =============================================================================
// STOCK OVERVIEW
// =============================================================================

/** GET /inventory/stock */
export const listStock = asyncHandler(async (req: Request, res: Response) => {
  const query = inventoryValidation.stockQuery.parse(req.query);
  const result = await inventoryService.listStock(query, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/** GET /inventory/scan?code=... — the barcode entry point. */
export const scan = asyncHandler(async (req: Request, res: Response) => {
  const { code } = inventoryValidation.scan.parse(req.query);
  const data = await inventoryService.scanCode(code, req.user);

  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /inventory/stock/:id — the details drawer. */
export const getDetail = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const data = await inventoryService.getInventoryDetail(id, req.user);

  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /inventory/stock/:id/purchases */
export const getVariantPurchases = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const data = await inventoryService.getVariantPurchases(id, req.user);

  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /inventory/stock/:id/sales */
export const getVariantSales = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const data = await inventoryService.getVariantSales(id);

  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

// =============================================================================
// MOVEMENTS (the ledger)
// =============================================================================

/** GET /inventory/movements */
export const listMovements = asyncHandler(async (req: Request, res: Response) => {
  const query = inventoryValidation.movementQuery.parse(req.query);
  const result = await inventoryService.listMovements(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// =============================================================================
// DASHBOARD & ANALYTICS
// =============================================================================

/** GET /inventory/dashboard */
export const dashboard = asyncHandler(async (req: Request, res: Response) => {
  const query = inventoryValidation.dashboardQuery.parse(req.query);
  const data = await analyticsService.getDashboard(query, req.user);

  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /inventory/valuation — OWNER only (enforced in the service). */
export const valuation = asyncHandler(async (req: Request, res: Response) => {
  const query = inventoryValidation.valuationQuery.parse(req.query);
  const data = await analyticsService.getValuation(query, req.user);

  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /inventory/reorder */
export const reorder = asyncHandler(async (req: Request, res: Response) => {
  const query = inventoryValidation.reorderQuery.parse(req.query);
  const result = await analyticsService.getReorderSuggestions(query, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/** GET /inventory/velocity?bucket=DEAD_STOCK|FAST_MOVING|SLOW_MOVING */
export const velocity = asyncHandler(async (req: Request, res: Response) => {
  const query = inventoryValidation.velocityQuery.parse(req.query);
  const result = await analyticsService.getVelocityReport(query, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/** GET /inventory/low-stock */
export const lowStock = asyncHandler(async (req: Request, res: Response) => {
  const query = inventoryValidation.stockQuery.parse(req.query);
  const result = await analyticsService.getLowStockReport(
    { page: query.page, limit: query.limit, windowDays: query.velocityDays },
    req.user
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/** GET /inventory/out-of-stock */
export const outOfStock = asyncHandler(async (req: Request, res: Response) => {
  const query = inventoryValidation.stockQuery.parse(req.query);
  const result = await analyticsService.getLowStockReport(
    {
      page: query.page,
      limit: query.limit,
      windowDays: query.velocityDays,
      outOfStockOnly: true,
    },
    req.user
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/** GET /inventory/aging */
export const aging = asyncHandler(async (req: Request, res: Response) => {
  const data = await analyticsService.getAgingReport(req.user);

  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

// =============================================================================
// RESERVATIONS
// =============================================================================

/** GET /inventory/reservations */
export const listReservations = asyncHandler(async (req: Request, res: Response) => {
  const query = inventoryValidation.reservationQuery.parse(req.query);
  const result = await inventoryService.listReservations(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/** POST /inventory/reservations */
export const createReservation = asyncHandler(async (req: Request, res: Response) => {
  const input = inventoryValidation.createReservation.parse(req.body);
  const data = await inventoryService.createReservation(input, req.user);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Stock reserved.",
    data,
  });
});

/** POST /inventory/reservations/:id/release */
export const releaseReservation = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const data = await inventoryService.releaseReservation(id, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Reservation released.",
    data,
  });
});

// =============================================================================
// ADJUSTMENTS
// =============================================================================

/** GET /inventory/adjustments */
export const listAdjustments = asyncHandler(async (req: Request, res: Response) => {
  const query = inventoryValidation.adjustmentQuery.parse(req.query);
  const result = await inventoryService.listAdjustments(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/**
 * POST /inventory/adjustments
 *
 * A manager's request is created PENDING; an owner's is auto-approved. The 201
 * body carries the resulting status either way, so the client does not have to
 * infer which happened from the caller's role.
 */
export const createAdjustment = asyncHandler(async (req: Request, res: Response) => {
  const input = inventoryValidation.createAdjustment.parse(req.body);
  const data = await inventoryService.createAdjustment(input, req.user);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message:
      data.status === "APPROVED"
        ? "Stock adjusted."
        : "Adjustment submitted for approval.",
    data,
  });
});

/** PATCH /inventory/adjustments/:id/review — OWNER only. */
export const reviewAdjustment = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const input = inventoryValidation.reviewAdjustment.parse(req.body);
  const data = await inventoryService.reviewAdjustment(id, input, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: input.approve ? "Adjustment approved and stock updated." : "Adjustment rejected.",
    data,
  });
});

// =============================================================================
// DAMAGED STOCK
// =============================================================================

/** GET /inventory/damaged */
export const listDamaged = asyncHandler(async (req: Request, res: Response) => {
  const query = inventoryValidation.damagedQuery.parse(req.query);
  const result = await inventoryService.listDamagedStock(query, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/** POST /inventory/damaged — OWNER only. */
export const reportDamage = asyncHandler(async (req: Request, res: Response) => {
  const input = inventoryValidation.reportDamage.parse(req.body);
  const data = await inventoryService.reportDamage(input, req.user);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Damaged stock recorded and removed from sellable inventory.",
    data,
  });
});

// =============================================================================
// CYCLE COUNTS
// =============================================================================

/** GET /inventory/cycle-counts */
export const listCycleCounts = asyncHandler(async (req: Request, res: Response) => {
  const query = inventoryValidation.cycleCountQuery.parse(req.query);
  const result = await inventoryService.listCycleCounts(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/** GET /inventory/cycle-counts/:id */
export const getCycleCount = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const data = await inventoryService.getCycleCount(id);

  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** POST /inventory/cycle-counts */
export const startCycleCount = asyncHandler(async (req: Request, res: Response) => {
  const input = inventoryValidation.startCycleCount.parse(req.body);
  const data = await inventoryService.startCycleCount(input, req.user);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: `Count ${data.reference} started with ${data.totalItems} item(s).`,
    data,
  });
});

/** POST /inventory/cycle-counts/:id/count — by variant id. */
export const recordCount = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const input = inventoryValidation.recordCount.parse(req.body);
  const data = await inventoryService.recordCount(id, input, req.user);

  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** POST /inventory/cycle-counts/:id/scan — by barcode, for handheld scanners. */
export const recordCountByCode = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const input = inventoryValidation.scanCount.parse(req.body);
  const data = await inventoryService.recordCountByCode(id, input, req.user);

  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * GET /inventory/export/:report?format=csv|excel|pdf
 *
 * The remaining query string is passed through as the report's filters, so an
 * export reflects exactly the screen the user was looking at. Scoping is the
 * service's job — a manager's file carries what a manager's screen shows.
 */
export const exportReport = asyncHandler(async (req: Request, res: Response) => {
  const { report, format } = inventoryValidation.exportQuery.parse({
    report: req.params["report"],
    format: req.query["format"],
  });

  // `format` is consumed above; everything else is the report's own filters.
  const { format: _format, ...filters } = req.query;

  const file = await inventoryExportService.exportInventoryReport(
    report,
    format,
    filters as Record<string, unknown>,
    req.user
  );

  // Quotes and newlines stripped so a value inside the filename can never
  // break out of the header (response splitting).
  const safeName = file.filename.replace(/["\r\n]/g, "");

  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  // The payload reflects live stock — never let a proxy serve a stale export.
  res.setHeader("Cache-Control", "no-store");

  return res.status(HTTP_STATUS.OK).send(file.body);
});

/** POST /inventory/cycle-counts/:id/complete */
export const completeCycleCount = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const input = inventoryValidation.completeCycleCount.parse(req.body);
  const data = await inventoryService.completeCycleCount(id, input, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: `Count completed — ${data.varianceItems} discrepanc${
      data.varianceItems === 1 ? "y" : "ies"
    } found.`,
    data,
  });
});
