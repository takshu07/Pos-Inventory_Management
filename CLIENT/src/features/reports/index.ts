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

export { GlobalSearchBar } from "./components/GlobalSearchBar";
export { ReportShell } from "./components/ReportShell";

export {
  useReportDashboard,
  useFilterOptions,
  useGlobalSearch,
  reportKeys,
} from "./hooks/useReports";

export type { ReportKey, ReportParams, SearchHit, GlobalSearchResult } from "./api/reportsApi";
