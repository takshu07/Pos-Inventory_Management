// =============================================================================
// CATEGORY CONTROLLER
//
// Thin by design: parse → delegate → shape the HTTP envelope. No business rules
// and no Prisma access live here. Authorization is NOT decided here either — it
// is enforced by requireRole() on the routers before any of this runs.
//
// The manager-facing read handlers are the same functions the owner router
// mounts; read semantics are identical for both roles (categories carry no
// cost/margin fields, so there is nothing to strip — unlike products, where the
// manager service redacts financials).
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import * as categoryService from "../services/category.service";
import * as categoryAnalyticsService from "../services/categoryAnalytics.service";
import * as categoryExportService from "../services/categoryExport.service";
import { AppError } from "../errors/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { categoryValidation } from "../validation/category.validation";

// ── Phase 1: reads ───────────────────────────────────────────────────────────

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = categoryValidation.listQuery.parse(req.query);
  const result = await categoryService.listCategories(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Categories retrieved successfully.",
    data: result,
  });
});

export const summary = asyncHandler(async (_req: Request, res: Response) => {
  const result = await categoryService.getCategorySummary();

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Category summary retrieved successfully.",
    data: result,
  });
});

export const options = asyncHandler(async (req: Request, res: Response) => {
  const exclude = typeof req.query["exclude"] === "string" ? req.query["exclude"] : undefined;
  const result = await categoryService.getCategoryOptions(exclude);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Category options retrieved successfully.",
    data: result,
  });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const result = await categoryService.getCategoryById(req.params["id"] as string);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Category retrieved successfully.",
    data: result,
  });
});

export const listProducts = asyncHandler(async (req: Request, res: Response) => {
  const query = categoryValidation.productsQuery.parse(req.query);
  const result = await categoryService.getCategoryProducts(req.params["id"] as string, query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Category products retrieved successfully.",
    data: result,
  });
});

// ── Phase 1: writes ──────────────────────────────────────────────────────────

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = categoryValidation.create.parse(req.body);
  const result = await categoryService.createCategory(data, req.user.id);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Category created successfully.",
    data: result,
  });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = categoryValidation.update.parse(req.body);
  const result = await categoryService.updateCategory(
    req.params["id"] as string,
    data,
    req.user.id
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Category updated successfully.",
    data: result,
  });
});

export const archive = asyncHandler(async (req: Request, res: Response) => {
  const result = await categoryService.archiveCategory(req.params["id"] as string, req.user.id);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Category archived successfully.",
    data: result,
  });
});

export const activate = asyncHandler(async (req: Request, res: Response) => {
  const result = await categoryService.activateCategory(req.params["id"] as string, req.user.id);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Category activated successfully.",
    data: result,
  });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const query = categoryValidation.deleteQuery.parse(req.query);
  const result = await categoryService.deleteCategory(
    req.params["id"] as string,
    query,
    req.user.id
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message:
      result.movedProducts > 0
        ? `Category deleted. ${result.movedProducts} product${result.movedProducts === 1 ? "" : "s"} moved to ${result.movedTo?.name}.`
        : "Category deleted successfully.",
    data: result,
  });
});

// ── Phase 2 ──────────────────────────────────────────────────────────────────

export const bulkAction = asyncHandler(async (req: Request, res: Response) => {
  const data = categoryValidation.bulkAction.parse(req.body);
  const result = await categoryService.bulkAction(data, req.user.id);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: `${result.processed} categor${result.processed === 1 ? "y" : "ies"} updated.`,
    data: result,
  });
});

export const listDiscounts = asyncHandler(async (req: Request, res: Response) => {
  const result = await categoryService.getCategoryDiscounts(req.params["id"] as string);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Category discounts retrieved successfully.",
    data: result,
  });
});

export const assignDiscount = asyncHandler(async (req: Request, res: Response) => {
  const data = categoryValidation.assignDiscount.parse(req.body);
  const result = await categoryService.assignDiscount(
    req.params["id"] as string,
    data,
    req.user.id
  );

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Discount assigned to category successfully.",
    data: result,
  });
});

export const setImage = asyncHandler(async (req: Request, res: Response) => {
  const data = categoryValidation.image.parse(req.body);
  const result = await categoryService.setCategoryImage(
    req.params["id"] as string,
    data.imageUrl,
    req.user.id
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Category image updated successfully.",
    data: result,
  });
});

export const removeImage = asyncHandler(async (req: Request, res: Response) => {
  const result = await categoryService.setCategoryImage(
    req.params["id"] as string,
    null,
    req.user.id
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Category image removed successfully.",
    data: result,
  });
});

export const listActivity = asyncHandler(async (req: Request, res: Response) => {
  const query = categoryValidation.activityQuery.parse(req.query);
  const result = await categoryService.getCategoryActivity(req.params["id"] as string, query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Category activity retrieved successfully.",
    data: result,
  });
});

// ── Phase 3 ──────────────────────────────────────────────────────────────────

export const analyticsDashboard = asyncHandler(async (req: Request, res: Response) => {
  const query = categoryValidation.analyticsQuery.parse(req.query);
  const result = await categoryAnalyticsService.getAnalyticsDashboard(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Category analytics retrieved successfully.",
    data: result,
  });
});

export const categoryAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const query = categoryValidation.analyticsQuery.parse(req.query);
  const result = await categoryAnalyticsService.getSingleCategoryAnalytics(
    req.params["id"] as string,
    query
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Category analytics retrieved successfully.",
    data: result,
  });
});

export const report = asyncHandler(async (req: Request, res: Response) => {
  const key = req.params["report"] as categoryAnalyticsService.CategoryReportKey;

  if (!categoryAnalyticsService.CATEGORY_REPORTS.includes(key)) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      `Unknown report "${key}".`,
      { available: categoryAnalyticsService.CATEGORY_REPORTS }
    );
  }

  const query = categoryValidation.analyticsQuery.parse(req.query);
  const result = await categoryAnalyticsService.getReport(key, query);

  // `?format=` turns any report into a download using the same data the JSON
  // response would carry — the report is computed once, rendered two ways.
  const format = req.query["format"];
  if (typeof format === "string" && ["csv", "excel", "pdf"].includes(format)) {
    const file = categoryExportService.exportReport(format as "csv" | "excel" | "pdf", {
      title: result.title,
      rows: result.rows as Record<string, unknown>[],
      period: { from: result.period.from, to: result.period.to },
    });
    return sendFile(res, file);
  }

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Report generated successfully.",
    data: result,
  });
});

export const exportCategories = asyncHandler(async (req: Request, res: Response) => {
  const query = categoryValidation.exportQuery.parse(req.query);
  const file = await categoryExportService.exportCategories(query);
  return sendFile(res, file);
});

/**
 * Sends a generated export as a download.
 *
 * The filename is quoted and stripped of quotes/newlines so a category name can
 * never break out of the Content-Disposition header (response splitting).
 */
function sendFile(res: Response, file: categoryExportService.ExportPayload) {
  const safeName = file.filename.replace(/["\r\n]/g, "");

  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  // The payload reflects live data — never let a proxy serve a stale export.
  res.setHeader("Cache-Control", "no-store");
  return res.status(HTTP_STATUS.OK).send(file.body);
}
