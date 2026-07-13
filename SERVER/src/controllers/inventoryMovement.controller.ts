// =============================================================================
// INVENTORY MOVEMENT CONTROLLER
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import * as inventoryMovementService from "../services/inventoryMovement.service";
import { asyncHandler } from "../utils/asyncHandler";
import { inventoryMovementValidation } from "../validation/inventoryMovement.validation";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = inventoryMovementValidation.listQuery.parse(req.query);
  const result = await inventoryMovementService.listInventoryMovements(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Inventory movements retrieved successfully.",
    data: result,
  });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const result = await inventoryMovementService.getInventoryMovementById(req.params["id"] as string);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Inventory movement retrieved successfully.",
    data: result,
  });
});

export const createManualAdjustment = asyncHandler(async (req: Request, res: Response) => {
  const data = inventoryMovementValidation.create.parse(req.body);
  const result = await inventoryMovementService.createManualAdjustment(data, req.user.id);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Inventory adjustment processed successfully.",
    data: result,
  });
});
