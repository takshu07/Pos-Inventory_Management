// =============================================================================
// CATEGORY REPOSITORY  —  every database access for the Category module
//
// Contract: this layer speaks Prisma and nothing else. It contains no business
// rules (no "you may not delete a category with products", no audit writes) —
// those live in category.service. Keeping the split honest is what lets the
// service be tested against a fake repository.
//
// Performance notes:
//  • Product counts come from Prisma's `_count` relation aggregate, which
//    compiles to a single correlated subquery — never an N+1 loop.
//  • List reads run count+page inside one $transaction so the total and the
//    page are consistent with each other.
// =============================================================================

import type { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import type {
  CategoryActivityQuery,
  CategoryProductsQuery,
  ListCategoriesQuery,
} from "../validation/category.validation";

/** Columns every list/detail read returns, plus the aggregates the UI needs. */
const categorySelect = {
  id: true,
  name: true,
  description: true,
  imageUrl: true,
  searchKeywords: true,
  status: true,
  isActive: true,
  displayOrder: true,
  parentId: true,
  path: true,
  level: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  updatedBy: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { products: true } },
} satisfies Prisma.CategorySelect;

export type CategoryRow = Prisma.CategoryGetPayload<{ select: typeof categorySelect }>;

// ── Query building ───────────────────────────────────────────────────────────

/**
 * Translates the validated list query into a Prisma `where`.
 *
 * Exported because export/analytics reuse the exact same predicate — "export
 * what I'm looking at" is only true if both paths build the filter identically.
 */
