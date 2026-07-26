import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { X } from "lucide-react";
import type { FilterOption, ProductFilterState, SortOption, StockStatus } from "../types";

/**
 * ProductFilters — the full filter/sort bar shared by both modules. The parent
 * owns the filter state (usually in the URL) and passes a patch handler. The
 * `showStatusFilter` flag hides the Active/Inactive filter for managers, who
 * only ever see the live catalog — everything else is identical.
 */

const STOCK_OPTIONS: { value: StockStatus | ""; label: string }[] = [
  { value: "", label: "All stock" },
  { value: "IN_STOCK", label: "In stock" },
  { value: "LOW_STOCK", label: "Low stock" },
  { value: "OUT_OF_STOCK", label: "Out of stock" },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "name", label: "Alphabetical" },
  { value: "priceHigh", label: "Highest price" },
  { value: "priceLow", label: "Lowest price" },
  { value: "stockHigh", label: "Highest stock" },
  { value: "stockLow", label: "Lowest stock" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "true", label: "Active" },
  { value: "false", label: "Archived" },
];

export function ProductFilters({
  filters,
  onChange,
  onReset,
  categories,
  brands,
  showStatusFilter = false,
  hasActiveFilters = false,
}: {
  filters: ProductFilterState;
  onChange: (patch: Partial<ProductFilterState>) => void;
  onReset: () => void;
  categories: FilterOption[];
  brands: FilterOption[];
  showStatusFilter?: boolean;
  hasActiveFilters?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-40">
        <Select
          label="Category"
          options={[{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
          value={filters.categoryId}
          onChange={(e) => onChange({ categoryId: e.target.value })}
        />
      </div>

      <div className="w-40">
        <Select
          label="Brand"
          options={[{ value: "", label: "All brands" }, ...brands.map((b) => ({ value: b.id, label: b.name }))]}
          value={filters.brandId}
          onChange={(e) => onChange({ brandId: e.target.value })}
        />
      </div>

      <div className="w-36">
        <Select
          label="Stock"
          options={STOCK_OPTIONS}
          value={filters.stockStatus}
          onChange={(e) => onChange({ stockStatus: e.target.value as StockStatus | "" })}
        />
      </div>

      {showStatusFilter && (
        <div className="w-36">
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={filters.isActive}
            onChange={(e) => onChange({ isActive: e.target.value as ProductFilterState["isActive"] })}
          />
        </div>
      )}

      <div className="w-28">
        <Input
          label="Min ₹"
          type="number"
          min={0}
          value={filters.minPrice}
          onChange={(e) => onChange({ minPrice: e.target.value })}
          placeholder="0"
        />
      </div>

      <div className="w-28">
        <Input
          label="Max ₹"
          type="number"
          min={0}
          value={filters.maxPrice}
          onChange={(e) => onChange({ maxPrice: e.target.value })}
          placeholder="∞"
        />
      </div>

      <div className="w-40">
        <Select
          label="Sort by"
          options={SORT_OPTIONS}
          value={filters.sortBy}
          onChange={(e) => onChange({ sortBy: e.target.value as SortOption })}
        />
      </div>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onReset} leftIcon={<X className="h-4 w-4" />}>
          Clear
        </Button>
      )}
    </div>
  );
}
