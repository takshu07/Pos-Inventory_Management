// =============================================================================
// CATEGORY VALIDATION  —  the request contract for the Category module
//
// This is the FIRST layer of the pipeline (validation → controller → service →
// repository → prisma). Nothing downstream re-validates shapes; a service can
// trust that the input it receives has already been parsed here.
//
// Covers all three milestones so the contract never has to be rewritten:
//   Phase 1  create / update / list / safe-delete
//   Phase 2  bulk actions, discount assignment, images, activity
//   Phase 3  analytics, export, hierarchy (schema-ready, `parentId` accepted)
// =============================================================================

import { z } from "zod";
import { paginationSchema } from "./common.validation";

// ── Shared primitives ────────────────────────────────────────────────────────

export const CATEGORY_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;

/**
 * Sort keys the table header exposes. Kept as a closed enum rather than a free
 * string so an attacker cannot drive `orderBy` with arbitrary column names.
 * `productCount` sorts on a relation aggregate — see the repository.
 */
export const CATEGORY_SORTS = [
  "alphabetical",
  "alphabetical_desc",
  "productCount",
  "productCount_asc",
  "newest",
  "oldest",
  "recentlyUpdated",
  "displayOrder",
] as const;

const nameSchema = z
  .string()
  .trim()
  .min(2, "Category name must be at least 2 characters")
  .max(50, "Category name cannot exceed 50 characters");

const descriptionSchema = z
  .string()
  .trim()
  .max(500, "Description cannot exceed 500 characters");

/** Comma-separated synonyms. Normalised (trimmed, de-duplicated, lower-cased). */
const keywordsSchema = z
  .string()
  .trim()
  .max(500, "Search keywords cannot exceed 500 characters")
  .transform((raw) =>
    Array.from(
      new Set(
        raw
          .split(",")
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean)
      )
    ).join(", ")
  );

/**
 * Accepts an absolute URL or a same-origin relative path — the asset service
 * returns paths like `/api/v1/assets/<id>`, which `z.string().url()` rejects.
 */
const imageUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (v) => v === "" || v.startsWith("/") || /^https?:\/\//i.test(v),
    "Must be an absolute URL or a relative asset path"
  );

// ── Phase 1: CRUD ────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  searchKeywords: keywordsSchema.optional(),
  imageUrl: imageUrlSchema.optional(),
  status: z.enum(CATEGORY_STATUSES).default("ACTIVE"),
  displayOrder: z.coerce.number().int().min(0).default(0),
  // Hierarchy is schema-ready; accepted now so the API contract is stable when
  // nested categories are switched on. The service validates the parent exists
  // and rejects cycles.
  parentId: z.string().cuid("Invalid parent category id").nullish(),
});

const updateSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.nullish(),
    searchKeywords: keywordsSchema.nullish(),
    imageUrl: imageUrlSchema.nullish(),
    status: z.enum(CATEGORY_STATUSES).optional(),
    displayOrder: z.coerce.number().int().min(0).optional(),
    parentId: z.string().cuid("Invalid parent category id").nullish(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided.",
  });

const listQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(CATEGORY_STATUSES).optional(),
  /** "true" → only categories with products; "false" → only empty ones. */
  hasProducts: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  parentId: z.string().cuid().optional(),
  sortBy: z.enum(CATEGORY_SORTS).default("alphabetical"),
  /**
   * Archived rows are hidden by default — the table is an operational view, not
   * a graveyard. The Archived summary card flips this on.
   *
   * `.default()` sits after `.transform()`, so in Zod v4 it takes the OUTPUT
   * type (boolean `false`), not the input string "false".
   */
  includeArchived: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default(false),
});

/**
 * Safe delete. `reassignToId` is the "move products, then delete" path: when a
 * category still holds products the service refuses a bare delete and requires
 * an explicit destination, so products are never orphaned or cascade-deleted.
 */
const deleteQuerySchema = z.object({
  reassignToId: z.string().cuid("Invalid destination category id").optional(),
});

const productsQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  sortBy: z.enum(["name", "newest", "stock", "price"]).default("name"),
});

