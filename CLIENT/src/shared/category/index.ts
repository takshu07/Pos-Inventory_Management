/**
 * shared/category — the public API for the shared category domain.
 *
 * Both the Owner and Manager category modules import EVERYTHING category-shared
 * from here (never from internal files). These components hold presentation and
 * shared domain formatting only; all business logic lives on the server.
 *
 * RBAC differences are expressed purely through PROPS (canManage, renderActions,
 * selection handlers, column sets) — the components themselves are
 * permission-agnostic and safe to reuse across both modules. The security
 * boundary is the server's role guard, never a hidden button.
 */

// Types
export type {
  CategoryStatus,
  CategoryRef,
  CategoryActor,
  CategoryRow,
  CategorySummary,
  CategoryProductRow,
  CategoryDiscount,
  CategoryActivityEvent,
  CategoryPerformance,
  CategoryAnalyticsTotals,
  CategoryAnalyticsDashboard,
  SingleCategoryAnalytics,
  ChartPoint,
  MonthlyPoint,
  CategorySortOption,
  CategoryFilterState,
  CategoryColumn,
  CategoryFormValues,
} from "./types";

export {
  CATEGORY_SORT_LABELS,
  EMPTY_CATEGORY_FILTERS,
  EMPTY_CATEGORY_FORM,
  OWNER_CATEGORY_COLUMNS,
  MANAGER_CATEGORY_COLUMNS,
} from "./types";

// URL-backed filter/pagination state (with debounced search)
export { useCategoryFilters } from "./useCategoryFilters";

// Transport
export {
  categoryBase,
  fetchCategories,
  fetchCategorySummary,
  fetchCategory,
  fetchCategoryOptions,
  fetchCategoryProducts,
  createCategory,
  updateCategory,
  deleteCategory,
  archiveCategory,
  activateCategory,
  bulkCategoryAction,
  setCategoryImage,
  removeCategoryImage,
  fetchCategoryDiscounts,
  assignCategoryDiscount,
  fetchCategoryActivity,
  fetchCategoryAnalytics,
  fetchSingleCategoryAnalytics,
  fetchCategoryReport,
  downloadCategoryExport,
} from "./categoryApi";

export type {
  CategoryListParams,
  CategoryListResult,
  CategoryOption,
  CategoryWriteInput,
  DeleteCategoryResult,
  BulkActionResult,
  AssignDiscountInput,
  CategoryReport,
  PaginatedMeta,
} from "./categoryApi";

// React Query hooks
export {
  categoryKeys,
  useCategories,
  useCategorySummary,
  useCategoryOptions,
  useCategoryProducts,
  useCategoryDiscounts,
  useCategoryActivity,
  useCategoryAnalytics,
  useSingleCategoryAnalytics,
  useCategoryReport,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useArchiveCategory,
  useActivateCategory,
  useBulkCategoryAction,
  useAssignCategoryDiscount,
  useSetCategoryImage,
} from "./useCategories";

// Components
export { CategoryTable } from "./components/CategoryTable";
export { CategoryCard } from "./components/CategoryCard";
export { CategorySearch } from "./components/CategorySearch";
export { CategoryFilters } from "./components/CategoryFilters";
export { CategoryForm, validateCategoryForm } from "./components/CategoryForm";
export type { CategoryFormErrors } from "./components/CategoryForm";
export { CategoryDrawer } from "./components/CategoryDrawer";
export type { CategoryDrawerTab } from "./components/CategoryDrawer";
export { CategoryStatusBadge, CATEGORY_STATUS_LABEL } from "./components/CategoryStatusBadge";
export { CategoryBulkToolbar } from "./components/CategoryBulkToolbar";
export type { CategoryBulkAction } from "./components/CategoryBulkToolbar";
export { CategoryEmptyState } from "./components/CategoryEmptyState";
export { CategoryDeleteDialog } from "./components/CategoryDeleteDialog";
export { CategoryImageUpload } from "./components/CategoryImageUpload";
// NOTE: CategoryCharts is intentionally NOT re-exported. It pulls in Recharts
// (~405 kB), and a static re-export here would put that in the bundle of every
// importer of this barrel — including the manager module, which renders no
// charts at all. The two consumers (the owner analytics page and the lazy
// Analytics tab) import from "./components/CategoryCharts" directly.
export {
  CategoryTableSkeleton,
  CategoryCardGridSkeleton,
  CategorySummarySkeleton,
  CategoryDetailSkeleton,
} from "./components/CategorySkeleton";

// Drawer tabs (exported so a module can compose its own tab arrangement).
//
// ONLY the two eager tabs are re-exported here. Discounts, Analytics and
// Activity are deliberately absent: CategoryDrawer lazy-imports them, and a
// static re-export from this barrel would cancel that split — every importer of
// @/shared/category (including the manager module, which can never open those
// owner-only tabs) would pull in their code and Recharts with it. Import them
// from their own paths if a module ever needs to compose them directly.
export { CategoryOverviewTab } from "./components/tabs/CategoryOverviewTab";
export { CategoryProductsTab } from "./components/tabs/CategoryProductsTab";
