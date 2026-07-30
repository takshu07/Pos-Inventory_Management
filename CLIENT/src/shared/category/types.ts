/**
 * Shared category domain types.
 *
 * These mirror the backend DTOs (CategoryDTO in SERVER/src/services/category.service.ts
 * and CategoryPerformance in categoryAnalytics.service.ts). Both the Owner and
 * Manager category modules build on these types.
 *
 * Unlike products — where the manager API strips cost/margin — a category row
 * carries no financial fields at all, so ONE row type serves both roles. The
 * financial data lives in a separate analytics type that only the owner module
 * ever requests.
 */

export type CategoryStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";

export interface CategoryRef {
  id: string;
  name: string;
}

export interface CategoryActor {
  id: string;
  name: string;
}

/** A category row — the shape rendered in tables, cards and the drawer header. */
export interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  searchKeywords: string | null;
  status: CategoryStatus;
  isActive: boolean;
  displayOrder: number;
  /** Hierarchy fields — populated by the API, not yet surfaced in the UI. */
  parentId: string | null;
  path: string | null;
  level: number;
  productCount: number;
  createdBy: CategoryActor | null;
  updatedBy: CategoryActor | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Dashboard summary counters. */
export interface CategorySummary {
  total: number;
  active: number;
  inactive: number;
  archived: number;
  totalProducts: number;
  uncategorized: number;
  empty: number;
}

/** A product inside a category — the drawer's Products tab. */
export interface CategoryProductRow {
  id: string;
  name: string;
  imageUrl: string | null;
  brand: string | null;
  mrp: number | null;
  mrpMax: number | null;
  sellingPrice: number | null;
  sellingPriceMax: number | null;
  stock: number;
  variantCount: number;
  status: string;
  isActive: boolean;
  createdAt: string;
}

/** A discount rule targeting a category (Phase 2). */
export interface CategoryDiscount {
  id: string;
  name: string;
  description: string | null;
  type: "PERCENTAGE" | "FLAT";
  value: number;
  priority: number;
  startDate: string | null;
  endDate: string | null;
  isEnabled: boolean;
  status: "ACTIVE" | "SCHEDULED" | "EXPIRED" | "DISABLED";
  source: "CATEGORY";
  createdAt: string;
  updatedAt: string;
}

/** One entry in the activity timeline (Phase 2), derived from the audit log. */
export interface CategoryActivityEvent {
  id: string;
  type: string;
  summary: string;
  changedFields: string[];
  actor: { id: string; name: string; role: string } | null;
  createdAt: string;
}

/** Per-category performance metrics (Phase 3). */
export interface CategoryPerformance {
  categoryId: string;
  categoryName: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  units: number;
  orders: number;
  discount: number;
  averageSellingPrice: number;
  returns: number;
  returnRate: number;
  inventoryValue: number;
  retailValue: number;
  stockUnits: number;
  productCount: number;
  lowStockProducts: number;
  growth: number;
  revenueShare: number;
}

export interface CategoryAnalyticsTotals {
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  units: number;
  orders: number;
  discount: number;
  returns: number;
  inventoryValue: number;
  retailValue: number;
  averageSellingPrice: number;
  categoriesWithSales: number;
}

export interface ChartPoint {
  name: string;
  value: number;
}

export interface MonthlyPoint {
  month: string;
  revenue: number;
  profit: number;
  units: number;
  orders: number;
}

export interface CategoryAnalyticsDashboard {
  period: { from: string; to: string; label: string };
  totals: CategoryAnalyticsTotals;
  widgets: {
    topByRevenue: CategoryPerformance[];
    lowestByRevenue: CategoryPerformance[];
    mostSold: CategoryPerformance[];
    leastSold: CategoryPerformance[];
    topByProfit: CategoryPerformance[];
    topByMargin: CategoryPerformance[];
    fastestGrowing: CategoryPerformance[];
    declining: CategoryPerformance[];
    discounted: CategoryPerformance[];
    lowStock: CategoryPerformance[];
    noSales: CategoryPerformance[];
    highestInventoryValue: CategoryPerformance[];
  };
  charts: {
    monthly: MonthlyPoint[];
    revenueByCategory: ChartPoint[];
    unitsByCategory: ChartPoint[];
    inventoryByCategory: ChartPoint[];
    marginByCategory: ChartPoint[];
  };
}

/** Single-category analytics — the drawer's Analytics tab. */
export interface SingleCategoryAnalytics {
  period: { from: string; to: string; label: string };
  metrics: CategoryPerformance;
  rank: { byRevenue: number; of: number };
  storeTotals: CategoryAnalyticsTotals;
  charts: { monthly: MonthlyPoint[] };
}

// ── Filters & sorting ────────────────────────────────────────────────────────

export type CategorySortOption =
  | "alphabetical"
  | "alphabetical_desc"
  | "productCount"
  | "productCount_asc"
  | "newest"
  | "oldest"
  | "recentlyUpdated"
  | "displayOrder";

export const CATEGORY_SORT_LABELS: Record<CategorySortOption, string> = {
  alphabetical: "Name (A–Z)",
  alphabetical_desc: "Name (Z–A)",
  productCount: "Most products",
  productCount_asc: "Fewest products",
  newest: "Newest first",
  oldest: "Oldest first",
  recentlyUpdated: "Recently updated",
  displayOrder: "Display order",
};

export interface CategoryFilterState {
  search: string;
  status: CategoryStatus | "";
  /** "" = any, "true" = has products, "false" = empty only. */
  hasProducts: "" | "true" | "false";
  createdFrom: string;
  createdTo: string;
  sortBy: CategorySortOption;
  includeArchived: "" | "true";
}

export const EMPTY_CATEGORY_FILTERS: CategoryFilterState = {
  search: "",
  status: "",
  hasProducts: "",
  createdFrom: "",
  createdTo: "",
  sortBy: "alphabetical",
  includeArchived: "",
};

// ── Table columns ────────────────────────────────────────────────────────────

export type CategoryColumn =
  | "select"
  | "image"
  | "name"
  | "description"
  | "products"
  | "status"
  | "createdBy"
  | "createdAt"
  | "updatedAt";

/** Owner sees attribution and audit columns. */
export const OWNER_CATEGORY_COLUMNS: CategoryColumn[] = [
  "select",
  "image",
  "name",
  "description",
  "products",
  "status",
  "createdBy",
  "createdAt",
  "updatedAt",
];

/** Manager sees the catalog view — no selection column (no bulk actions). */
export const MANAGER_CATEGORY_COLUMNS: CategoryColumn[] = [
  "image",
  "name",
  "description",
  "products",
  "status",
  "updatedAt",
];

/** Form payload shared by create and edit. */
export interface CategoryFormValues {
  name: string;
  description: string;
  searchKeywords: string;
  status: CategoryStatus;
  imageUrl: string;
}

export const EMPTY_CATEGORY_FORM: CategoryFormValues = {
  name: "",
  description: "",
  searchKeywords: "",
  status: "ACTIVE",
  imageUrl: "",
};
