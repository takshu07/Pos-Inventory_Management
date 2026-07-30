import { FilterX } from "lucide-react";
import { Button, Select } from "@/components/ui";
import {
  CATEGORY_SORT_LABELS,
  type CategoryFilterState,
  type CategorySortOption,
  type CategoryStatus,
} from "../types";

/**
 * CategoryFilters — status / product-presence / date / sort controls.
 *
 * Permission-agnostic: it renders whatever filter set it is given and reports
 * changes upward. Both modules use the identical filter surface — filtering is
 * a read concern, and managers have full read access.
 */
export function CategoryFilters({
  filters,
  onChange,
  onReset,
  hasActiveFilters,
  showArchivedToggle = true,
}: {
  filters: CategoryFilterState;
  onChange: (patch: Partial<CategoryFilterState>) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
  showArchivedToggle?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Status">
        <Select
          value={filters.status}
          onChange={(e) =>
            onChange({ status: e.target.value as CategoryStatus | "" })
          }
          options={[
            { value: "", label: "All statuses" },
            { value: "ACTIVE", label: "Active" },
            { value: "INACTIVE", label: "Inactive" },
            { value: "ARCHIVED", label: "Archived" },
          ]}
        />
      </Field>

      <Field label="Products">
        <Select
          value={filters.hasProducts}
          onChange={(e) =>
            onChange({ hasProducts: e.target.value as "" | "true" | "false" })
          }
          options={[
            { value: "", label: "Any" },
            { value: "true", label: "Has products" },
            { value: "false", label: "Empty categories" },
          ]}
        />
      </Field>

      <Field label="Created from">
        <input
          type="date"
          value={filters.createdFrom}
          max={filters.createdTo || undefined}
          onChange={(e) => onChange({ createdFrom: e.target.value })}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </Field>

      <Field label="Created to">
        <input
          type="date"
          value={filters.createdTo}
          min={filters.createdFrom || undefined}
          onChange={(e) => onChange({ createdTo: e.target.value })}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </Field>

      <Field label="Sort by">
        <Select
          value={filters.sortBy}
          onChange={(e) => onChange({ sortBy: e.target.value as CategorySortOption })}
          options={(Object.keys(CATEGORY_SORT_LABELS) as CategorySortOption[]).map((key) => ({
            value: key,
            label: CATEGORY_SORT_LABELS[key],
          }))}
        />
      </Field>

      {showArchivedToggle && (
        <label className="flex h-10 cursor-pointer select-none items-center gap-2 rounded-md border border-border px-3 text-sm">
          <input
            type="checkbox"
            checked={filters.includeArchived === "true"}
            onChange={(e) => onChange({ includeArchived: e.target.checked ? "true" : "" })}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          Include archived
        </label>
      )}

      {hasActiveFilters && (
        <Button variant="ghost" onClick={onReset} className="h-10 gap-1.5">
          <FilterX className="h-4 w-4" />
          Clear
        </Button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
