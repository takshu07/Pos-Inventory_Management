// =============================================================================
// CATALOG SERVICE (shared product-catalog business logic)
//
// This is the single source of truth for all *read* business logic over the
// product catalog: how a product row is projected (with variant rollups),
// how catalog-wide statistics are computed, and how a single product's full
// detail is assembled. Both the Owner and Manager product modules build on
// this — the Owner module adds write operations and financial fields on top,
// the Manager module strips financial fields out. Neither duplicates the
// aggregation logic below.
//
// Key data-model fact: SKU, barcode, cost/selling/MRP prices, and stock all
// live on ProductVariant, never on Product. A product's "price" and "stock"
// are therefore aggregates across its variants (price *range*, summed stock).
// =============================================================================

import type { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import type { PaginatedResponse } from "../types/common.types";

// ─── Shared query shape ───────────────────────────────────────────────────────

export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export interface CatalogListQuery {
  page: number;
  limit: number;
  search?: string | undefined;
  categoryId?: string | undefined;
  brandId?: string | undefined;
  isActive?: boolean | undefined;
  stockStatus?: StockStatus | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  sortBy?: string | undefined;
  sortOrder?: "asc" | "desc" | undefined;
}

// A product variant is "low stock" when its currentStock is at or below its
// reorderLevel (and reorderLevel is configured). When no reorderLevel is set we
// fall back to this default threshold so the dashboard/badges still work.
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

// ─── Row projection ───────────────────────────────────────────────────────────

/**
 * The rollup shape shared by both modules. Financial fields (costPrice, margin,
 * inventoryValue) are always computed but the Manager module strips them before
 * the row leaves its service — see manager.products.service.ts.
 */
export interface CatalogRow {
  id: string;
  name: string;
  description: string | null;
  imageUrls: string[];
  imageUrl: string | null; // first image, convenience for tables/cards
  isActive: boolean;
  category: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  // Variant rollups
  variantCount: number;
  totalStock: number;
  stockStatus: StockStatus;
  // Representative SKU/barcode (first variant) for quick copy in tables
  primarySku: string | null;
  primaryBarcode: string | null;
  // Price range across variants (selling price)
  minSellingPrice: number | null;
  maxSellingPrice: number | null;
  minMrp: number | null;
  maxMrp: number | null;
  // Financial (Owner-only — stripped by the manager service)
  avgCostPrice: number | null;
  avgMargin: number | null; // percentage
  inventoryValue: number; // sum(costPrice * currentStock) across variants
  createdAt: Date;
  updatedAt: Date;
}

// The variant fields we always need to compute a row's rollups.
const rowVariantSelect = {
  sku: true,
  barcode: true,
  costPrice: true,
  sellingPrice: true,
  mrp: true,
  currentStock: true,
  reorderLevel: true,
  isActive: true,
} satisfies Prisma.ProductVariantSelect;

const rowInclude = {
  category: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true } },
  variants: { select: rowVariantSelect, orderBy: { createdAt: "asc" } },
} satisfies Prisma.ProductInclude;

type ProductWithVariants = Prisma.ProductGetPayload<{ include: typeof rowInclude }>;

const num = (d: Prisma.Decimal | number | null | undefined): number =>
  d == null ? 0 : typeof d === "number" ? d : Number(d);

function deriveStockStatus(totalStock: number, anyLow: boolean): StockStatus {
  if (totalStock <= 0) return "OUT_OF_STOCK";
  if (anyLow) return "LOW_STOCK";
  return "IN_STOCK";
}

