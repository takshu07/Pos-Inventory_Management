// =============================================================================
// DISCOUNT RULE REPOSITORY
// All database access for discount_rules and discount_history.
// Prisma lives here and nowhere above it, per the project's layering rule.
// =============================================================================

import { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import type {
  DiscountHistoryQuery,
  ListDiscountsQuery,
} from "../validation/discountRule.validation";

// Target names are joined in so the UI can render "Nike Polo — 30% OFF"
// without a second round-trip per row.
const ruleSelect = {
  id: true,
  name: true,
  description: true,
  scope: true,
  type: true,
  value: true,
  productId: true,
  categoryId: true,
  brandId: true,
  priority: true,
  startDate: true,
  endDate: true,
  isEnabled: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  product: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true } },
} satisfies Prisma.DiscountRuleSelect;

export type DiscountRuleRow = Prisma.DiscountRuleGetPayload<{ select: typeof ruleSelect }>;

function buildWhere(query: ListDiscountsQuery): Prisma.DiscountRuleWhereInput {
  const where: Prisma.DiscountRuleWhereInput = {};

  if (query.scope) where.scope = query.scope;
  if (query.productId) where.productId = query.productId;
  if (query.categoryId) where.categoryId = query.categoryId;

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { description: { contains: query.search, mode: "insensitive" } },
      { product: { name: { contains: query.search, mode: "insensitive" } } },
      { category: { name: { contains: query.search, mode: "insensitive" } } },
    ];
  }

  return where;
}

export const discountRuleRepository = {
  /**
   * @param paginate When false, returns every matching row so the service can
   *   apply the DERIVED status filter and paginate afterwards (status is not a
   *   column, so it cannot be filtered in SQL).
   */
  async findMany(
    query: ListDiscountsQuery,
    paginate: boolean
  ): Promise<{ rows: DiscountRuleRow[]; total: number }> {
    const where = buildWhere(query);
    const orderBy = { [query.sortBy]: query.sortOrder } as Prisma.DiscountRuleOrderByWithRelationInput;

    if (!paginate) {
      const rows = await prisma.discountRule.findMany({ where, orderBy, select: ruleSelect });
      return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
      prisma.discountRule.findMany({
        where,
        orderBy,
        select: ruleSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.discountRule.count({ where }),
    ]);

    return { rows, total };
  },

  findById(id: string): Promise<DiscountRuleRow | null> {
    return prisma.discountRule.findUnique({ where: { id }, select: ruleSelect });
  },

  findManyByIds(ids: string[]): Promise<DiscountRuleRow[]> {
    return prisma.discountRule.findMany({ where: { id: { in: ids } }, select: ruleSelect });
  },

  /** Every rule, for the dashboard's derived-status counters. */
  findAllForDashboard(): Promise<DiscountRuleRow[]> {
    return prisma.discountRule.findMany({
      select: ruleSelect,
      orderBy: { createdAt: "desc" },
    });
  },

  create(data: Prisma.DiscountRuleUncheckedCreateInput): Promise<DiscountRuleRow> {
    return prisma.discountRule.create({ data, select: ruleSelect });
  },

  update(id: string, data: Prisma.DiscountRuleUncheckedUpdateInput): Promise<DiscountRuleRow> {
    return prisma.discountRule.update({ where: { id }, data, select: ruleSelect });
  },

  async remove(id: string): Promise<void> {
    await prisma.discountRule.delete({ where: { id } });
  },

  async removeMany(ids: string[]): Promise<void> {
    await prisma.discountRule.deleteMany({ where: { id: { in: ids } } });
  },

  async setEnabled(ids: string[], isEnabled: boolean): Promise<void> {
    await prisma.discountRule.updateMany({ where: { id: { in: ids } }, data: { isEnabled } });
  },

  async findHistory(query: DiscountHistoryQuery) {
    const where: Prisma.DiscountHistoryWhereInput = query.ruleId ? { ruleId: query.ruleId } : {};

    const [data, total] = await Promise.all([
      prisma.discountHistory.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          ruleId: true,
          ruleName: true,
          action: true,
          oldData: true,
          newData: true,
          employeeId: true,
          createdAt: true,
        },
      }),
      prisma.discountHistory.count({ where }),
    ]);

    const totalPages = Math.ceil(total / query.limit) || 1;

    return {
      data,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1,
      },
    };
  },
};
