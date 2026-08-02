// =============================================================================
// CASH REGISTER CONTROLLER
//
// Thin HTTP adapter: parse → call service → format. No business logic and no
// authorization decisions live here — `req.user` is passed through to the
// service, which is the single place that decides what an actor may see or do.
//
// One controller serves BOTH route trees (cashier operations and owner
// oversight). The trees differ in which handlers they expose and what guard
// they sit behind; the handlers are identical because the service already
// narrows per actor. That is what stops the two surfaces from drifting apart.
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import { asyncHandler } from "../utils/asyncHandler";
import { cashRegisterValidation as v } from "../validation/cashRegister.validation";
import * as registerService from "../services/cashRegister.service";
import * as exportService from "../services/cashRegisterExport.service";
import type { ExportPayload } from "../utils/exportRenderer";

/** Streams an export payload with the right download headers. */
function sendExport(res: Response, payload: ExportPayload) {
  res.setHeader("Content-Type", payload.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${payload.filename}"`);
  // Exports reflect a moment; a cached one would show yesterday's shift.
  res.setHeader("Cache-Control", "no-store");
  return res.status(HTTP_STATUS.OK).send(payload.body);
}

// =============================================================================
// SESSION LIFECYCLE
// =============================================================================

/** POST /register/open */
export const openRegister = asyncHandler(async (req: Request, res: Response) => {
  const payload = v.open.parse(req.body);
  const data = await registerService.openRegister(payload, req.user);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Register opened successfully.",
    data,
  });
});

/** GET /register/live — the cashier's shift dashboard. */
export const getLive = asyncHandler(async (req: Request, res: Response) => {
  const registerId = typeof req.query["registerId"] === "string" ? req.query["registerId"] : undefined;
  const data = await registerService.getLiveDashboard(req.user, registerId);

  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /register/:id/close-preview */
export const getClosePreview = asyncHandler(async (req: Request, res: Response) => {
  const data = await registerService.getClosePreview(req.params["id"] as string, req.user);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** POST /register/:id/close */
export const closeRegister = asyncHandler(async (req: Request, res: Response) => {
  const payload = v.close.parse(req.body);
  const data = await registerService.closeRegister(req.params["id"] as string, payload, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message:
      data.variance.kind === "BALANCED"
        ? "Register closed and balanced."
        : `Register closed — drawer is ${data.variance.kind.toLowerCase()} by ₹${Math.abs(data.variance.difference).toFixed(2)}.`,
    data,
  });
});

/** POST /register/:id/reconcile — supervisor sign-off. */
export const reconcileRegister = asyncHandler(async (req: Request, res: Response) => {
  const payload = v.reconcile.parse(req.body);
  const data = await registerService.reconcileRegister(req.params["id"] as string, payload, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Shift reconciled.",
    data,
  });
});

// =============================================================================
// DRAWER MOVEMENTS
// =============================================================================

/** POST /register/:id/drops */
export const createDrop = asyncHandler(async (req: Request, res: Response) => {
  const payload = v.createDrop.parse(req.body);
  const data = await registerService.createCashDrop(req.params["id"] as string, payload, req.user);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Cash drop recorded.",
    data,
  });
});

/** POST /register/:id/payouts */
export const createPayout = asyncHandler(async (req: Request, res: Response) => {
  const payload = v.createPayout.parse(req.body);
  const data = await registerService.createCashPayout(req.params["id"] as string, payload, req.user);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Cash payout recorded.",
    data,
  });
});

/** POST /register/:id/adjustments — manager/owner only, enforced in the service. */
export const createAdjustment = asyncHandler(async (req: Request, res: Response) => {
  const payload = v.createAdjustment.parse(req.body);
  const data = await registerService.createAdjustment(req.params["id"] as string, payload, req.user);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Drawer adjustment posted.",
    data,
  });
});

/** POST /register/:id/notes */
export const addNote = asyncHandler(async (req: Request, res: Response) => {
  const payload = v.addNote.parse(req.body);
  const data = await registerService.addRegisterNote(req.params["id"] as string, payload, req.user);

  return res.status(HTTP_STATUS.CREATED).json({ success: true, message: "Note added.", data });
});

// =============================================================================
// LISTS
// =============================================================================

/** GET /register/drops */
export const listDrops = asyncHandler(async (req: Request, res: Response) => {
  const query = v.dropQuery.parse(req.query);
  const result = await registerService.listCashDrops(query, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    summary: result.summary,
    meta: result.meta,
  });
});

/** GET /register/payouts */
export const listPayouts = asyncHandler(async (req: Request, res: Response) => {
  const query = v.payoutQuery.parse(req.query);
  const result = await registerService.listCashPayouts(query, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    summary: result.summary,
    meta: result.meta,
  });
});

/** GET /register/history */
export const listHistory = asyncHandler(async (req: Request, res: Response) => {
  const query = v.historyQuery.parse(req.query);
  const result = await registerService.listRegisterHistory(query, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    summary: result.summary,
    meta: result.meta,
  });
});

/** GET /register/registers — distinct till identifiers for the filter dropdown. */
export const listRegisterNumbers = asyncHandler(async (_req: Request, res: Response) => {
  const data = await registerService.listRegisterNumbers();
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /register/:id/activity */
export const listActivity = asyncHandler(async (req: Request, res: Response) => {
  const query = v.activityQuery.parse(req.query);
  const result = await registerService.listSessionActivity(
    req.params["id"] as string,
    query,
    req.user
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/** GET /register/:id/summary — the shift summary document. */
export const getSummary = asyncHandler(async (req: Request, res: Response) => {
  const data = await registerService.getShiftSummary(req.params["id"] as string, req.user);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

// =============================================================================
// EXPORTS
// =============================================================================

/** GET /register/:id/summary/export?format=pdf|csv|excel */
export const exportSummary = asyncHandler(async (req: Request, res: Response) => {
  const { format } = v.summaryExport.parse(req.query);
  const payload = await exportService.exportShiftSummary(
    req.params["id"] as string,
    format,
    req.user
  );
  return sendExport(res, payload);
});

/** GET /register/history/export */
export const exportHistory = asyncHandler(async (req: Request, res: Response) => {
  const query = v.historyExport.parse(req.query);
  const payload = await exportService.exportRegisterHistory(query, req.user);
  return sendExport(res, payload);
});

/** GET /register/drops/export */
export const exportDrops = asyncHandler(async (req: Request, res: Response) => {
  const query = v.dropQuery.parse(req.query);
  const format = v.summaryExport.parse(req.query).format;
  const payload = await exportService.exportCashDrops({ ...query, format }, req.user);
  return sendExport(res, payload);
});

/** GET /register/payouts/export */
export const exportPayouts = asyncHandler(async (req: Request, res: Response) => {
  const query = v.payoutQuery.parse(req.query);
  const format = v.summaryExport.parse(req.query).format;
  const payload = await exportService.exportCashPayouts({ ...query, format }, req.user);
  return sendExport(res, payload);
});
