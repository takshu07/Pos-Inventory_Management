/**
 * Shared product presentation helpers. Pure functions only — no business logic
 * that belongs on the server. These format the server's aggregates for display
 * so both modules render prices/stock identically.
 */

import { formatCurrency } from "@/utils/formatters";
import type { ProductRow, StockStatus } from "./types";

const toNum = (v: number | string | null | undefined): number =>
  v == null ? 0 : typeof v === "number" ? v : Number(v);

/** Formats a variant price *range* as "₹499" or "₹499 – ₹899". */
export function formatPriceRange(min: number | null, max: number | null): string {
  if (min == null && max == null) return "—";
  const lo = toNum(min);
  const hi = toNum(max);
  if (lo === hi) return formatCurrency(lo);
  return `${formatCurrency(lo)} – ${formatCurrency(hi)}`;
}

export function formatSellingRange(row: ProductRow): string {
  return formatPriceRange(row.minSellingPrice, row.maxSellingPrice);
}

export function formatMrpRange(row: ProductRow): string {
  return formatPriceRange(row.minMrp, row.maxMrp);
}

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  IN_STOCK: "In Stock",
  LOW_STOCK: "Low Stock",
  OUT_OF_STOCK: "Out of Stock",
};

export const STOCK_STATUS_BADGE: Record<
  StockStatus,
  "success" | "warning" | "destructive"
> = {
  IN_STOCK: "success",
  LOW_STOCK: "warning",
  OUT_OF_STOCK: "destructive",
};

/** Margin as a rounded percentage string, or "—" when unavailable. */
export function formatMargin(margin: number | null | undefined): string {
  if (margin == null) return "—";
  return `${margin.toFixed(1)}%`;
}
