import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/httpStatus";
import { notificationService } from "../services/notification.service";
import * as notificationFeed from "../services/notificationFeed.service";
import { notificationValidation } from "../validation/notification.validation";
import { asyncHandler } from "../utils/asyncHandler";

export const getMyNotifications = asyncHandler(async (req: Request, res: Response) => {
  const notifications = await notificationService.getMyNotifications(req.user.id, req.user.role);
  
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Notifications retrieved successfully.",
    data: notifications,
  });
});

export const markAsRead = asyncHandler(async (req: Request, res: Response) => {
  await notificationService.markAsRead(
    req.params["id"] as string,
    req.user.id,
    req.user.role
  );
  
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Notification marked as read.",
    data: null,
  });
});

export const markAllAsRead = asyncHandler(async (req: Request, res: Response) => {
  await notificationService.markAllAsRead(req.user.id, req.user.role);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "All notifications marked as read.",
    data: null,
  });
});

// =============================================================================
// ADDITIVE (2026-08-03) — the Notifications screen.
//
// The three handlers above are unchanged and still serve the Navbar bell and
// the dashboard. Everything below is new.
//
// RBAC: this whole tree is `authenticate`-only, deliberately — every employee
// has notifications and must be able to read their own. The boundary is not the
// role, it is the AUDIENCE: the repository AND-s an audience predicate into
// every query and mutation, so a CASHIER sees only rows addressed to them,
// their role, or everyone. There is no endpoint here that can return another
// user's notifications.
// =============================================================================

/** GET /notifications/feed — paginated, filtered, searchable list. */
export const listFeed = asyncHandler(async (req: Request, res: Response) => {
  const query = notificationValidation.listQuery.parse(req.query);
  const result = await notificationFeed.listNotifications(
    req.user.id,
    req.user.role,
    query
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Notifications retrieved successfully.",
    data: result.data,
    meta: result.meta,
  });
});

/** GET /notifications/summary — badge count plus category/severity chips. */
export const summary = asyncHandler(async (req: Request, res: Response) => {
  const data = await notificationFeed.getNotificationSummary(
    req.user.id,
    req.user.role
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Notification summary retrieved successfully.",
    data,
  });
});

/**
 * POST /notifications/read — bulk mark-as-read.
 *
 * Reports how many rows changed. That number can be lower than the number of
 * ids sent (already read, or not visible to this caller) and the two cases are
 * deliberately indistinguishable — see the service.
 */
export const markManyAsRead = asyncHandler(async (req: Request, res: Response) => {
  const { ids } = notificationValidation.bulkReadBody.parse(req.body);
  const result = await notificationFeed.markManyAsRead(
    ids,
    req.user.id,
    req.user.role
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: `${result.updated} notification${result.updated === 1 ? "" : "s"} marked as read.`,
    data: result,
  });
});