// ── Phase 2: bulk actions, discounts, images ─────────────────────────────────

export const CATEGORY_BULK_ACTIONS = [
  "ARCHIVE",
  "ACTIVATE",
  "DEACTIVATE",
  "DELETE",
] as const;

const bulkActionSchema = z.object({
  ids: z
    .array(z.string().cuid())
    .min(1, "Select at least one category")
    .max(100, "Cannot process more than 100 categories at once"),
  action: z.enum(CATEGORY_BULK_ACTIONS),
});

/**
 * Assign a discount to a category. Deliberately mirrors the DiscountRule
 * contract — this endpoint delegates to discountRule.service rather than
 * re-implementing pricing logic.
 */
const assignDiscountSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).optional(),
    type: z.enum(["PERCENTAGE", "FLAT"]),
    value: z.coerce.number().positive("Discount value must be greater than zero"),
    priority: z.coerce.number().int().min(0).default(0),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    isEnabled: z.boolean().default(true),
  })
  .refine((d) => d.type !== "PERCENTAGE" || d.value <= 100, {
    message: "A percentage discount cannot exceed 100.",
    path: ["value"],
  })
  .refine((d) => !d.startDate || !d.endDate || d.endDate > d.startDate, {
    message: "End date must be after the start date.",
    path: ["endDate"],
  });

const imageSchema = z.object({
  imageUrl: imageUrlSchema,
});

const activityQuerySchema = paginationSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Phase 3: analytics & export ──────────────────────────────────────────────

/** Windows the analytics engine understands. Bounded to keep queries indexed. */
export const ANALYTICS_PERIODS = ["7d", "30d", "90d", "12m", "custom"] as const;

const analyticsQuerySchema = z
  .object({
    period: z.enum(ANALYTICS_PERIODS).default("30d"),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .refine((d) => d.period !== "custom" || (d.from && d.to), {
    message: "`from` and `to` are required when period is `custom`.",
    path: ["from"],
  })
  .refine((d) => !d.from || !d.to || d.to >= d.from, {
    message: "`to` must be on or after `from`.",
    path: ["to"],
  });

export const EXPORT_FORMATS = ["csv", "excel", "pdf"] as const;

/**
 * Export reuses the list filters verbatim so "export what I'm looking at" is
 * exactly what happens — the filtered export requirement.
 */
const exportQuerySchema = listQuerySchema
  .omit({ page: true, limit: true, cursor: true })
  .extend({
    format: z.enum(EXPORT_FORMATS).default("csv"),
    includeAnalytics: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .default(false),
  });

// ── Export surface ───────────────────────────────────────────────────────────

export const categoryValidation = {
  create: createSchema,
  update: updateSchema,
  listQuery: listQuerySchema,
  deleteQuery: deleteQuerySchema,
  productsQuery: productsQuerySchema,
  bulkAction: bulkActionSchema,
  assignDiscount: assignDiscountSchema,
  image: imageSchema,
  activityQuery: activityQuerySchema,
  analyticsQuery: analyticsQuerySchema,
  exportQuery: exportQuerySchema,
} as const;

export type CategoryStatusInput = (typeof CATEGORY_STATUSES)[number];
export type CategorySortInput = (typeof CATEGORY_SORTS)[number];
export type CreateCategoryInput = z.infer<typeof createSchema>;
export type UpdateCategoryInput = z.infer<typeof updateSchema>;
export type ListCategoriesQuery = z.infer<typeof listQuerySchema>;
export type DeleteCategoryQuery = z.infer<typeof deleteQuerySchema>;
export type CategoryProductsQuery = z.infer<typeof productsQuerySchema>;
export type CategoryBulkActionInput = z.infer<typeof bulkActionSchema>;
export type AssignCategoryDiscountInput = z.infer<typeof assignDiscountSchema>;
export type CategoryImageInput = z.infer<typeof imageSchema>;
export type CategoryActivityQuery = z.infer<typeof activityQuerySchema>;
export type CategoryAnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type CategoryExportQuery = z.infer<typeof exportQuerySchema>;
