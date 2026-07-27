import { z } from "zod";
import { paginationSchema } from "./common.validation";

// =============================================================================
// OWNER PRODUCT VALIDATION
// Owner catalog administration: full CRUD, list with rich filters/sorts,
// pricing and stock adjustment payloads.
// =============================================================================

const stockStatus = z.enum(["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"]);

const sortBy = z.enum([
  "newest", // maps to createdAt desc
  "name",
  "createdAt",
  "updatedAt",
  "priceHigh",
  "priceLow",
  "stockHigh",
  "stockLow",
]);

export const ownerProductValidation = {
  listQuery: paginationSchema.extend({
    search: z.string().optional(),
    categoryId: z.string().cuid().optional(),
    brandId: z.string().cuid().optional(),
    isActive: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    stockStatus: stockStatus.optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    sortBy: sortBy.optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
  }),

  create: z.object({
    name: z.string().trim().min(3, "Product name must be at least 3 characters").max(100),
    description: z.string().trim().max(1000).optional(),
    categoryId: z.string().cuid("Invalid category ID format"),
    brandId: z.string().cuid("Invalid brand ID format").optional().nullable(),
    imageUrls: z
      .array(z.string().url("Must be a valid URL"))
      .max(5, "Maximum 5 images allowed")
      .default([]),
    searchKeywords: z.string().trim().max(500).optional(),
  }),

  update: z.object({
    name: z.string().trim().min(3).max(100).optional(),
    description: z.string().trim().max(1000).optional(),
    categoryId: z.string().cuid().optional(),
    brandId: z.string().cuid().optional().nullable(),
    imageUrls: z.array(z.string().url()).max(5).optional(),
    searchKeywords: z.string().trim().max(500).optional(),
    isActive: z.boolean().optional(),
  }),

  // PATCH /owner/products/stock — adjust a variant's stock (delegates to the
  // inventory-movement engine; never writes currentStock directly).
  stockAdjust: z.object({
    variantId: z.string().cuid(),
    // Positive = stock in, negative = stock out. Reason is required for audit.
    quantityDelta: z.number().int().refine((n) => n !== 0, "Quantity change cannot be zero"),
    reason: z.string().trim().min(3).max(200),
  }),

  // PATCH /owner/products/pricing — update a variant's BASE pricing.
  //
  // sellingPrice is NOT accepted as a free-form field: it is derived by the
  // pricing engine from (mrp − discount). There are exactly two ways to set it:
  //
  //   • derived (default)      send mrp and/or discountType+discountValue
  //   • manual (isManualPricing) send manualSellingPrice; the engine back-solves
  //                              the discount so both stay synchronised
  //
  // This mirrors the Product Wizard's Pricing step exactly.
  pricingUpdate: z
    .object({
      variantId: z.string().cuid(),
      costPrice: z.number().min(0).optional(),
      mrp: z.number().min(0).optional(),
      discountType: z.enum(["PERCENTAGE", "FLAT"]).optional(),
      discountValue: z.number().min(0).optional(),
      // Present only when the owner has enabled manual pricing.
      isManualPricing: z.boolean().optional(),
      manualSellingPrice: z.number().min(0).optional(),
    })
    .refine(
      (d) =>
        d.costPrice !== undefined ||
        d.mrp !== undefined ||
        d.discountType !== undefined ||
        d.discountValue !== undefined ||
        d.isManualPricing !== undefined ||
        d.manualSellingPrice !== undefined,
      { message: "No pricing fields provided." }
    )
    .refine((d) => !(d.isManualPricing === true && d.manualSellingPrice === undefined), {
      message: "manualSellingPrice is required when manual pricing is enabled.",
      path: ["manualSellingPrice"],
    })
    .refine((d) => !(d.discountType === "PERCENTAGE" && (d.discountValue ?? 0) > 100), {
      message: "A percentage discount cannot exceed 100%.",
      path: ["discountValue"],
    })
    // The cross-field money invariant. This endpoint previously had NO such
    // refinement — unlike variantSchema and the wizard's payload — so it could
    // set sellingPrice above MRP or below cost. Only the pairs actually present
    // in the request are compared; the service re-checks the final derived
    // triplet against the variant's stored values.
    .refine((d) => d.mrp === undefined || d.manualSellingPrice === undefined || d.mrp >= d.manualSellingPrice, {
      message: "MRP must be greater than or equal to the selling price.",
      path: ["manualSellingPrice"],
    })
    .refine((d) => d.costPrice === undefined || d.manualSellingPrice === undefined || d.manualSellingPrice >= d.costPrice, {
      message: "Selling price must be greater than or equal to the cost price.",
      path: ["manualSellingPrice"],
    })
    .refine((d) => d.costPrice === undefined || d.mrp === undefined || d.mrp >= d.costPrice, {
      message: "MRP must be greater than or equal to the cost price.",
      path: ["mrp"],
    }),
} as const;

export type OwnerListProductsQuery = z.infer<typeof ownerProductValidation.listQuery>;
export type OwnerCreateProductInput = z.infer<typeof ownerProductValidation.create>;
export type OwnerUpdateProductInput = z.infer<typeof ownerProductValidation.update>;
export type OwnerStockAdjustInput = z.infer<typeof ownerProductValidation.stockAdjust>;
export type OwnerPricingUpdateInput = z.infer<typeof ownerProductValidation.pricingUpdate>;
