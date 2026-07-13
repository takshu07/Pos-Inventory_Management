import { z } from "zod";
import { paginationSchema } from "./common.validation";

// =============================================================================
// PRODUCT VALIDATION
// =============================================================================

export const productValidation = {
  create: z.object({
    name: z.string().trim().min(3, "Product name must be at least 3 characters").max(100),
    description: z.string().trim().max(1000).optional(),
    categoryId: z.string().cuid("Invalid category ID format"),
    brandId: z.string().cuid("Invalid brand ID format").optional().nullable(),
    imageUrls: z.array(z.string().url("Must be a valid URL")).max(5, "Maximum 5 images allowed").default([]),
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

  listQuery: paginationSchema.extend({
    search: z.string().optional(),
    categoryId: z.string().cuid().optional(),
    brandId: z.string().cuid().optional(),
    isActive: z
      .enum(["true", "false"])
      .transform((val) => val === "true")
      .optional(),
  }),
} as const;

export type CreateProductInput = z.infer<typeof productValidation.create>;
export type UpdateProductInput = z.infer<typeof productValidation.update>;
export type ListProductsQuery = z.infer<typeof productValidation.listQuery>;