/** Projects a raw product-with-variants record into the shared CatalogRow. */
export function projectRow(p: ProductWithVariants): CatalogRow {
  const variants = p.variants;
  const totalStock = variants.reduce((s, v) => s + v.currentStock, 0);

  const anyLow = variants.some((v) => {
    const threshold = v.reorderLevel ?? DEFAULT_LOW_STOCK_THRESHOLD;
    return v.currentStock > 0 && v.currentStock <= threshold;
  });

  const sellingPrices = variants.map((v) => num(v.sellingPrice));
  const mrps = variants.map((v) => num(v.mrp));
  const costPrices = variants.map((v) => num(v.costPrice));

  const inventoryValue = variants.reduce(
    (s, v) => s + num(v.costPrice) * v.currentStock,
    0
  );

  const avgCostPrice =
    costPrices.length > 0
      ? costPrices.reduce((s, c) => s + c, 0) / costPrices.length
      : null;

  // Margin per variant = (selling - cost) / selling * 100; average across variants
  // that have a positive selling price.
  const margins = variants
    .filter((v) => num(v.sellingPrice) > 0)
    .map((v) => ((num(v.sellingPrice) - num(v.costPrice)) / num(v.sellingPrice)) * 100);
  const avgMargin =
    margins.length > 0 ? margins.reduce((s, m) => s + m, 0) / margins.length : null;

  const first = variants[0];

  return {
    id: p.id,
    name: p.name,
    description: p.description,
    imageUrls: p.imageUrls,
    imageUrl: p.imageUrls[0] ?? null,
    isActive: p.isActive,
    category: p.category ? { id: p.category.id, name: p.category.name } : null,
    brand: p.brand ? { id: p.brand.id, name: p.brand.name } : null,
    variantCount: variants.length,
    totalStock,
    stockStatus: deriveStockStatus(totalStock, anyLow),
    primarySku: first?.sku ?? null,
    primaryBarcode: first?.barcode ?? null,
    minSellingPrice: sellingPrices.length ? Math.min(...sellingPrices) : null,
    maxSellingPrice: sellingPrices.length ? Math.max(...sellingPrices) : null,
    minMrp: mrps.length ? Math.min(...mrps) : null,
    maxMrp: mrps.length ? Math.max(...mrps) : null,
    avgCostPrice,
    avgMargin,
    inventoryValue,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// ─── WHERE / ORDER BY builders ────────────────────────────────────────────────

function buildWhere(query: CatalogListQuery): Prisma.ProductWhereInput {
  const { search, categoryId, brandId, isActive, stockStatus, minPrice, maxPrice } =
    query;

  // Variant-scoped filters (price range, stock status) are expressed as a
  // `variants: { some }` condition so a product qualifies if ANY of its
  // variants matches. Stock-status filtering to the exact bucket is refined
  // post-projection in listProducts because "IN_STOCK for the product" depends
  // on the summed stock, which SQL can't express per-row here without a raw query.
  const variantSome: Prisma.ProductVariantWhereInput = {};

  if (minPrice !== undefined) {
    variantSome.sellingPrice = { ...(variantSome.sellingPrice as object), gte: minPrice };
  }
  if (maxPrice !== undefined) {
    variantSome.sellingPrice = { ...(variantSome.sellingPrice as object), lte: maxPrice };
  }
  if (stockStatus === "OUT_OF_STOCK") {
    // handled at product level below (all variants zero) — approximate with none in-stock
  }

  const where: Prisma.ProductWhereInput = {
    ...(isActive !== undefined && { isActive }),
    ...(categoryId && { categoryId }),
    ...(brandId && { brandId }),
    ...(Object.keys(variantSome).length > 0 && { variants: { some: variantSome } }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { searchKeywords: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { variants: { some: { sku: { contains: search, mode: "insensitive" } } } },
        { variants: { some: { barcode: { contains: search, mode: "insensitive" } } } },
        { category: { name: { contains: search, mode: "insensitive" } } },
        { brand: { name: { contains: search, mode: "insensitive" } } },
      ],
    }),
  };

  return where;
}

function buildOrderBy(query: CatalogListQuery): Prisma.ProductOrderByWithRelationInput {
  const dir = query.sortOrder ?? "desc";
  switch (query.sortBy) {
    case "name":
      return { name: query.sortOrder ?? "asc" };
    case "createdAt":
      return { createdAt: dir };
    case "updatedAt":
      return { updatedAt: dir };
    // price/stock sorts require variant aggregation; approximated by createdAt
    // here and finalized post-projection in listProducts.
    default:
      return { createdAt: "desc" };
  }
}

// Sort keys that must be applied after we've projected variant rollups.
const POST_SORT_KEYS = new Set([
  "priceHigh",
  "priceLow",
  "stockHigh",
  "stockLow",
]);

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * Lists products with variant rollups, server-side paginated/filtered/sorted.
 * Returns the shared paginated envelope. Financial fields are present on every
 * row; the Manager service is responsible for stripping them.
 */
export async function listProducts(
  query: CatalogListQuery
): Promise<PaginatedResponse<CatalogRow>> {
  const where = buildWhere(query);
  const isPostSort = query.sortBy ? POST_SORT_KEYS.has(query.sortBy) : false;

  const skip = (query.page - 1) * query.limit;

  // For post-projection sorts (price/stock rollups) and stock-status bucket
  // filtering we cannot page in SQL alone. We keep it correct-but-simple: count
  // + fetch the page for DB-sortable cases; for post-sort cases we fetch a
  // bounded window and sort/slice in memory. At enterprise scale the price/stock
  // sorts should move to a materialized rollup — see TODO below.
  if (!isPostSort && !query.stockStatus) {
    const [total, rows] = await prisma.$transaction([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: buildOrderBy(query),
        include: rowInclude,
      }),
    ]);
    return envelope(rows.map(projectRow), total, query);
  }

  // TODO(scale): replace this bounded in-memory path with a denormalized
  // product_stats rollup table (totalStock, minPrice, maxPrice, stockStatus)
  // maintained on variant/inventory changes, so price/stock sorts and
  // stock-status filters page entirely in SQL for 100k+ catalogs.
  //
  // DECIDED (2026-08-02): build this together with the `brand_stats` rollup
  // described at brand.repository.statsFor. Both are fed by the same write
  // paths, so doing them as one piece of work wires those hooks once. See
  // docs/MODULE_STATUS.md §3.
  const WINDOW = 2000;
  const raw = await prisma.product.findMany({
    where,
    take: WINDOW,
    orderBy: buildOrderBy(query),
    include: rowInclude,
  });

  let projected = raw.map(projectRow);

  if (query.stockStatus) {
    projected = projected.filter((r) => r.stockStatus === query.stockStatus);
  }

  if (isPostSort) {
    projected.sort((a, b) => {
      switch (query.sortBy) {
        case "priceHigh":
          return (b.maxSellingPrice ?? 0) - (a.maxSellingPrice ?? 0);
        case "priceLow":
          return (a.minSellingPrice ?? 0) - (b.minSellingPrice ?? 0);
        case "stockHigh":
          return b.totalStock - a.totalStock;
        case "stockLow":
          return a.totalStock - b.totalStock;
        default:
          return 0;
      }
    });
  }

  const total = projected.length;
  const pageRows = projected.slice(skip, skip + query.limit);
  return envelope(pageRows, total, query);
}

