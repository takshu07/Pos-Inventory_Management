/**
 * Search + filter bar for the inventory tables.
 *
 * THE SCANNER BEHAVIOUR is the part worth explaining. A hardware barcode
 * scanner is a keyboard that types very fast and presses Enter. So:
 *
 *   • Typing filters the table as you go (debounced upstream).
 *   • Enter triggers an EXACT lookup and opens that product directly, because
 *     a scan is an unambiguous identification, not a search.
 *
 * That means the same box serves both a human typing "blue denim" and a
 * scanner firing a 13-digit EAN — without a mode toggle nobody would remember
 * to flip mid-shift.
 */

import { useRef } from "react";
import { RotateCcw, ScanLine } from "lucide-react";

import { Button, Input, Select } from "@/components/ui";
import { cn } from "@/utils/cn";
import type { InventoryFilterState } from "../hooks/useInventoryFilters";
import type { StockStatusFilter } from "../types";

const STATUS_OPTIONS: Array<{ value: StockStatusFilter; label: string }> = [
  { value: "ALL", label: "All stock" },
  { value: "IN_STOCK", label: "In stock" },
  { value: "LOW_STOCK", label: "Low stock" },
  { value: "OUT_OF_STOCK", label: "Out of stock" },
  { value: "NEGATIVE", label: "Negative stock" },
  { value: "OVERSTOCKED", label: "Overstocked" },
  { value: "RESERVED", label: "Has reservations" },
  { value: "FAST_MOVING", label: "Fast moving" },
  { value: "SLOW_MOVING", label: "Slow moving" },
  { value: "DEAD_STOCK", label: "Dead stock" },
];

const ACTIVE_OPTIONS = [
  { value: "", label: "Any state" },
  { value: "true", label: "Active only" },
  { value: "false", label: "Archived only" },
];

const SORT_OPTIONS = [
  { value: "updatedAt", label: "Recently updated" },
  { value: "sku", label: "SKU (A–Z)" },
  { value: "currentStock", label: "Stock level" },
  { value: "available", label: "Available" },
  { value: "stockValue", label: "Stock value" },
  { value: "unitsSold", label: "Units sold" },
  { value: "lastMovementAt", label: "Last movement" },
  { value: "sellingPrice", label: "Price" },
];

/** Sorts where the useful default is descending. */
const DESC_BY_DEFAULT = new Set([
  "updatedAt", "stockValue", "unitsSold", "lastMovementAt", "sellingPrice",
]);

export function StockSearch({
  value,
  onChange,
  onScan,
  loading,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Fired on Enter — an exact code lookup, not a filter. */
  onScan?: (code: string) => void;
  loading?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={cn("relative max-w-md", className)}>
      <ScanLine
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();

          const code = value.trim();
          if (!code || !onScan) return;

          onScan(code);
          // Clear so the next scan starts fresh — a scanner fires codes
          // back-to-back and would otherwise append to the previous one.
          onChange("");
          inputRef.current?.focus();
        }}
        placeholder="Search or scan a barcode…"
        className="pl-9"
        aria-label="Search inventory or scan a barcode"
      />
      {loading && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
          searching…
        </span>
      )}
    </div>
  );
}

export function StockFilters({
  filters,
  onChange,
  onReset,
  hasActiveFilters,
  categories,
  brands,
  suppliers,
  optionsLoading = false,
}: {
  filters: InventoryFilterState;
  onChange: (patch: Partial<InventoryFilterState>) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
  categories: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; businessName: string }>;
  /** True while the catalog lookups are in flight — see Select.loadingOptions. */
  optionsLoading?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select
        className="w-auto min-w-[10rem]"
        options={STATUS_OPTIONS}
        value={filters.status}
        onChange={(e) => onChange({ status: e.target.value as StockStatusFilter })}
        aria-label="Filter by stock status"
      />

      <Select
        className="w-auto min-w-[10rem]"
        options={[
          { value: "", label: "All categories" },
          ...categories.map((c) => ({ value: c.id, label: c.name })),
        ]}
        value={filters.categoryId}
        onChange={(e) => onChange({ categoryId: e.target.value })}
        aria-label="Filter by category"
        loadingOptions={optionsLoading}
      />

      <Select
        className="w-auto min-w-[9rem]"
        options={[
          { value: "", label: "All brands" },
          ...brands.map((b) => ({ value: b.id, label: b.name })),
        ]}
        value={filters.brandId}
        onChange={(e) => onChange({ brandId: e.target.value })}
        aria-label="Filter by brand"
        loadingOptions={optionsLoading}
      />

      <Select
        className="w-auto min-w-[10rem]"
        options={[
          { value: "", label: "All suppliers" },
          ...suppliers.map((s) => ({ value: s.id, label: s.businessName })),
        ]}
        value={filters.supplierId}
        onChange={(e) => onChange({ supplierId: e.target.value })}
        aria-label="Filter by supplier"
        loadingOptions={optionsLoading}
      />

      <Select
        className="w-auto min-w-[9rem]"
        options={ACTIVE_OPTIONS}
        value={filters.isActive}
        onChange={(e) => onChange({ isActive: e.target.value })}
        aria-label="Filter by catalogue state"
      />

      <Select
        className="w-auto min-w-[11rem]"
        options={SORT_OPTIONS}
        value={filters.sortBy}
        onChange={(e) => {
          // Flipping direction with the field removes a step the user would
          // otherwise always take: "stock value" is asked highest-first,
          // "SKU" alphabetically.
          onChange({
            sortBy: e.target.value,
            sortOrder: DESC_BY_DEFAULT.has(e.target.value) ? "desc" : "asc",
          });
        }}
        aria-label="Sort by"
      />

      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
        >
          Reset
        </Button>
      )}
    </div>
  );
}
