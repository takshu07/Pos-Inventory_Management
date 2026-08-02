/**
 * Search + filter controls for the Users & Roles table.
 *
 * Both filters are SERVER-side (the list endpoint accepts `role` and
 * `isActive`), so they narrow the whole result set rather than the current
 * page. That is why there is no client-side filtering pass here, unlike the
 * workforce roster which has derived columns the server cannot filter on.
 */

import { RotateCcw } from "lucide-react";

import { Button, SearchBox, Select } from "@/components/ui";
import { ROLE_LABELS } from "@/features/auth";
import type { UserFilterState } from "../hooks/useUserFilters";

const ROLE_OPTIONS = [
  { value: "", label: "All roles" },
  { value: "OWNER", label: ROLE_LABELS.OWNER },
  { value: "MANAGER", label: ROLE_LABELS.MANAGER },
  { value: "CASHIER", label: ROLE_LABELS.CASHIER },
];

/**
 * "All" is the default rather than "Active only".
 *
 * This is an audit surface: hiding deactivated accounts by default would hide
 * exactly the rows an owner reviewing access needs to see, and make a
 * deactivated user look deleted.
 */
const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "true", label: "Active" },
  { value: "false", label: "Deactivated" },
];

export function UserSearch({
  value,
  onChange,
  loading,
}: {
  value: string;
  onChange: (value: string) => void;
  loading?: boolean;
}) {
  return (
    <SearchBox
      value={value}
      onChange={onChange}
      loading={loading}
      placeholder="Search by name, employee code, email or phone…"
      className="w-full sm:max-w-md"
    />
  );
}

export function UserFilters({
  filters,
  onChange,
  onReset,
  hasActiveFilters,
}: {
  filters: UserFilterState;
  onChange: (patch: Partial<UserFilterState>) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-full sm:w-44">
        <Select
          label="Role"
          options={ROLE_OPTIONS}
          value={filters.role}
          onChange={(e) => onChange({ role: e.target.value })}
        />
      </div>

      <div className="w-full sm:w-44">
        <Select
          label="Status"
          options={STATUS_OPTIONS}
          value={filters.isActive}
          onChange={(e) => onChange({ isActive: e.target.value })}
        />
      </div>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onReset} className="mb-0.5">
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Clear filters
        </Button>
      )}
    </div>
  );
}
