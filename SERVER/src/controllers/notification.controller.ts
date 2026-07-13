import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/httpStatus";
import { notificationService } from "../services/notification.service";
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
  await notificationService.markAsRead(req.params["id"] as string, req.user.id);
  
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
