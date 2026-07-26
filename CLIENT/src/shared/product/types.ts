/**
 * Shared product domain types.
 *
 * These mirror the backend's shared catalog projection (CatalogRow / CatalogDetail
 * in SERVER/src/services/catalog.service.ts). Both the Owner and Manager product
 * modules build on these types. Financial fields are optional here because the
 * Manager API strips them server-side — the same component can render an owner
 * row (with margin/value) or a manager row (without) without branching types.
 */

export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export interface ProductRefLite {
  id: string;
  name: string;
}

/** A product row with variant rollups — the shape rendered in tables/cards. */
export interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  imageUrls: string[];
  imageUrl: string | null;
  isActive: boolean;
  category: ProductRefLite | null;
  brand: ProductRefLite | null;
  variantCount: number;
  totalStock: number;
  stockStatus: StockStatus;
  primarySku: string | null;
  primaryBarcode: string | null;
  minSellingPrice: number | null;
  maxSellingPrice: number | null;
  minMrp: number | null;
  maxMrp: number | null;
  createdAt: string;
  updatedAt: string;

  // Owner-only financial fields (absent on manager rows).
  avgCostPrice?: number | null;
  avgMargin?: number | null;
  inventoryValue?: number;
}

export interface ProductVariantRow {
  id: string;
  sku: string;
  barcode: string | null;
  sellingPrice: number | string;
  mrp: number | string;
  costPrice?: number | string; // owner-only
  currentStock: number;
  reorderLevel: number | null;
  isActive: boolean;
  size: { id: string; name: string } | null;
  color: { id: string; name: string; hexCode?: string | null } | null;
}

export interface ProductRollup {
  variantCount: number;
  totalStock: number;
  stockStatus: StockStatus;
  minSellingPrice: number | null;
  maxSellingPrice: number | null;
  avgMargin?: number | null; // owner-only
  inventoryValue?: number; // owner-only
}

export interface ProductDetail {
  id: string;
  name: string;
  description: string | null;
  imageUrls: string[];
  isActive: boolean;
  category: ProductRefLite | null;
  brand: ProductRefLite | null;
  variants: ProductVariantRow[];
  rollup: ProductRollup;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogStats {
  totalProducts: number;
  activeProducts: number;
  inactiveProducts: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  totalVariants: number;
  totalCategories: number;
  totalBrands: number;
  inventoryValue?: number; // owner-only
  averageMargin?: number | null; // owner-only
}

export interface FilterOption {
  id: string;
  name: string;
}

export type SortOption =
  | "newest"
  | "name"
  | "priceHigh"
  | "priceLow"
  | "stockHigh"
  | "stockLow";

export interface ProductFilterState {
  search: string;
  categoryId: string;
  brandId: string;
  stockStatus: StockStatus | "";
  isActive: "" | "true" | "false";
  minPrice: string;
  maxPrice: string;
  sortBy: SortOption;
}

/** Table column identifiers shared by the ProductTable and both modules' presets. */
export type ProductColumn =
  | "image"
  | "name"
  | "sku"
  | "barcode"
  | "category"
  | "brand"
  | "cost"
  | "mrp"
  | "selling"
  | "margin"
  | "stock"
  | "variants"
  | "status"
  | "updatedAt";

/** Manager column preset — no financial (cost/margin) columns, ever. */
export const MANAGER_COLUMNS: ProductColumn[] = [
  "image",
  "name",
  "sku",
  "barcode",
  "category",
  "brand",
  "mrp",
  "selling",
  "stock",
  "variants",
  "status",
];

/** Owner column preset — includes cost and margin. */
export const OWNER_COLUMNS: ProductColumn[] = [
  "image",
  "name",
  "sku",
  "category",
  "brand",
  "cost",
  "mrp",
  "selling",
  "margin",
  "stock",
  "variants",
  "status",
  "updatedAt",
];

export const EMPTY_FILTERS: ProductFilterState = {
  search: "",
  categoryId: "",
  brandId: "",
  stockStatus: "",
  isActive: "",
  minPrice: "",
  maxPrice: "",
  sortBy: "newest",
};