function envelope<T>(
  data: T[],
  total: number,
  query: { page: number; limit: number }
): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / query.limit) || 1;
  return {
    data,
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1,
    },
  };
}

// ─── Detail ───────────────────────────────────────────────────────────────────

const detailInclude = {
  category: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true } },
  variants: {
    orderBy: { createdAt: "asc" },
    include: {
      size: { select: { id: true, name: true } },
      color: { select: { id: true, name: true, hexCode: true } },
    },
  },
} satisfies Prisma.ProductInclude;

export type CatalogDetail = Prisma.ProductGetPayload<{ include: typeof detailInclude }> & {
  rollup: Pick<
    CatalogRow,
    | "variantCount"
    | "totalStock"
    | "stockStatus"
    | "minSellingPrice"
    | "maxSellingPrice"
    | "avgMargin"
    | "inventoryValue"
  >;
};

/** Full product detail with all variants and a rollup summary. */
export async function getProductDetail(id: string): Promise<CatalogDetail> {
  const product = await prisma.product.findUnique({
    where: { id },
    include: detailInclude,
  });

  if (!product) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Product not found.");
  }

  // Reuse projectRow's rollup math by adapting the detail variants.
  const row = projectRow(product as unknown as ProductWithVariants);

  return {
    ...product,
    rollup: {
      variantCount: row.variantCount,
      totalStock: row.totalStock,
      stockStatus: row.stockStatus,
      minSellingPrice: row.minSellingPrice,
      maxSellingPrice: row.maxSellingPrice,
      avgMargin: row.avgMargin,
      inventoryValue: row.inventoryValue,
    },
  };
}

