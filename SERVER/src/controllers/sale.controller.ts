import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { SaleService } from "../services/sale.service";
import { asyncHandler } from "../utils/asyncHandler";
import { saleValidation } from "../validation/sale.validation";

// ============================================================================
// SALE CONTROLLER
//
// Adheres strictly to the "Thin Controller" principle.
// Contains zero business logic, zero calculations, and zero Prisma imports.
// ============================================================================

export const checkout = asyncHandler(async (req: Request, res: Response) => {
  // 1. Extract and validate payload
  const payload = saleValidation.checkout.parse(req.body);

  // 2. Extract Idempotency Key (Required for Enterprise deduplication)
  const idempotencyKey = req.headers["idempotency-key"] as string;
  if (!idempotencyKey) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      "Idempotency-Key header is required for checkout."
    );
  }

  // 3. Extract authenticated employee
  const employeeId = req.user.id;

  // 4. Delegate entirely to the orchestrator service
  const result = await SaleService.checkout(payload, employeeId, idempotencyKey);

  // 5. Return standardized response (201 Created)
  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Checkout completed successfully.",
    data: result,
  });
});

export const listSales = asyncHandler(async (req: Request, res: Response) => {
  // 1. Extract and validate query params (pagination, filters, search)
  const query = saleValidation.listQuery.parse(req.query);

  // 2. Delegate to service layer
  const result = await SaleService.listSales(query);

  // 3. Return standardized paginated response
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Sales retrieved successfully.",
    data: result,
  });
});

export const getSaleById = asyncHandler(async (req: Request, res: Response) => {
  // 1. Extract param
  const saleId = req.params["id"] as string;

  // 2. Delegate to service layer
  const result = await SaleService.getSaleById(saleId);

  // 3. Return standardized response
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Sale retrieved successfully.",
    data: result,
  });
});

export const voidSale = asyncHandler(async (req: Request, res: Response) => {
  // 1. Extract param and body
  const saleId = req.params["id"] as string;
  const payload = saleValidation.voidSale.parse(req.body);

  // 2. Extract authenticated employee
  const employeeId = req.user.id;

  // 3. Delegate void logic and inventory restoration to service
  const result = await SaleService.voidSale(saleId, employeeId, payload);

  // 4. Return standardized response
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: result.message,
    data: null,
  });
});
