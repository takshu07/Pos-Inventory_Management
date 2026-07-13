// =============================================================================
// SUPPLIER CONTROLLER
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import * as supplierService from "../services/supplier.service";
import { asyncHandler } from "../utils/asyncHandler";
import { supplierValidation } from "../validation/catalog.validation";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = supplierValidation.listQuery.parse(req.query);
  const result = await supplierService.listSuppliers(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Suppliers retrieved successfully.",
    data: result,
  });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const result = await supplierService.getSupplierById(req.params["id"] as string);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Supplier retrieved successfully.",
    data: result,
  });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = supplierValidation.create.parse(req.body);
  const result = await supplierService.createSupplier(data, req.user.id);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Supplier created successfully.",
    data: result,
  });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = supplierValidation.update.parse(req.body);
  const result = await supplierService.updateSupplier(req.params["id"] as string, data, req.user.id);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Supplier updated successfully.",
    data: result,
  });
});
