// =============================================================================
// BRAND CONTROLLER
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import * as brandService from "../services/brand.service";
import { asyncHandler } from "../utils/asyncHandler";
import { brandValidation } from "../validation/catalog.validation";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = brandValidation.listQuery.parse(req.query);
  const result = await brandService.listBrands(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Brands retrieved successfully.",
    data: result,
  });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const result = await brandService.getBrandById(req.params["id"] as string);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Brand retrieved successfully.",
    data: result,
  });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = brandValidation.create.parse(req.body);
  const result = await brandService.createBrand(data, req.user.id);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Brand created successfully.",
    data: result,
  });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = brandValidation.update.parse(req.body);
  const result = await brandService.updateBrand(req.params["id"] as string, data, req.user.id);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Brand updated successfully.",
    data: result,
  });
});
