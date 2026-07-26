// =============================================================================
// MANAGER PRODUCT CONTROLLER
// Operational, READ-ONLY catalog for managers. Only GET-style handlers exist.
// Financial fields are stripped in the service before they ever reach here.
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import * as managerProductService from "../services/managerProduct.service";
import { asyncHandler } from "../utils/asyncHandler";
import { managerProductValidation } from "../validation/managerProduct.validation";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = managerProductValidation.listQuery.parse(req.query);
  const data = await managerProductService.listProducts(query);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Products retrieved successfully.",
    data,
  });
});

export const search = asyncHandler(async (req: Request, res: Response) => {
  const query = managerProductValidation.searchQuery.parse(req.query);
  const data = await managerProductService.searchProducts(query);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Products searched successfully.",
    data,
  });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const data = await managerProductService.getProductById(req.params["id"] as string);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Product retrieved successfully.",
    data,
  });
});

export const listCategories = asyncHandler(async (_req: Request, res: Response) => {
  const data = await managerProductService.listCategories();
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Categories retrieved successfully.",
    data,
  });
});

export const listBrands = asyncHandler(async (_req: Request, res: Response) => {
  const data = await managerProductService.listBrands();
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Brands retrieved successfully.",
    data,
  });
});
