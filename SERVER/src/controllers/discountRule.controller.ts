// =============================================================================
// DISCOUNT CONTROLLER
//
// Owner-facing discount administration plus the read-only pricing endpoints.
//
// Write handlers are reached only after the route layer has enforced
// requireRole("OWNER"); the pricing reads are MANAGER+OWNER and strip financial
// fields for managers. Cashiers never reach either — POS consumes effective
// prices through the normal catalog/checkout path.
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import { asyncHandler } from "../utils/asyncHandler";
import * as discountService from "../services/discountRule.service";
import {
  getEffectivePricesForProduct,
  toEffectivePriceDTO,
} from "../services/effectivePrice.service";
import { discountRuleValidation } from "../validation/discountRule.validation";
import { prisma } from "../config/prisma";
import { AppError } from "../errors/AppError";

// ── Discount administration (OWNER) ──────────────────────────────────────────

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = discountRuleValidation.listQuery.parse(req.query);
  const data = await discountService.listDiscounts(query);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Discounts retrieved successfully.",
    data,
  });
});

export const dashboard = asyncHandler(async (_req: Request, res: Response) => {
  const data = await discountService.getDashboard();
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Discount dashboard retrieved successfully.",
    data,
  });
});

export const history = asyncHandler(async (req: Request, res: Response) => {
  const query = discountRuleValidation.historyQuery.parse(req.query);
  const data = await discountService.listHistory(query);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Discount history retrieved successfully.",
    data,
  });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const data = await discountService.getDiscountById(req.params["id"] as string);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Discount retrieved successfully.",
    data,
  });
});

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const body = discountRuleValidation.createProduct.parse(req.body);
  const data = await discountService.createProductDiscount(body, req.user!.id);
  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Product discount created successfully.",
    data,
  });
});

export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const body = discountRuleValidation.createCategory.parse(req.body);
  const data = await discountService.createCategoryDiscount(body, req.user!.id);
  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Category discount created successfully.",
    data,
  });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const body = discountRuleValidation.update.parse(req.body);
  const data = await discountService.updateDiscount(req.params["id"] as string, body, req.user!.id);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Discount updated successfully.",
    data,
  });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const data = await discountService.deleteDiscount(req.params["id"] as string, req.user!.id);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Discount deleted successfully.",
    data,
  });
});

export const bulk = asyncHandler(async (req: Request, res: Response) => {
  const body = discountRuleValidation.bulk.parse(req.body);
  const data = await discountService.bulkAction(body, req.user!.id);
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: `Bulk ${body.action.toLowerCase()} applied to ${data.processed} discount(s).`,
    data,
  });
});

/** How many variants a rule would affect, before the owner commits to it. */
export const previewImpact = asyncHandler(async (req: Request, res: Response) => {
  const scope = String(req.query["scope"] ?? "").toUpperCase();
  if (scope !== "PRODUCT" && scope !== "CATEGORY") {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "scope must be PRODUCT or CATEGORY.");
  }

  const data = await discountService.previewImpact({
    scope,
    productId: req.query["productId"] as string | undefined,
    categoryId: req.query["categoryId"] as string | undefined,
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Impact preview computed.",
    data,
  });
});

// ── Pricing reads (MANAGER + OWNER) ──────────────────────────────────────────

/**
 * GET /pricing/product/:id
 *
 * The "why is this price what it is?" endpoint. Returns, per variant: MRP,
 * default discount, the discount currently in effect, the resulting selling
 * price, and WHICH rule produced it.
 *
 * Managers get the same explanation with cost/margin/profit stripped, matching
 * how managerProduct.service already handles financial fields.
 */
export const getProductPricing = asyncHandler(async (req: Request, res: Response) => {
  const productId = req.params["id"] as string;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      category: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
      variants: {
        select: { id: true, sku: true, isActive: true, size: { select: { name: true } }, color: { select: { name: true } } },
      },
    },
  });
  if (!product) throw new AppError(HTTP_STATUS.NOT_FOUND, "Product not found.");

  const includeFinancials = req.user!.role === "OWNER";
  const priced = await getEffectivePricesForProduct(productId);

  const variants = product.variants.map((v) => {
    const price = priced.get(v.id);
    return {
      variantId: v.id,
      sku: v.sku,
      isActive: v.isActive,
      size: v.size.name,
      color: v.color.name,
      pricing: price ? toEffectivePriceDTO(price, includeFinancials) : null,
    };
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Effective pricing retrieved successfully.",
    data: {
      productId: product.id,
      productName: product.name,
      category: product.category,
      brand: product.brand,
      readOnly: !includeFinancials,
      variants,
    },
  });
});
