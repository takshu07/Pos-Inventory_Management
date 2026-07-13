import { Prisma } from "../../generated/prisma";

// ============================================================================
// CONTEXT & INTERFACES
// ============================================================================

export type Granularity = "HOUR" | "DAY" | "WEEK" | "MONTH" | "YEAR";

export interface AnalyticsFilterContext {
  startDate?: Date | undefined;
  endDate?: Date | undefined;
  granularity?: Granularity | undefined;
  employeeId?: string | undefined;
  customerId?: string | undefined;
  categoryId?: string | undefined;
  brandId?: string | undefined;
  supplierId?: string | undefined;
  // Extensible for future dimensions
  [key: string]: any;
}

export interface ReportResult<T = any> {
  metadata: {
    generatedAt: Date;
    filtersApplied: AnalyticsFilterContext;
    rowCount: number;
  };
  data: T;
}

export interface ReportStrategy<T = any> {
  name: string;
  category: string;
  execute(ctx: AnalyticsFilterContext): Promise<T>;
}

// ============================================================================
// ANALYTICS ENGINE
// Single source of truth for Business Intelligence. 
// OCP Compliant: Add new reports by registering new strategies.
// ============================================================================

export class AnalyticsEngine {
  private static strategies: Map<string, ReportStrategy> = new Map();

  /**
   * Registers a new reporting strategy, allowing modules to inject their own
   * reports without mutating this core engine.
   */
  static registerStrategy(strategy: ReportStrategy) {
    this.strategies.set(strategy.name, strategy);
  }

  /**
   * Executes a specific report by name.
   */
  static async generateReport<T>(reportName: string, ctx: AnalyticsFilterContext): Promise<ReportResult<T>> {
    const strategy = this.strategies.get(reportName);
    
    if (!strategy) {
      throw new Error(`Report Strategy '${reportName}' is not registered.`);
    }

    const data = await strategy.execute(ctx);

    return {
      metadata: {
        generatedAt: new Date(),
        filtersApplied: ctx,
        rowCount: Array.isArray(data) ? data.length : 1,
      },
      data,
    };
  }

  /**
   * Lists all available reports.
   */
  static getAvailableReports() {
    return Array.from(this.strategies.values()).map(s => ({
      name: s.name,
      category: s.category
    }));
  }
}

// ============================================================================
// CORE BI MATH UTILITIES
// Centralized calculations so Dashboards never duplicate math.
// ============================================================================

export class BIMath {
  static calculateGrowthPercentage(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Number((((current - previous) / previous) * 100).toFixed(2));
  }

  static calculateGrossMargin(revenue: number, costOfGoodsSold: number): number {
    if (revenue === 0) return 0;
    return Number((((revenue - costOfGoodsSold) / revenue) * 100).toFixed(2));
  }

  static calculateAverageOrderValue(revenue: number, orderCount: number): number {
    if (orderCount === 0) return 0;
    return Number((revenue / orderCount).toFixed(2));
  }
}
