/**
 * shared/product — the public API for the shared product domain.
 *
 * Both the Owner and Manager product modules import EVERYTHING product-shared
 * from here (never from internal files). These components hold presentation and
 * shared domain formatting only; all business logic lives on the server (the
 * shared catalog.service). RBAC differences are expressed purely through props
 * (showFinancials, renderActions, readOnlyBanner, column sets) — the components
 * themselves are permission-agnostic and safe to reuse across both modules.
 */

// Types
export type {
  StockStatus,
  ProductRefLite,
  ProductRow,
  ProductVariantRow,
  ProductRollup,
  ProductDetail,
  CatalogStats,
  FilterOption,
  SortOption,
  ProductFilterState,
  ProductColumn,
} from "./types";
export { EMPTY_FILTERS, OWNER_COLUMNS, MANAGER_COLUMNS } from "./types";

// Shared URL-backed filter/pagination state
export { useProductFilters } from "./useProductFilters";

// Utils
export {
  formatPriceRange,
  formatSellingRange,
  formatMrpRange,
  formatMargin,
  STOCK_STATUS_LABEL,
  STOCK_STATUS_BADGE,
} from "./utils";

// Components
export { ProductSearch } from "./components/ProductSearch";
export { ProductFilters } from "./components/ProductFilters";
export { ProductTable } from "./components/ProductTable";
export { ProductCard } from "./components/ProductCard";
export { ProductImageGallery } from "./components/ProductImageGallery";
export { ProductDetailsDrawer } from "./components/ProductDetailsDrawer";
export { ProductVariantTable } from "./components/ProductVariantTable";
export { ProductStatusBadge } from "./components/ProductStatusBadge";
export { ProductStockIndicator } from "./components/ProductStockIndicator";
export { ProductPriceCard } from "./components/ProductPriceCard";
export { EffectivePricePanel } from "./components/EffectivePricePanel";

// Effective pricing — shared read surface (/api/v1/pricing), used by both portals.
export { useProductPricing, fetchProductPricing, pricingKeys } from "./pricingApi";
export type { EffectivePrice, ProductPricing } from "./pricingApi";
export {
  ProductTableSkeleton,
  ProductCardSkeleton,
  ProductCardGridSkeleton,
} from "./components/ProductSkeleton";
export { ProductEmptyState } from "./components/ProductEmptyState";
