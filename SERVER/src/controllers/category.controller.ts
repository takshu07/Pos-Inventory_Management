// =============================================================================
// CATEGORY CONTROLLER
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import * as categoryService from "../services/category.service";
import { asyncHandler } from "../utils/asyncHandler";
import { categoryValidation } from "../validation/catalog.validation";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = categoryValidation.listQuery.parse(req.query);
  const result = await categoryService.listCategories(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Categories retrieved successfully.",
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
  const result = await categoryService.updateCategory(req.params["id"] as string, data, req.user.id);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Category updated successfully.",
    data: result,
  });
});
