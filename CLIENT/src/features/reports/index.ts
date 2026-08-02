/**
 * Reports — public barrel.
 * The router imports pages from here; GlobalSearchBar is exported so the navbar
 * can host it outside the Reports module.
 */

export { default as ReportsDashboardPage } from "./pages/ReportsDashboardPage";
export { default as SalesReportPage } from "./pages/SalesReportPage";
export { default as ProductReportPage } from "./pages/ProductReportPage";
export { default as ProfitReportPage } from "./pages/ProfitReportPage";

export {
  CategoryReportPage,
  BrandReportPage,
} from "./pages/CategoryBrandReportPages";

export {
  CustomerReportPage,
  EmployeeReportPage,
} from "./pages/CustomerEmployeeReportPages";

export {
  InventoryReportPage,
  PurchaseReportPage,
  PaymentReportPage,
  ReturnReportPage,
} from "./pages/OperationsReportPages";

/**
 * The five consolidated, tab-based report destinations the sidebar links to.
 * The individual page exports above are retained: the tabs render them, and
 * removing them would break the legacy-route redirects that still resolve.
 */
export {
  SalesReportsPage,
  InventoryReportsPage,
  CustomerReportsPage,
  EmployeeReportsPage,
  FinanceReportsPage,
} from "./pages/TabbedReportPages";

export { GlobalSearchBar } from "./components/GlobalSearchBar";
export { ReportShell } from "./components/ReportShell";
export { TabbedReportPage, ReportTabs, useReportTab } from "./components/ReportTabs";
export type { ReportTabDef } from "./components/ReportTabs";

export {
  useReportDashboard,
  useFilterOptions,
  useGlobalSearch,
  reportKeys,
} from "./hooks/useReports";

export type { ReportKey, ReportParams, SearchHit, GlobalSearchResult } from "./api/reportsApi";
