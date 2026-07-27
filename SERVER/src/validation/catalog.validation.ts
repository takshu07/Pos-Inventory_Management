import { z } from "zod";
import { paginationSchema } from "./common.validation";

// =============================================================================
// CATEGORY VALIDATION — MOVED
//
// The category schemas now live in `validation/category.validation.ts`, which
// covers the full enterprise module (lifecycle status, keywords, hierarchy,
// bulk actions, discounts, analytics, export). They were removed from here so
// there is exactly ONE category contract; a second, weaker schema in this file
// would inevitably drift and let older callers write invalid rows.
// =============================================================================

// =============================================================================
// BRAND VALIDATION
// =============================================================================

export const brandValidation = {
  create: z.object({
    name: z.string().trim().min(2, "Brand name must be at least 2 characters").max(50),
    description: z.string().trim().max(500).optional(),
    logoUrl: z.string().url("Must be a valid URL").optional(),
  }),

  update: z.object({
    name: z.string().trim().min(2).max(50).optional(),
    description: z.string().trim().max(500).optional(),
    logoUrl: z.string().url().optional(),
    isActive: z.boolean().optional(),
  }),

  listQuery: paginationSchema.extend({
    search: z.string().optional(),
    isActive: z
      .enum(["true", "false"])
      .transform((val) => val === "true")
      .optional(),
  }),
} as const;

export type CreateBrandInput = z.infer<typeof brandValidation.create>;
export type UpdateBrandInput = z.infer<typeof brandValidation.update>;
export type ListBrandsQuery = z.infer<typeof brandValidation.listQuery>;

// =============================================================================
// SUPPLIER VALIDATION
// =============================================================================

export const supplierValidation = {
  create: z.object({
    businessName: z.string().trim().min(2, "Business name must be at least 2 characters").max(100),
    contactPerson: z.string().trim().max(100).optional(),
    phone: z.string().trim().regex(/^[6-9]\d{9}$/, "Must be a valid 10-digit Indian mobile number"),
    email: z.string().trim().toLowerCase().email().optional(),
    address: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(1000).optional(),
  }),

  update: z.object({
    businessName: z.string().trim().min(2).max(100).optional(),
    contactPerson: z.string().trim().max(100).optional(),
    phone: z.string().trim().regex(/^[6-9]\d{9}$/).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    address: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(1000).optional(),
    isActive: z.boolean().optional(),
  }),

  listQuery: paginationSchema.extend({
    search: z.string().optional(),
    isActive: z
      .enum(["true", "false"])
      .transform((val) => val === "true")
      .optional(),
  }),
} as const;

export type CreateSupplierInput = z.infer<typeof supplierValidation.create>;
export type UpdateSupplierInput = z.infer<typeof supplierValidation.update>;
export type ListSuppliersQuery = z.infer<typeof supplierValidation.listQuery>;
