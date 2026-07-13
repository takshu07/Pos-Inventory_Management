// =============================================================================
// PRODUCT VARIANT CONTROLLER
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import * as productVariantService from "../services/productVariant.service";
import { asyncHandler } from "../utils/asyncHandler";
import { productVariantValidation } from "../validation/productVariant.validation";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = productVariantValidation.listQuery.parse(req.query);
  const result = await productVariantService.listProductVariants(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Product variants retrieved successfully.",
    data: result,
  });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const result = await productVariantService.getProductVariantById(req.params["id"] as string);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Product variant retrieved successfully.",
    data: result,
  });
});

export const getByBarcode = asyncHandler(async (req: Request, res: Response) => {
  const result = await productVariantService.getProductVariantByBarcode(req.params["barcode"] as string);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Product variant retrieved successfully.",
    data: result,
  });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = productVariantValidation.create.parse(req.body);
  const result = await productVariantService.createProductVariant(data, req.user.id);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Product variant created successfully.",
    data: result,
  });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = productVariantValidation.update.parse(req.body);
  const result = await productVariantService.updateProductVariant(req.params["id"] as string, data, req.user.id);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Product variant updated successfully.",
    data: result,
  });
});
