// =============================================================================
// AUDIT LOG CONTROLLER
//
// Thin HTTP adapter: parse → call service → format. No business logic and no
// authorization decisions — the whole route tree sits behind
// `requireRole("OWNER")`, which is where that boundary is enforced.
//
// Read-only by construction. There is no create/update/delete handler here,
// and there must never be one: audit entries are written by the module that
// performed the action, and an audit trail the API can edit is worthless as
// evidence.
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import * as auditService from "../services/audit.service";
import { asyncHandler } from "../utils/asyncHandler";
import { auditValidation } from "../validation/audit.validation";

/**
 * GET /owner/audit-logs — the paginated, filtered trail.
 *
 * Returns the shared `{ data, meta }` envelope. `meta.totalIsExact` is the one
 * unusual field: it is false when the total hit the service's count cap, and
 * the client renders "10,000+" rather than a precise-looking number it cannot
 * stand behind.
 */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = auditValidation.listQuery.parse(req.query);
  const result = await auditService.listAuditLogs(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/**
 * GET /owner/audit-logs/filters — options for the filter bar.
 *
 * Declared BEFORE the `/:id` route in the router so "filters" is never captured
 * as an entry id.
 */
export const filters = asyncHandler(async (_req: Request, res: Response) => {
  const data = await auditService.getFilterOptions();
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /owner/audit-logs/summary — counts by severity/module under the filters. */
export const summary = asyncHandler(async (req: Request, res: Response) => {
  const query = auditValidation.summaryQuery.parse(req.query);
  const data = await auditService.getAuditSummary(query);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /owner/audit-logs/:id — one entry with snapshots, diff and context. */
export const detail = asyncHandler(async (req: Request, res: Response) => {
  const data = await auditService.getAuditLog(req.params.id as string);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /owner/audit-logs/:id/related — other entries against the same record. */
export const related = asyncHandler(async (req: Request, res: Response) => {
  const query = auditValidation.relatedQuery.parse(req.query);
  const data = await auditService.getRelatedAuditLogs(
    req.params.id as string,
    query
  );
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});
