// =============================================================================
// OWNER PRODUCT CONTROLLER
// Complete catalog administration. Every handler here is reached only after the
// route layer has enforced requireRole("OWNER"); a manager/cashier calling any
// of these is rejected with 403 before reaching this file.
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import * as ownerProductService from "../services/ownerProduct.service";
import * as ownerProductFullService from "../services/ownerProductFull.service";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { ownerProductValidation } from "../validation/ownerProduct.validation";
import { ownerProductFullValidation } from "../validation/ownerProductFull.validation";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = ownerProductValidation.listQuery.parse(req.query);
  const data = await ownerProductService.listProducts(query);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Products retrieved successfully.",
    data,
  });
});

export const stats = asyncHandler(async (_req: Request, res: Response) => {
  const data = await ownerProductService.getStats();
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Catalog statistics retrieved successfully.",
    data,
  });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const data = await ownerProductService.getProductById(req.params["id"] as string);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Product retrieved successfully.",
    data,
  });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const body = ownerProductValidation.create.parse(req.body);
  const data = await ownerProductService.createProduct(body, req.user.id);
  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Product created successfully.",
    data,
  });
});

/**
 * Full transactional create — the product creation wizard's submit endpoint.
 * Creates product + variants + opening-stock movements + audit atomically.
 */
export const createFull = asyncHandler(async (req: Request, res: Response) => {
  const body = ownerProductFullValidation.create.parse(req.body);
  const data = await ownerProductFullService.createFullProduct(body, req.user.id);
  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Product created successfully with variants and opening stock.",
    data,
  });
});

// ── Wizard lookups (sizes / colors / suppliers) — OWNER only ──────────────────

export const listSizes = asyncHandler(async (_req: Request, res: Response) => {
  const sizes = await prisma.size.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { sortOrder: "asc" },
  });
  return res.status(HTTP_STATUS.OK).json({ success: true, message: "OK", data: sizes });
});

export const listColors = asyncHandler(async (_req: Request, res: Response) => {
  const colors = await prisma.color.findMany({
    where: { isActive: true },
    select: { id: true, name: true, hexCode: true },
    orderBy: { name: "asc" },
  });
  return res.status(HTTP_STATUS.OK).json({ success: true, message: "OK", data: colors });
});

export const listSuppliers = asyncHandler(async (_req: Request, res: Response) => {
  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    select: { id: true, businessName: true },
    orderBy: { businessName: "asc" },
  });
  return res.status(HTTP_STATUS.OK).json({ success: true, message: "OK", data: suppliers });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const body = ownerProductValidation.update.parse(req.body);
  const data = await ownerProductService.updateProduct(req.params["id"] as string, body, req.user.id);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Product updated successfully.",
    data,
  });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const data = await ownerProductService.deleteProduct(req.params["id"] as string, req.user.id);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Product deleted successfully.",
    data,
  });
});

export const archive = asyncHandler(async (req: Request, res: Response) => {
  const data = await ownerProductService.archiveProduct(req.params["id"] as string, req.user.id);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Product archived successfully.",
    data,
  });
});

export const restore = asyncHandler(async (req: Request, res: Response) => {
  const data = await ownerProductService.restoreProduct(req.params["id"] as string, req.user.id);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Product restored successfully.",
    data,
  });
});

export const duplicate = asyncHandler(async (req: Request, res: Response) => {
  const data = await ownerProductService.duplicateProduct(req.params["id"] as string, req.user.id);
  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Product duplicated successfully.",
    data,
  });
});

export const updatePricing = asyncHandler(async (req: Request, res: Response) => {
  const body = ownerProductValidation.pricingUpdate.parse(req.body);
  const data = await ownerProductService.updatePricing(body, req.user.id);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Pricing updated successfully.",
    data,
  });
});

export const adjustStock = asyncHandler(async (req: Request, res: Response) => {
  const body = ownerProductValidation.stockAdjust.parse(req.body);
  const data = await ownerProductService.adjustStock(body, req.user.id);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Stock adjusted successfully.",
    data,
  });
});

// ── Scaffolded advanced operations (RBAC-protected, return 501 until built) ────

export const importProducts = asyncHandler(async (_req: Request, _res: Response) => {
  ownerProductService.importProducts();
});

export const exportProducts = asyncHandler(async (_req: Request, _res: Response) => {
  ownerProductService.exportProducts();
});
