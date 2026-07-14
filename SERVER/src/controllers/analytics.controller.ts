import type { Request, Response } from "express";
import { analyticsService } from "../services/analytics.service";
import { HTTP_STATUS } from "../constants/httpStatus";
import { analyticsFilterSchema } from "../validation/analytics.validation";
import { asyncHandler } from "../utils/asyncHandler";

export const getAvailableReports = asyncHandler(async (req: Request, res: Response) => {
  const reports = analyticsService.getAvailableReports();
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Available reports retrieved successfully",
    data: reports
  });
});

export const generateReport = asyncHandler(async (req: Request, res: Response) => {
  const query = analyticsFilterSchema.parse({ query: req.query }).query;
  const { reportName, ...filters } = query;
  
  // If user is a cashier, forcibly scope the report to their own data
  if (req.user?.role === "CASHIER") {
    filters.employeeId = req.user.id;
  }
  
  const result = await analyticsService.generateReport(reportName, filters);
  
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Report generated successfully",
    data: result
  });
});