export function buildCategoryWhere(
  query: Partial<ListCategoriesQuery>
): Prisma.CategoryWhereInput {
  const { search, status, hasProducts, createdFrom, createdTo, parentId, includeArchived } =
    query;

  const and: Prisma.CategoryWhereInput[] = [];

  if (status) {
    and.push({ status });
  } else if (!includeArchived) {
    // Archived rows stay out of the operational table unless explicitly asked
    // for, either via the Archived card (status=ARCHIVED) or this flag.
    and.push({ status: { not: "ARCHIVED" } });
  }

  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { searchKeywords: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  // `some: {}` / `none: {}` become EXISTS subqueries — cheaper than counting.
  if (hasProducts === true) and.push({ products: { some: {} } });
  if (hasProducts === false) and.push({ products: { none: {} } });

  if (createdFrom || createdTo) {
    and.push({
      createdAt: {
        ...(createdFrom ? { gte: createdFrom } : {}),
        ...(createdTo ? { lte: createdTo } : {}),
      },
    });
  }

  if (parentId) and.push({ parentId });

  return and.length > 0 ? { AND: and } : {};
}

/**
 * Maps a sort key to a Prisma `orderBy`. `productCount` sorts on the relation
 * aggregate, which Prisma pushes into SQL — no in-memory sorting, so it stays
 * correct across pages.
 */
function buildOrderBy(
  sortBy: ListCategoriesQuery["sortBy"]
): Prisma.CategoryOrderByWithRelationInput[] {
  switch (sortBy) {
    case "alphabetical":
      return [{ name: "asc" }];
    case "alphabetical_desc":
      return [{ name: "desc" }];
    case "productCount":
      return [{ products: { _count: "desc" } }, { name: "asc" }];
    case "productCount_asc":
      return [{ products: { _count: "asc" } }, { name: "asc" }];
    case "newest":
      return [{ createdAt: "desc" }];
    case "oldest":
      return [{ createdAt: "asc" }];
    case "recentlyUpdated":
      return [{ updatedAt: "desc" }];
    case "displayOrder":
      return [{ displayOrder: "asc" }, { name: "asc" }];
    default:
      return [{ name: "asc" }];
  }
}

export const categoryRepository = {
  // ── Reads ──────────────────────────────────────────────────────────────────

  async findMany(query: ListCategoriesQuery): Promise<{ total: number; data: CategoryRow[] }> {
    const where = buildCategoryWhere(query);
    const skip = (query.page - 1) * query.limit;

    const [total, data] = await prisma.$transaction([
      prisma.category.count({ where }),
      prisma.category.findMany({
        where,
        select: categorySelect,
        orderBy: buildOrderBy(query.sortBy),
        skip,
        take: query.limit,
      }),
    ]);

    return { total, data };
  },

  /** Unpaginated read for export. Bounded by `take` so a filter mistake cannot OOM the process. */
  async findAllForExport(
    query: Partial<ListCategoriesQuery>,
    take = 5000
  ): Promise<CategoryRow[]> {
    return prisma.category.findMany({
      where: buildCategoryWhere(query),
      select: categorySelect,
      orderBy: buildOrderBy(query.sortBy ?? "alphabetical"),
      take,
    });
  },

  async findById(id: string): Promise<CategoryRow | null> {
    return prisma.category.findUnique({ where: { id }, select: categorySelect });
  },

  async findByName(name: string, excludeId?: string) {
    return prisma.category.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, name: true },
    });
  },

  async findManyByIds(ids: string[]): Promise<CategoryRow[]> {
    return prisma.category.findMany({ where: { id: { in: ids } }, select: categorySelect });
  },

  /** Lightweight options list for the "move products to…" picker and selects. */
  async findOptions(excludeId?: string) {
    return prisma.category.findMany({
      where: {
        status: { not: "ARCHIVED" },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, name: true, _count: { select: { products: true } } },
      orderBy: { name: "asc" },
    });
  },

  countProducts(categoryId: string): Promise<number> {
    return prisma.product.count({ where: { categoryId } });
  },

  /** Product counts for many categories in ONE grouped query (avoids N+1). */
  async countProductsByCategory(categoryIds: string[]): Promise<Map<string, number>> {
    const rows = await prisma.product.groupBy({
      by: ["categoryId"],
      where: { categoryId: { in: categoryIds } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.categoryId, r._count._all]));
  },

  /**
   * Dashboard summary counters. One $transaction, six indexed aggregates —
   * cheaper and far more accurate than paging the table and counting in JS.
   */
  async getSummary() {
    const [total, active, inactive, archived, totalProducts, uncategorized] =
      await prisma.$transaction([
        prisma.category.count(),
        prisma.category.count({ where: { status: "ACTIVE" } }),
        prisma.category.count({ where: { status: "INACTIVE" } }),
        prisma.category.count({ where: { status: "ARCHIVED" } }),
        prisma.product.count(),
        // "Uncategorized" = attached to a category that is no longer active.
        // categoryId is non-nullable, so a truly orphaned product cannot exist.
        prisma.product.count({ where: { category: { status: { not: "ACTIVE" } } } }),
      ]);

    const empty = await prisma.category.count({
      where: { products: { none: {} }, status: { not: "ARCHIVED" } },
    });

    return { total, active, inactive, archived, totalProducts, uncategorized, empty };
  },

  /** Products inside a category — the drawer's Products tab. */
  async findProducts(categoryId: string, query: CategoryProductsQuery) {
    const skip = (query.page - 1) * query.limit;

    const where: Prisma.ProductWhereInput = {
      categoryId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { searchKeywords: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.ProductOrderByWithRelationInput =
      query.sortBy === "newest" ? { createdAt: "desc" } : { name: "asc" };

    const [total, data] = await prisma.$transaction([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: query.limit,
        select: {
          id: true,
          name: true,
          imageUrls: true,
          status: true,
          isActive: true,
          createdAt: true,
          brand: { select: { id: true, name: true } },
          // Price is a RANGE and stock is a SUM across variants — the single
          // source of truth for both lives on ProductVariant.
          variants: {
            select: { mrp: true, sellingPrice: true, currentStock: true },
          },
        },
      }),
    ]);

    return { total, data };
  },

  /** Audit trail for one category — powers the Activity timeline (Phase 2). */
  async findActivity(categoryId: string, query: CategoryActivityQuery) {
    const where: Prisma.AuditLogWhereInput = {
      module: "CATEGORY",
      recordId: categoryId,
    };
    const skip = (query.page - 1) * query.limit;

    const [total, data] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.limit,
        select: {
          id: true,
          action: true,
          oldData: true,
          newData: true,
          createdAt: true,
          employee: { select: { id: true, firstName: true, lastName: true, role: true } },
        },
      }),
    ]);

    return { total, data };
  },

  /** Discount rules targeting a category — the drawer's Discount tab. */
  async findDiscounts(categoryId: string) {
    return prisma.discountRule.findMany({
      where: { categoryId, scope: "CATEGORY" },
      orderBy: [{ isEnabled: "desc" }, { priority: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        value: true,
        priority: true,
        startDate: true,
        endDate: true,
        isEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  },

  // ── Writes ─────────────────────────────────────────────────────────────────

  async create(data: Prisma.CategoryUncheckedCreateInput): Promise<CategoryRow> {
    return prisma.category.create({ data, select: categorySelect });
  },

  async update(id: string, data: Prisma.CategoryUncheckedUpdateInput): Promise<CategoryRow> {
    return prisma.category.update({ where: { id }, data, select: categorySelect });
  },

  async remove(id: string): Promise<void> {
    await prisma.category.delete({ where: { id } });
  },

  /**
   * Reassign every product out of one category and then delete it, atomically.
   * If the delete fails the moves roll back — products are never left half-moved
   * with the source category still present.
   */
  async reassignProductsAndDelete(
    fromId: string,
    toId: string
  ): Promise<{ moved: number }> {
    return prisma.$transaction(async (tx) => {
      const { count } = await tx.product.updateMany({
        where: { categoryId: fromId },
        data: { categoryId: toId },
      });
      await tx.category.delete({ where: { id: fromId } });
      return { moved: count };
    });
  },

  /** Bulk status change. `isActive` is kept in lockstep — see the schema comment. */
  async setStatusMany(
    ids: string[],
    status: "ACTIVE" | "INACTIVE" | "ARCHIVED",
    updatedById: string
  ): Promise<number> {
    const { count } = await prisma.category.updateMany({
      where: { id: { in: ids } },
      data: {
        status,
        isActive: status === "ACTIVE",
        archivedAt: status === "ARCHIVED" ? new Date() : null,
        updatedById,
      },
    });
    return count;
  },

  async removeMany(ids: string[]): Promise<number> {
    const { count } = await prisma.category.deleteMany({ where: { id: { in: ids } } });
    return count;
  },

  /** Which of these categories still hold products? Guards bulk delete. */
  async findNonEmpty(ids: string[]): Promise<{ id: string; name: string; count: number }[]> {
    const rows = await prisma.category.findMany({
      where: { id: { in: ids }, products: { some: {} } },
      select: { id: true, name: true, _count: { select: { products: true } } },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, count: r._count.products }));
  },
};
