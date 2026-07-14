import { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import type { AnalyticsFilterContext } from "../engines/analytics.engine";

export const analyticsRepository = {
  /**
   * Universal Date Filter Builder.
   * Prevents repeating date logic across 50+ queries.
   */
  buildDateFilter(ctx: AnalyticsFilterContext, dateField = "createdAt"): Prisma.DateTimeFilter | undefined {
    if (!ctx.startDate && !ctx.endDate) return undefined;
    const filter: Prisma.DateTimeFilter = {};
    if (ctx.startDate) filter.gte = ctx.startDate;
    if (ctx.endDate) filter.lte = ctx.endDate;
    return filter;
  },

  /**
   * Universal Where Builder for Sales.
   */
  buildSaleWhere(ctx: AnalyticsFilterContext): Prisma.SaleWhereInput {
    const where: Prisma.SaleWhereInput = {
      status: "COMPLETED",
    };
    
    const dateFilter = this.buildDateFilter(ctx, "saleDate");
    if (dateFilter) where.saleDate = dateFilter;
    
    if (ctx.employeeId) where.employeeId = ctx.employeeId;
    if (ctx.customerId) where.customerId = ctx.customerId;
    
    // For Category/Brand filters on a sale, we must check if any item matches
    if (ctx.categoryId || ctx.brandId) {
      where.items = {
        some: {
          variant: {
            product: {
              ...(ctx.categoryId && { categoryId: ctx.categoryId }),
              ...(ctx.brandId && { brandId: ctx.brandId })
            }
          }
        }
      };
    }

    return where;
  },

  /**
   * Fetches aggregate KPI data for sales within a context.
   */
  async getSalesKPIs(ctx: AnalyticsFilterContext) {
    const where = this.buildSaleWhere(ctx);
    
    const [aggregations, count] = await Promise.all([
      prisma.sale.aggregate({
        where,
        _sum: {
          grandTotal: true,
          subtotal: true,
          discountAmount: true,
          manualDiscountAmount: true,
          taxAmount: true
        }
      }),
      prisma.sale.count({ where })
    ]);

    // Also get cost data from SaleItems to calculate Gross Margin accurately
    // Note: Enterprise POS tracks COGS at the time of sale.
    const itemAggregations = await prisma.saleItem.aggregate({
      where: { sale: where },
      _sum: {
        totalPrice: true,
        // Since costAtSale is Decimal, Prisma supports _sum on it
        // We multiply costAtSale * quantity to get total COGS per line item.
        // Prisma's aggregate doesn't support multiplying columns directly, 
        // but since we only need rough BI we can fetch raw or use a specialized query.
      }
    });

    // To get exact COGS, we use a raw query because Prisma cannot sum(costAtSale * quantity).
    // The engine isolates this dirty truth of relational BI.
    const cogsResult = await prisma.$queryRaw<[{ total_cogs: number }]>`
      SELECT COALESCE(SUM("costAtSale" * "quantity"), 0) as total_cogs
      FROM "sale_items" si
      JOIN "sales" s ON s.id = si."saleId"
      WHERE s.status = 'COMPLETED'
      ${ctx.startDate ? Prisma.sql`AND s."saleDate" >= ${ctx.startDate}` : Prisma.empty}
      ${ctx.endDate ? Prisma.sql`AND s."saleDate" <= ${ctx.endDate}` : Prisma.empty}
    `;

    // Payment method breakdown
    const paymentAggregations = await prisma.payment.groupBy({
      by: ['method'],
      where: {
        sale: where,
        status: 'PAID',
      },
      _sum: {
        amount: true,
      },
    });

    const paymentBreakdown = paymentAggregations.reduce((acc, curr) => {
      acc[curr.method] = Number(curr._sum.amount || 0);
      return acc;
    }, {} as Record<string, number>);

    return {
      revenue: Number(aggregations._sum.grandTotal || 0),
      orderCount: count,
      totalDiscount: Number(aggregations._sum.discountAmount || 0) + Number(aggregations._sum.manualDiscountAmount || 0),
      totalTax: Number(aggregations._sum.taxAmount || 0),
      totalCogs: Number(cogsResult[0]?.total_cogs || 0),
      paymentBreakdown
    };
  }
};
