import { z } from "zod";
import { paginationSchema } from "./common.validation";
import { Prisma } from "../../generated/prisma";

// =============================================================================
// PRODUCT VARIANT VALIDATION
// =============================================================================

// Helper for Decimal casting in Zod
const decimalSchema = z
  .union([z.number(), z.string()])
  .transform((val) => new Prisma.Decimal(val))
  .refine((val) => val.gte(0), "Price cannot be negative");

export const productVariantValidation = {
  create: z
    .object({
      productId: z.string().cuid("Invalid Product ID format"),
      sizeId: z.string().cuid("Invalid Size ID format"),
      colorId: z.string().cuid("Invalid Color ID format"),
      sku: z.string().trim().min(3).max(50),
      barcode: z.string().trim().max(100).optional().nullable(),
      costPrice: decimalSchema,
      sellingPrice: decimalSchema,
      mrp: decimalSchema,
      reorderLevel: z.number().int().min(0).default(0),
      maximumStock: z.number().int().min(0).optional().nullable(),
      weight: z
        .union([z.number(), z.string()])
        .transform((val) => new Prisma.Decimal(val))
        .refine((val) => val.gte(0), "Weight cannot be negative")
        .optional()
        .nullable(),
      imageUrl: z.string().url().optional().nullable(),
    })
    .refine(
      (data) => data.sellingPrice.gte(data.costPrice),
      {
        message: "Selling price cannot be lower than cost price.",
        path: ["sellingPrice"],
      }
    )
    .refine(
      (data) => data.mrp.gte(data.sellingPrice),
      {
        message: "MRP cannot be lower than selling price.",
        path: ["mrp"],
      }
    ),

  update: z
    .object({
      sizeId: z.string().cuid().optional(),
      colorId: z.string().cuid().optional(),
      sku: z.string().trim().min(3).max(50).optional(),
      barcode: z.string().trim().max(100).optional().nullable(),
      costPrice: decimalSchema.optional(),
      sellingPrice: decimalSchema.optional(),
      mrp: decimalSchema.optional(),
      reorderLevel: z.number().int().min(0).optional(),
      maximumStock: z.number().int().min(0).optional().nullable(),
      weight: z
        .union([z.number(), z.string()])
        .transform((val) => new Prisma.Decimal(val))
        .refine((val) => val.gte(0), "Weight cannot be negative")
        .optional()
        .nullable(),
      imageUrl: z.string().url().optional().nullable(),
      isActive: z.boolean().optional(),
    }),
    // Complex cross-field validations (like MRP vs Selling Price) on partial updates 
    // must be handled in the Service layer, as Zod cannot compare missing fields reliably.

  listQuery: paginationSchema.extend({
    search: z.string().optional(),
    productId: z.string().cuid().optional(),
    sizeId: z.string().cuid().optional(),
    colorId: z.string().cuid().optional(),
    isActive: z
      .enum(["true", "false"])
      .transform((val) => val === "true")
      .optional(),
  }),
} as const;

export type CreateProductVariantInput = z.infer<typeof productVariantValidation.create>;
export type UpdateProductVariantInput = z.infer<typeof productVariantValidation.update>;
export type ListProductVariantsQuery = z.infer<typeof productVariantValidation.listQuery>;
