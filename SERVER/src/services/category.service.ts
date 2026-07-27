// =============================================================================
// CATEGORY SERVICE  —  business rules for the Category module (Phase 1 + 2)
//
// This is the ONLY place category business rules live. Controllers parse and
// delegate; the repository moves rows. Nothing bypasses this layer.
//
// The invariants it owns:
//
//  1. NAME UNIQUENESS is case-insensitive. "Shirts" and "shirts" are the same
//     category to a human, so they are the same category here.
//
//  2. SAFE DELETE. A category holding products is never deleted implicitly.
//     Product.categoryId is a non-nullable FK with onDelete: Restrict, so a
//     blind delete would fail at the database with an opaque error. Instead we
//     detect it up front and return a structured 409 the UI can turn into the
//     "move products → pick destination → delete" flow.
//
//  3. STATUS / isActive LOCKSTEP. `status` is the source of truth, but existing
//     POS, catalog and pricing queries filter on the legacy `isActive` boolean.
//     Every write here sets both, so those readers keep working untouched.
//
//  4. AUDIT ON EVERY MUTATION, fire-and-forget. An audit failure must never roll
//     back the business operation (auditRepository swallows and logs).
//
//  5. PRICING IS NOT REIMPLEMENTED. Category discounts delegate to
//     discountRule.service, which owns rule creation AND the price recompute.
// =============================================================================

