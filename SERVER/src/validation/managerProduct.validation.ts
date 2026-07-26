import { z } from "zod";
import { paginationSchema } from "./common.validation";

// =============================================================================
// MANAGER PRODUCT VALIDATION
// Manager operational catalog: read-only. Only list/search/filter query shapes
// exist here — there are intentionally NO create/update/delete schemas, because
// the manager module exposes no write endpoints. RBAC is also enforced at the
// route (requireRole OWNER) and controller layers, but the absence of any write
// schema here is the first line of the "read-only by construction" contract.
// =============================================================================

const stockStatus = z.enum(["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"]);

const sortBy = z.enum([
  "newest",
  "name",
  "priceHigh",
  "priceLow",
  "stockHigh",
  "stockLow",
]);

export const managerProductValidation = {
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

  searchQuery: z.object({
    q: z.string().trim().default(""),
    limit: z.coerce.number().int().min(1).max(25).default(10),
  }),
} as const;

export type ManagerListProductsQuery = z.infer<typeof managerProductValidation.listQuery>;
export type ManagerSearchQuery = z.infer<typeof managerProductValidation.searchQuery>;
