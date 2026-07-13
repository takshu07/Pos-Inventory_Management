import { AnalyticsEngine, BIMath, type AnalyticsFilterContext, type ReportStrategy } from "../engines/analytics.engine";
import { analyticsRepository } from "../repositories/analytics.repository";

// ============================================================================
// CONCRETE REPORT STRATEGIES
// ============================================================================

class SalesDashboardKPIStrategy implements ReportStrategy {
  name = "SalesDashboardKPI";
  category = "Sales";

  async execute(ctx: AnalyticsFilterContext) {
    // 1. Fetch Current Period
    const currentKPIs = await analyticsRepository.getSalesKPIs(ctx);

    // 2. Fetch Previous Period for comparative analysis
    // If ctx has a date range (e.g. 7 days), we calculate the previous 7 days.
    let previousKPIs = null;
    if (ctx.startDate && ctx.endDate) {
      const durationMs = ctx.endDate.getTime() - ctx.startDate.getTime();
      const prevCtx: AnalyticsFilterContext = {
        ...ctx,
        startDate: new Date(ctx.startDate.getTime() - durationMs),
        endDate: new Date(ctx.endDate.getTime() - durationMs),
      };
      previousKPIs = await analyticsRepository.getSalesKPIs(prevCtx);
    }

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
