import { AnalyticsEngine, BIMath, type AnalyticsFilterContext, type ReportStrategy } from "../engines/analytics.engine";
import { analyticsRepository } from "../repositories/analytics.repository";

// ============================================================================
// CONCRETE REPORT STRATEGIES
// ============================================================================

class SalesDashboardKPIStrategy implements ReportStrategy {
  name = "SalesDashboardKPI";
  category = "Sales";

  async execute(ctx: AnalyticsFilterContext) {
    // The current-period and previous-period KPI batches are independent of each
    // other, so run them concurrently. When a comparison window exists this
    // overlaps two multi-query batches instead of serializing them, roughly
    // halving the dashboard's DB wall-clock. The math below is unchanged.
    const prevCtx: AnalyticsFilterContext | null =
      ctx.startDate && ctx.endDate
        ? {
            ...ctx,
            startDate: new Date(
              ctx.startDate.getTime() -
                (ctx.endDate.getTime() - ctx.startDate.getTime())
            ),
            endDate: new Date(
              ctx.startDate.getTime()
            ),
          }
        : null;

    const [currentKPIs, previousKPIs] = await Promise.all([
      analyticsRepository.getSalesKPIs(ctx),
      prevCtx
        ? analyticsRepository.getSalesKPIs(prevCtx)
        : Promise.resolve(null),
    ]);

    // 3. Centralized Math Execution
    const grossMargin = BIMath.calculateGrossMargin(currentKPIs.revenue, currentKPIs.totalCogs);
    const averageOrderValue = BIMath.calculateAverageOrderValue(currentKPIs.revenue, currentKPIs.orderCount);
    
    let revenueGrowth = 0;
    if (previousKPIs) {
      revenueGrowth = BIMath.calculateGrowthPercentage(currentKPIs.revenue, previousKPIs.revenue);
    }

    return {
      revenue: currentKPIs.revenue,
      revenueGrowth, // Automatically calculated by engine math
      orderCount: currentKPIs.orderCount,
      averageOrderValue,
      totalDiscount: currentKPIs.totalDiscount,
      totalTax: currentKPIs.totalTax,
      grossMarginPercent: grossMargin,
      paymentBreakdown: currentKPIs.paymentBreakdown,
      comparative: previousKPIs ? {
        previousRevenue: previousKPIs.revenue,
        previousOrderCount: previousKPIs.orderCount
      } : null
    };
  }
}

// Register all strategies to the engine at boot
AnalyticsEngine.registerStrategy(new SalesDashboardKPIStrategy());

// ============================================================================
// ANALYTICS SERVICE ORCHESTRATOR
// ============================================================================

export const analyticsService = {
  /**
   * Retrieves a list of available reports.
   * Useful for the frontend to render dynamic report selection menus.
   */
  getAvailableReports() {
    return AnalyticsEngine.getAvailableReports();
  },

  /**
   * Executes a requested report safely.
   */
  async generateReport(reportName: string, filters: Record<string, any>) {
    // Construct the context from raw input (after zod validation)
    const ctx: AnalyticsFilterContext = {
      ...filters,
      startDate: filters.startDate ? new Date(filters.startDate) : undefined,
      endDate: filters.endDate ? new Date(filters.endDate) : undefined,
    };

    return AnalyticsEngine.generateReport(reportName, ctx);
  }
};