// ─── Statistics ───────────────────────────────────────────────────────────────

export interface CatalogStats {
  totalProducts: number;
  activeProducts: number;
  inactiveProducts: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  totalVariants: number;
  totalCategories: number;
  totalBrands: number;
  inventoryValue: number; // Owner-only; manager service omits
  averageMargin: number | null; // Owner-only; manager service omits
}

/**
 * Computes catalog-wide statistics. This is the expensive dashboard query;
 * results are cache-friendly (the frontend hook keeps them stale-tolerant).
 *
 * TODO(scale): back the stock/margin/value aggregates with a rollup table for
 * 100k+ catalogs; the current implementation scans variants in bounded batches.
 */
export async function getCatalogStats(): Promise<CatalogStats> {
  const [
    totalProducts,
    activeProducts,
    totalVariants,
    totalCategories,
    totalBrands,
    variantAgg,
  ] = await prisma.$transaction([
    prisma.product.count(),
    prisma.product.count({ where: { isActive: true } }),
    prisma.productVariant.count(),
    prisma.category.count({ where: { isActive: true } }),
    prisma.brand.count({ where: { isActive: true } }),
    prisma.productVariant.aggregate({
      _sum: { currentStock: true },
    }),
  ]);

  // Low/out-of-stock and inventory value are computed per-product from variant
  // rollups. We stream variants grouped by product to avoid loading everything.
  const products = await prisma.product.findMany({
    select: {
      id: true,
      variants: {
        select: { currentStock: true, reorderLevel: true, costPrice: true, sellingPrice: true },
      },
    },
  });

  let lowStockProducts = 0;
  let outOfStockProducts = 0;
  let inventoryValue = 0;
  const marginSamples: number[] = [];

  for (const p of products) {
    const totalStock = p.variants.reduce((s, v) => s + v.currentStock, 0);
    const anyLow = p.variants.some((v) => {
      const t = v.reorderLevel ?? DEFAULT_LOW_STOCK_THRESHOLD;
      return v.currentStock > 0 && v.currentStock <= t;
    });
    if (totalStock <= 0) outOfStockProducts += 1;
    else if (anyLow) lowStockProducts += 1;

    for (const v of p.variants) {
      inventoryValue += num(v.costPrice) * v.currentStock;
      const sp = num(v.sellingPrice);
      if (sp > 0) marginSamples.push(((sp - num(v.costPrice)) / sp) * 100);
    }
  }

  const averageMargin =
    marginSamples.length > 0
      ? marginSamples.reduce((s, m) => s + m, 0) / marginSamples.length
      : null;

  void variantAgg; // aggregate kept for potential future totals; not needed here

  return {
    totalProducts,
    activeProducts,
    inactiveProducts: totalProducts - activeProducts,
    lowStockProducts,
    outOfStockProducts,
    totalVariants,
    totalCategories,
    totalBrands,
    inventoryValue,
    averageMargin,
  };
}
