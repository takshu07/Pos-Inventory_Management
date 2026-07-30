/**
 * Search + filter bar for the workforce tables.
 *
 * Search covers name, phone, email and employee code in one box rather than
 * offering four fields: a manager looking for someone types whatever they
 * remember, and the server's OR-match handles the rest.
 *
 * Filters are split by where they are evaluated, and the split is visible in
 * the code so nobody moves one to the wrong side:
 *   • role / status / shift / joined-date → sent to the server.
 *   • presence / attendance → applied client-side over the loaded page, because
 *     both are derived at read time and are not SQL-filterable columns.
 */

import { RotateCcw } from "lucide-react";

import { Button, SearchBox, Select } from "@/components/ui";
import { cn } from "@/utils/cn";
import type { Shift } from "../types";
import type { WorkforceFilterState } from "../hooks/useWorkforceFilters";
import { formatShiftWindow } from "../utils/format";

export function EmployeeSearch({
  value,
  onChange,
  loading,
  placeholder = "Search by name, phone, email or employee ID…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  loading?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <SearchBox
      className={cn("max-w-md", className)}
      value={value}
      onChange={onChange}
      {...(loading !== undefined ? { loading } : {})}
      placeholder={placeholder}
    />
  );
}

const ROLE_OPTIONS = [
  { value: "", label: "All roles" },
  { value: "MANAGER", label: "Manager" },
  { value: "CASHIER", label: "Cashier" },
];

const ACTIVE_OPTIONS = [
  { value: "", label: "Any account" },
  { value: "true", label: "Active" },
  { value: "false", label: "Deactivated" },
];

const EMPLOYMENT_OPTIONS = [
  { value: "", label: "Any employment" },
  { value: "ACTIVE", label: "Active" },
  { value: "PROBATION", label: "Probation" },
  { value: "ON_LEAVE", label: "On Leave" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "TERMINATED", label: "Terminated" },
];

const PRESENCE_OPTIONS = [
  { value: "", label: "Any presence" },
  { value: "ONLINE", label: "Online" },
  { value: "OFFLINE", label: "Offline" },
];

const ATTENDANCE_OPTIONS = [
  { value: "", label: "Any attendance" },
  { value: "PRESENT", label: "Present" },
  { value: "LATE", label: "Late" },
  { value: "HALF_DAY", label: "Half Day" },
  { value: "ABSENT", label: "Absent" },
  { value: "ON_LEAVE", label: "On Leave" },
];

const SORT_OPTIONS = [
  { value: "firstName", label: "Name (A–Z)" },
  { value: "createdAt", label: "Newest first" },
  { value: "joiningDate", label: "Joining date" },
  { value: "lastLogin", label: "Last login" },
  { value: "todayRevenue", label: "Highest revenue" },
  { value: "todayTransactions", label: "Most transactions" },
  { value: "attendancePercentage", label: "Attendance %" },
];

export function EmployeeFilters({
  filters,
  onChange,
  onReset,
  hasActiveFilters,
  shifts,
  showRoleFilter = true,
}: {
  filters: WorkforceFilterState;
  onChange: (patch: Partial<WorkforceFilterState>) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
  shifts: Shift[];
  /** Hidden on the Managers tab, where the role is already fixed by the tab. */
  showRoleFilter?: boolean;
}) {
  const shiftOptions = [
    { value: "", label: "All shifts" },
    ...shifts.map((s) => ({
      value: s.id,
      label: `${s.name} (${formatShiftWindow(s.startMinute, s.endMinute)})`,
    })),
  ];

  return (
    <div className="flex flex-wrap items-end gap-2">
      {showRoleFilter && (
        <Select
          className="w-auto min-w-[9rem]"
          options={ROLE_OPTIONS}
          value={filters.role}
          onChange={(e) => onChange({ role: e.target.value })}
          aria-label="Filter by role"
        />
      )}

      <Select
        className="w-auto min-w-[9rem]"
        options={PRESENCE_OPTIONS}
        value={filters.presence}
        onChange={(e) => onChange({ presence: e.target.value })}
        aria-label="Filter by presence"
      />

      <Select
        className="w-auto min-w-[10rem]"
        options={ATTENDANCE_OPTIONS}
        value={filters.attendance}
        onChange={(e) => onChange({ attendance: e.target.value })}
        aria-label="Filter by today's attendance"
      />

      <Select
        className="w-auto min-w-[10rem]"
        options={shiftOptions}
        value={filters.shiftId}
        onChange={(e) => onChange({ shiftId: e.target.value })}
        aria-label="Filter by shift"
      />

      <Select
        className="w-auto min-w-[10rem]"
        options={EMPLOYMENT_OPTIONS}
        value={filters.employmentStatus}
        onChange={(e) => onChange({ employmentStatus: e.target.value })}
        aria-label="Filter by employment status"
      />

      <Select
        className="w-auto min-w-[9rem]"
        options={ACTIVE_OPTIONS}
        value={filters.isActive}
        onChange={(e) => onChange({ isActive: e.target.value })}
        aria-label="Filter by account state"
      />

      <Select
        className="w-auto min-w-[11rem]"
        options={SORT_OPTIONS}
        value={filters.sortBy}
        onChange={(e) => {
          // Ranking sorts are only meaningful highest-first; alphabetical is
          // only meaningful A–Z. Flipping direction with the field removes a
          // step the user would otherwise always have to take.
          const descByDefault = ["todayRevenue", "todayTransactions", "attendancePercentage", "createdAt", "lastLogin"];
          onChange({
            sortBy: e.target.value,
            sortOrder: descByDefault.includes(e.target.value) ? "desc" : "asc",
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

/**
 * Client-side narrowing for the two derived columns the server cannot filter.
 *
 * Applied over the current page only, which is honest: it refines what you can
 * see rather than pretending to search the whole roster. Both filters are
 * exposed together so the behaviour is documented in one place.
 */
export function applyDerivedFilters<
  T extends { presence: string; attendanceStatus: string | null }
>(rows: T[], filters: Pick<WorkforceFilterState, "presence" | "attendance">): T[] {
  let out = rows;

  if (filters.presence) {
    out = out.filter((r) => r.presence === filters.presence);
  }

  if (filters.attendance) {
    out = out.filter((r) => r.attendanceStatus === filters.attendance);
  }

  return out;
}
