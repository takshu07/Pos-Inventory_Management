// =============================================================================
// PRODUCT CONTROLLER
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import * as productService from "../services/product.service";
import * as productVariantService from "../services/productVariant.service";
import { asyncHandler } from "../utils/asyncHandler";
import { productValidation } from "../validation/product.validation";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = productValidation.listQuery.parse(req.query);
  const result = await productService.listProducts(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Products retrieved successfully.",
    data: result,
  });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const result = await productService.getProductById(req.params["id"] as string);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Product retrieved successfully.",
    data: result,
  });
});

export const getVariantsByProductId = asyncHandler(async (req: Request, res: Response) => {
  // We reuse the variant service list functionality, forcing the productId
  const result = await productVariantService.listProductVariants({
    page: 1,
    limit: 100, // Reasonable default for a single product's variants
    productId: req.params["id"] as string,
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Product variants retrieved successfully.",
    data: result,
  });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = productValidation.create.parse(req.body);
  const result = await productService.createProduct(data, req.user.id);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Product created successfully.",
    data: result,
  });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = productValidation.update.parse(req.body);
  const result = await productService.updateProduct(req.params["id"] as string, data, req.user.id);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Product updated successfully.",
    data: result,
  });
});
