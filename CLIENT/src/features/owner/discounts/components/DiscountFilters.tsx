import { X } from "lucide-react";
import { Button, Select } from "@/components/ui";
import type { DiscountFilterState } from "../hooks/useDiscountFilters";

const SCOPE_OPTIONS = [
  { value: "", label: "All scopes" },
  { value: "PRODUCT", label: "Product" },
  { value: "CATEGORY", label: "Category" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "EXPIRED", label: "Expired" },
  { value: "DISABLED", label: "Disabled" },
  { value: "DRAFT", label: "Draft" },
];

const SORT_OPTIONS = [
  { value: "createdAt", label: "Created" },
  { value: "updatedAt", label: "Last modified" },
  { value: "name", label: "Name" },
  { value: "value", label: "Value" },
  { value: "priority", label: "Priority" },
  { value: "startDate", label: "Start date" },
  { value: "endDate", label: "End date" },
];

const ORDER_OPTIONS = [
  { value: "desc", label: "Descending" },
  { value: "asc", label: "Ascending" },
];

export function DiscountFilters({
  filters,
  onChange,
  onReset,
  hasActiveFilters,
}: {
  filters: DiscountFilterState;
  onChange: (patch: Partial<DiscountFilterState>) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Select
        className="w-40"
        options={SCOPE_OPTIONS}
        value={filters.scope}
        onChange={(e) => onChange({ scope: e.target.value as DiscountFilterState["scope"] })}
        aria-label="Filter by scope"
      />
      <Select
        className="w-40"
        options={STATUS_OPTIONS}
        value={filters.status}
        onChange={(e) => onChange({ status: e.target.value as DiscountFilterState["status"] })}
        aria-label="Filter by status"
      />
      <Select
        className="w-44"
        options={SORT_OPTIONS}
        value={filters.sortBy}
        onChange={(e) => onChange({ sortBy: e.target.value as DiscountFilterState["sortBy"] })}
        aria-label="Sort by"
      />
      <Select
        className="w-40"
        options={ORDER_OPTIONS}
        value={filters.sortOrder}
        onChange={(e) => onChange({ sortOrder: e.target.value as DiscountFilterState["sortOrder"] })}
        aria-label="Sort order"
      />
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onReset} leftIcon={<X className="h-4 w-4" />}>
          Clear
        </Button>
      )}
    </div>
  );
}