import type { Prisma } from "../../generated/prisma";
import { logger } from "../config/logger";
import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { auditRepository } from "../repositories/audit.repository";
import { categoryRepository, type CategoryRow } from "../repositories/category.repository";
import type { PaginatedResponse } from "../types/common.types";
import * as discountRuleService from "./discountRule.service";
import type {
  AssignCategoryDiscountInput,
  CategoryActivityQuery,
  CategoryBulkActionInput,
  CategoryProductsQuery,
  CreateCategoryInput,
  DeleteCategoryQuery,
  ListCategoriesQuery,
  UpdateCategoryInput,
} from "../validation/category.validation";

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CategoryDTO {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  searchKeywords: string | null;
  status: string;
  isActive: boolean;
  displayOrder: number;
  parentId: string | null;
  path: string | null;
  level: number;
  productCount: number;
  createdBy: { id: string; name: string } | null;
  updatedBy: { id: string; name: string } | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toCategoryDTO(row: CategoryRow): CategoryDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    imageUrl: row.imageUrl,
    searchKeywords: row.searchKeywords,
    status: row.status,
    isActive: row.isActive,
    displayOrder: row.displayOrder,
    parentId: row.parentId,
    path: row.path,
    level: row.level,
    productCount: row._count.products,
    createdBy: row.createdBy
      ? { id: row.createdBy.id, name: `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim() }
      : null,
    updatedBy: row.updatedBy
      ? { id: row.updatedBy.id, name: `${row.updatedBy.firstName} ${row.updatedBy.lastName}`.trim() }
      : null,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function paginate<T>(data: T[], total: number, page: number, limit: number): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / limit) || 1;
  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}

function audit(
  action: "CREATE" | "UPDATE" | "DELETE",
  categoryId: string,
  executorId: string,
  oldData?: unknown,
  newData?: unknown
): void {
  auditRepository.create({
    performedBy: executorId,
    action,
    module: "CATEGORY",
    tableName: "categories",
    recordId: categoryId,
    ...(oldData != null ? { oldData: oldData as Record<string, unknown> } : {}),
    ...(newData != null ? { newData: newData as Record<string, unknown> } : {}),
  });
}

/** Loads a category or throws the canonical 404. Used by every by-id operation. */
async function requireCategory(id: string): Promise<CategoryRow> {
  const category = await categoryRepository.findById(id);
  if (!category) throw new AppError(HTTP_STATUS.NOT_FOUND, "Category not found.");
  return category;
}

/** Case-insensitive uniqueness guard, shared by create and rename. */
async function assertNameAvailable(name: string, excludeId?: string): Promise<void> {
  const clash = await categoryRepository.findByName(name, excludeId);
  if (clash) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      `A category named "${clash.name}" already exists.`
    );
  }
}

/**
 * Hierarchy guard. Nesting is schema-ready but not yet exposed in the UI; the
 * validation still accepts `parentId`, so the rules are enforced from day one
 * rather than being retrofitted when nesting is switched on.
 */
async function resolveParent(
  parentId: string | null | undefined,
  selfId?: string
): Promise<{ parentId: string | null; path: string | null; level: number } | null> {
  if (parentId === undefined) return null; // field not supplied → leave untouched
  if (parentId === null) return { parentId: null, path: null, level: 0 };

  if (selfId && parentId === selfId) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "A category cannot be its own parent.");
  }

  const parent = await requireCategory(parentId);

  // Reject cycles: the new parent must not sit inside this category's subtree.
  if (selfId && parent.path?.includes(`/${selfId}`)) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      "Cannot move a category beneath one of its own descendants."
    );
  }

  return {
    parentId: parent.id,
    path: `${parent.path ?? ""}/${parent.id}`,
    level: parent.level + 1,
  };
}

// =============================================================================
// PHASE 1 — READS
// =============================================================================

export async function listCategories(
  query: ListCategoriesQuery
): Promise<PaginatedResponse<CategoryDTO>> {
  const { total, data } = await categoryRepository.findMany(query);
  return paginate(data.map(toCategoryDTO), total, query.page, query.limit);
}

export async function getCategoryById(id: string): Promise<CategoryDTO> {
  return toCategoryDTO(await requireCategory(id));
}

/** Summary cards on the dashboard. */
export async function getCategorySummary() {
  return categoryRepository.getSummary();
}

/** Destination options for the "move products here" picker. */
export async function getCategoryOptions(excludeId?: string) {
  const rows = await categoryRepository.findOptions(excludeId);
  return rows.map((r) => ({ id: r.id, name: r.name, productCount: r._count.products }));
}

/**
 * Products inside a category (drawer tab). Price is a RANGE and stock a SUM
 * across variants — that rollup is the catalog's rule, mirrored here so the
 * drawer shows the same numbers as the product module.
 */
export async function getCategoryProducts(id: string, query: CategoryProductsQuery) {
  await requireCategory(id);
  const { total, data } = await categoryRepository.findProducts(id, query);

  const rows = data.map((p) => {
    const selling = p.variants.map((v) => Number(v.sellingPrice));
    const mrps = p.variants.map((v) => Number(v.mrp));
    const stock = p.variants.reduce((sum, v) => sum + v.currentStock, 0);

    return {
      id: p.id,
      name: p.name,
      imageUrl: p.imageUrls[0] ?? null,
      brand: p.brand?.name ?? null,
      mrp: mrps.length ? Math.min(...mrps) : null,
      mrpMax: mrps.length ? Math.max(...mrps) : null,
      sellingPrice: selling.length ? Math.min(...selling) : null,
      sellingPriceMax: selling.length ? Math.max(...selling) : null,
      stock,
      variantCount: p.variants.length,
      status: p.status,
      isActive: p.isActive,
      createdAt: p.createdAt,
    };
  });

  // In-page sorts on derived rollups (stock/price) — the values do not exist as
  // columns, so they cannot be ordered in SQL without a rollup table.
  // TODO(scale): move to a `product_stats` rollup if categories exceed ~2k products.
  if (query.sortBy === "stock") rows.sort((a, b) => b.stock - a.stock);
  if (query.sortBy === "price") {
    rows.sort((a, b) => (b.sellingPrice ?? 0) - (a.sellingPrice ?? 0));
  }

  return paginate(rows, total, query.page, query.limit);
}

// =============================================================================
// PHASE 1 — WRITES
// =============================================================================

export async function createCategory(
  data: CreateCategoryInput,
  executorId: string
): Promise<CategoryDTO> {
  await assertNameAvailable(data.name);
  const hierarchy = await resolveParent(data.parentId);

  const created = await categoryRepository.create({
    name: data.name,
    description: data.description ?? null,
    searchKeywords: data.searchKeywords ?? null,
    imageUrl: data.imageUrl ?? null,
    status: data.status,
    isActive: data.status === "ACTIVE",
    displayOrder: data.displayOrder,
    archivedAt: data.status === "ARCHIVED" ? new Date() : null,
    createdById: executorId,
    updatedById: executorId,
    ...(hierarchy ?? {}),
  });

  audit("CREATE", created.id, executorId, null, created);
  logger.info({ executorId, categoryId: created.id }, "[Category] Created");

  return toCategoryDTO(created);
}

export async function updateCategory(
  id: string,
  data: UpdateCategoryInput,
  executorId: string
): Promise<CategoryDTO> {
  const existing = await requireCategory(id);

  if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
    await assertNameAvailable(data.name, id);
  }

  const hierarchy = await resolveParent(data.parentId, id);

  const patch: Prisma.CategoryUncheckedUpdateInput = {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.description !== undefined ? { description: data.description ?? null } : {}),
    ...(data.searchKeywords !== undefined
      ? { searchKeywords: data.searchKeywords ?? null }
      : {}),
    ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl ?? null } : {}),
    ...(data.displayOrder !== undefined ? { displayOrder: data.displayOrder } : {}),
    // Status changes drag isActive and archivedAt along — invariant 3.
    ...(data.status !== undefined
      ? {
          status: data.status,
          isActive: data.status === "ACTIVE",
          archivedAt: data.status === "ARCHIVED" ? (existing.archivedAt ?? new Date()) : null,
        }
      : {}),
    ...(hierarchy ?? {}),
    updatedById: executorId,
  };

  const updated = await categoryRepository.update(id, patch);

  audit("UPDATE", id, executorId, existing, updated);
  logger.info({ executorId, categoryId: id }, "[Category] Updated");

  return toCategoryDTO(updated);
}

/** Soft, reversible retirement. Products and their links are untouched. */
export async function archiveCategory(id: string, executorId: string): Promise<CategoryDTO> {
  const existing = await requireCategory(id);

  if (existing.status === "ARCHIVED") {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "This category is already archived.");
  }

  const updated = await categoryRepository.update(id, {
    status: "ARCHIVED",
    isActive: false,
    archivedAt: new Date(),
    updatedById: executorId,
  });

  audit("UPDATE", id, executorId, existing, updated);
  logger.info(
    { executorId, categoryId: id, productCount: existing._count.products },
    "[Category] Archived"
  );

  return toCategoryDTO(updated);
}

/** Restore from ARCHIVED/INACTIVE back into the live catalog. */
export async function activateCategory(id: string, executorId: string): Promise<CategoryDTO> {
  const existing = await requireCategory(id);

  if (existing.status === "ACTIVE") {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "This category is already active.");
  }

  const updated = await categoryRepository.update(id, {
    status: "ACTIVE",
    isActive: true,
    archivedAt: null,
    updatedById: executorId,
  });

  audit("UPDATE", id, executorId, existing, updated);
  logger.info({ executorId, categoryId: id }, "[Category] Activated");

  return toCategoryDTO(updated);
}

export interface DeleteCategoryResult {
  id: string;
  name: string;
  movedProducts: number;
  movedTo: { id: string; name: string } | null;
}

/**
 * SAFE DELETE — invariant 2.
 *
 * With products attached the caller MUST name a destination category. Without
 * one we throw a 409 whose `details` carry everything the UI needs to render
 * the "This category contains products" dialog without a second round-trip.
 */
export async function deleteCategory(
  id: string,
  query: DeleteCategoryQuery,
  executorId: string
): Promise<DeleteCategoryResult> {
  const existing = await requireCategory(id);
  const productCount = existing._count.products;

  if (productCount === 0) {
    await categoryRepository.remove(id);
    audit("DELETE", id, executorId, existing, null);
    logger.info({ executorId, categoryId: id }, "[Category] Deleted (empty)");
    return { id, name: existing.name, movedProducts: 0, movedTo: null };
  }

  if (!query.reassignToId) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      "This category contains products. Move them to another category before deleting it.",
      {
        reason: "CATEGORY_NOT_EMPTY",
        categoryId: id,
        categoryName: existing.name,
        productCount,
      }
    );
  }

  if (query.reassignToId === id) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Cannot move products into the category being deleted.");
  }

  const destination = await requireCategory(query.reassignToId);
  if (destination.status === "ARCHIVED") {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Cannot move products into an archived category.");
  }

  // Move + delete are one transaction — never a partial migration.
  const { moved } = await categoryRepository.reassignProductsAndDelete(id, destination.id);

  audit("DELETE", id, executorId, existing, {
    movedProducts: moved,
    movedToId: destination.id,
    movedToName: destination.name,
  });
  logger.info(
    { executorId, categoryId: id, moved, destinationId: destination.id },
    "[Category] Deleted with product reassignment"
  );

  return {
    id,
    name: existing.name,
    movedProducts: moved,
    movedTo: { id: destination.id, name: destination.name },
  };
}

// =============================================================================
// PHASE 2 — BULK ACTIONS, DISCOUNTS, IMAGES, ACTIVITY
// =============================================================================

export interface BulkActionResult {
  processed: number;
  skipped: { id: string; name: string; reason: string }[];
}

/**
 * Bulk archive / activate / deactivate / delete.
 *
 * Partial success is deliberate: a bulk DELETE that includes one non-empty
 * category deletes the rest and reports the skip, rather than failing all of it.
 * The caller gets an itemised report either way.
 */
export async function bulkAction(
  input: CategoryBulkActionInput,
  executorId: string
): Promise<BulkActionResult> {
  const found = await categoryRepository.findManyByIds(input.ids);
  if (found.length === 0) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "No matching categories found.");
  }

  const skipped: BulkActionResult["skipped"] = [];

  if (input.action === "DELETE") {
    // Safe delete applies in bulk too — non-empty categories are never removed.
    const nonEmpty = await categoryRepository.findNonEmpty(found.map((c) => c.id));
    const blocked = new Set(nonEmpty.map((c) => c.id));

    for (const c of nonEmpty) {
      skipped.push({
        id: c.id,
        name: c.name,
        reason: `Contains ${c.count} product${c.count === 1 ? "" : "s"}`,
      });
    }

    const deletable = found.filter((c) => !blocked.has(c.id));
    if (deletable.length === 0) return { processed: 0, skipped };

    const processed = await categoryRepository.removeMany(deletable.map((c) => c.id));
    for (const c of deletable) audit("DELETE", c.id, executorId, c, null);

    logger.info(
      { executorId, processed, skipped: skipped.length },
      "[Category] Bulk delete applied"
    );
    return { processed, skipped };
  }

  const status =
    input.action === "ARCHIVE" ? "ARCHIVED" : input.action === "ACTIVATE" ? "ACTIVE" : "INACTIVE";

  const processed = await categoryRepository.setStatusMany(
    found.map((c) => c.id),
    status,
    executorId
  );

  for (const c of found) audit("UPDATE", c.id, executorId, c, { ...c, status });

  logger.info(
    { executorId, action: input.action, processed },
    "[Category] Bulk status change applied"
  );

  return { processed, skipped };
}

/** Discounts currently targeting a category (drawer tab, read-only for managers). */
export async function getCategoryDiscounts(id: string) {
  await requireCategory(id);
  const rules = await categoryRepository.findDiscounts(id);
  const now = new Date();

  return rules.map((r) => {
    // Status is DERIVED, never stored — same rule the pricing engine applies, so
    // the badge here can never disagree with the price actually charged.
    const status = !r.isEnabled
      ? "DISABLED"
      : r.startDate && r.startDate > now
        ? "SCHEDULED"
        : r.endDate && r.endDate < now
          ? "EXPIRED"
          : "ACTIVE";

    return {
      id: r.id,
      name: r.name,
      description: r.description,
      type: r.type,
      value: Number(r.value),
      priority: r.priority,
      startDate: r.startDate,
      endDate: r.endDate,
      isEnabled: r.isEnabled,
      status,
      source: "CATEGORY" as const,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

/**
 * Assign a discount to a category.
 *
 * Delegates wholesale to discountRule.service — that service owns rule creation,
 * history, audit AND the variant price recompute. Duplicating any of it here
 * would let category-assigned discounts drift from every other discount path.
 */
export async function assignDiscount(
  id: string,
  input: AssignCategoryDiscountInput,
  executorId: string
) {
  await requireCategory(id);

  return discountRuleService.createCategoryDiscount(
    {
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      categoryId: id,
      type: input.type,
      value: input.value,
      priority: input.priority,
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      isEnabled: input.isEnabled,
    } as Parameters<typeof discountRuleService.createCategoryDiscount>[0],
    executorId
  );
}

/** Image attach/replace. Storage/upload is the asset module's job, not ours. */
export async function setCategoryImage(
  id: string,
  imageUrl: string | null,
  executorId: string
): Promise<CategoryDTO> {
  const existing = await requireCategory(id);
  const updated = await categoryRepository.update(id, { imageUrl, updatedById: executorId });

  audit("UPDATE", id, executorId, existing, updated);
  logger.info({ executorId, categoryId: id, removed: imageUrl === null }, "[Category] Image updated");

  return toCategoryDTO(updated);
}

/**
 * Activity timeline, read straight from the shared AuditLog — no parallel
 * history table. Raw audit rows are translated into human events here.
 */
export async function getCategoryActivity(id: string, query: CategoryActivityQuery) {
  await requireCategory(id);
  const { total, data } = await categoryRepository.findActivity(id, query);

  const events = data.map((row) => {
    const oldData = (row.oldData ?? null) as Record<string, unknown> | null;
    const newData = (row.newData ?? null) as Record<string, unknown> | null;

    let type = row.action as string;
    let summary = "Category updated";

    if (row.action === "CREATE") {
      type = "CREATED";
      summary = "Category created";
    } else if (row.action === "DELETE") {
      type = "DELETED";
      const moved = newData?.["movedProducts"];
      summary =
        typeof moved === "number" && moved > 0
          ? `Category deleted — ${moved} product${moved === 1 ? "" : "s"} moved to ${String(newData?.["movedToName"] ?? "another category")}`
          : "Category deleted";
    } else if (oldData && newData) {
      const before = oldData["status"];
      const after = newData["status"];
      if (before !== after) {
        type =
          after === "ARCHIVED" ? "ARCHIVED" : after === "ACTIVE" ? "ACTIVATED" : "DEACTIVATED";
        summary = `Status changed from ${String(before)} to ${String(after)}`;
      } else if (oldData["imageUrl"] !== newData["imageUrl"]) {
        type = "IMAGE_CHANGED";
        summary = newData["imageUrl"] ? "Category image updated" : "Category image removed";
      } else if (oldData["name"] !== newData["name"]) {
        type = "RENAMED";
        summary = `Renamed from "${String(oldData["name"])}" to "${String(newData["name"])}"`;
      }
    }

    // Which fields actually changed — drives the timeline's detail expander.
    const changedFields =
      oldData && newData
        ? Object.keys(newData).filter(
            (k) =>
              !["updatedAt", "updatedById", "_count"].includes(k) &&
              JSON.stringify(oldData[k]) !== JSON.stringify(newData[k])
          )
        : [];

    return {
      id: row.id,
      type,
      summary,
      changedFields,
      actor: row.employee
        ? {
            id: row.employee.id,
            name: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
            role: row.employee.role,
          }
        : null,
      createdAt: row.createdAt,
    };
  });

  return paginate(events, total, query.page, query.limit);
}
