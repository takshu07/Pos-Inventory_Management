// =============================================================================
// PURCHASE CONTROLLER
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import * as purchaseService from "../services/purchase.service";
import { asyncHandler } from "../utils/asyncHandler";
import { purchaseValidation } from "../validation/purchase.validation";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = purchaseValidation.listQuery.parse(req.query);
  const result = await purchaseService.listPurchases(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Purchases retrieved successfully.",
    data: result,
  });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const result = await purchaseService.getPurchaseById(req.params["id"] as string);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Purchase retrieved successfully.",
    data: result,
  });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = purchaseValidation.create.parse(req.body);
  const result = await purchaseService.createPurchase(data, req.user.id);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Purchase created successfully.",
    data: result,
  });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = purchaseValidation.update.parse(req.body);
  const result = await purchaseService.updatePurchase(req.params["id"] as string, data, req.user.id);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Purchase updated successfully.",
    data: result,
  });
});

export const receive = asyncHandler(async (req: Request, res: Response) => {
  const data = purchaseValidation.receive.parse(req.body);
  const result = await purchaseService.receivePurchase(req.params["id"] as string, data, req.user.id);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Purchase received and inventory updated successfully.",
    data: result,
  });
});
