/**
 * Employee Activity — the module's live operations dashboard.
 *
 * This is the route managers already have in their nav (/admin/employees), so
 * it opens on the questions asked first: who is on, what have they produced
 * today, and what is happening right now. Three bands, in that order:
 *
 *   1. Presence strip  — who is here (clickable; each card filters the roster).
 *   2. Operations strip — what today has produced.
 *   3. Live feed       — what is happening, severity-coded.
 *
 * Everything is read from records the other modules already write. This module
 * adds no tracking of its own; it is a reader of the existing audit trail.
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, RotateCcw } from "lucide-react";

import { Button, Card, ErrorState, Pagination, Select } from "@/components/ui";
import { useDebounce } from "@/hooks/useDebounce";
import { EmployeeDrawer } from "../components/EmployeeDrawer";
import { EmployeeSearch } from "../components/EmployeeFilters";
import { ExportMenu } from "../components/ExportMenu";
import { LiveActivityFeed } from "../components/LiveActivityFeed";
import {
  WorkforceOperationsCards,
  WorkforceSummaryCards,
} from "../components/WorkforceStatCards";
import { useActivity, useRoster, useWorkforceSummary } from "../hooks/useWorkforce";
import { ACTIVITY_TYPE_OPTIONS } from "../utils/format";
import type { ActivitySeverity, WorkforceEmployee } from "../types";

const PAGE_SIZE = 30;

const MODULE_OPTIONS = [
  { value: "", label: "All modules" },
  { value: "AUTH", label: "Authentication" },
  { value: "SALE", label: "Sales" },
  { value: "INVENTORY", label: "Inventory" },
  { value: "CUSTOMER", label: "Customers" },
  { value: "PRODUCT", label: "Products" },
  { value: "CATEGORY", label: "Categories" },
  { value: "PURCHASE", label: "Purchases" },
  { value: "LABEL", label: "Labels" },
  { value: "EMPLOYEE", label: "Workforce" },
];

const SEVERITY_OPTIONS = [
  { value: "", label: "Any severity" },
  { value: "CRITICAL", label: "Critical only" },
  { value: "WARNING", label: "Warning & above" },
  { value: "NORMAL", label: "Normal only" },
];

const ROLE_OPTIONS = [
  { value: "", label: "All roles" },
  { value: "OWNER", label: "Owner" },
  { value: "MANAGER", label: "Managers" },
  { value: "CASHIER", label: "Cashiers" },
];

export default function ActivityPage() {
  const navigate = useNavigate();

  const [actionType, setActionType] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [severity, setSeverity] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [drawerFor, setDrawerFor] = useState<WorkforceEmployee | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  const summary = useWorkforceSummary();

  // The employee dropdown is fed by the roster, so it lists real people rather
  // than asking the user to type an id.
  const roster = useRoster("staff", { page: 1, limit: 200 });

  const activity = useActivity({
    page,
    limit: PAGE_SIZE,
    ...(actionType ? { actionType } : {}),
    ...(moduleFilter ? { module: moduleFilter } : {}),
    ...(employeeFilter ? { employeeId: employeeFilter } : {}),
  });

  const rows = activity.data?.data ?? [];
  const totalPages = activity.data?.totalPages ?? 1;

  /**
   * Severity, role and name narrow the LOADED PAGE only.
   *
   * All three are derived server-side per row rather than being SQL-filterable
   * columns, so filtering here is honest: it refines what you can see rather
   * than implying a search across the whole history. Employee, module and
   * action DO go to the server, which is why they are separate above.
   */
  const visible = rows.filter((row) => {
    if (severity === "CRITICAL" && row.severity !== "CRITICAL") return false;
    if (severity === "WARNING" && row.severity === "NORMAL") return false;
    if (severity === "NORMAL" && row.severity !== "NORMAL") return false;
    if (roleFilter && row.employee?.role !== roleFilter) return false;
    if (
      debouncedSearch &&
      !row.employee?.fullName.toLowerCase().includes(debouncedSearch.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const hasFilters = Boolean(
    actionType || moduleFilter || severity || roleFilter || employeeFilter || search
  );

  const resetFilters = () => {
    setActionType("");
    setModuleFilter("");
    setSeverity("");
    setRoleFilter("");
    setEmployeeFilter("");
    setSearch("");
    setPage(1);
  };

  const employeeOptions = [
    { value: "", label: "All employees" },
    ...(roster.data?.data ?? []).map((e) => ({ value: e.id, label: e.fullName })),
  ];

  /** Opens the shared drawer from a feed row. */
  const openEmployee = (employeeId: string) => {
    const match = (roster.data?.data ?? []).find((e) => e.id === employeeId);
    if (match) setDrawerFor(match);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Employee Activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who is working right now, what today has produced, and everything happening
            across the shop.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/admin/attendance")}>
            Attendance
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/admin/performance")}>
            Performance
          </Button>
          <Button
            size="sm"
            onClick={() => navigate("/admin/staff")}
            rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
          >
            View Roster
          </Button>
        </div>
      </div>

      {/* Band 1 — who is here. Cards are filters, not just numbers. */}
      <WorkforceSummaryCards
        data={summary.data}
        isLoading={summary.isLoading}
        onSelect={(filter) => {
          // The `staff_` prefix matches useWorkforceFilters("staff") on the
          // roster page, so the filter arrives already applied.
          const params = new URLSearchParams();
          if (filter.role) params.set("staff_role", filter.role);
          if (filter.presence) params.set("staff_presence", filter.presence);
          if (filter.attendance) params.set("staff_attendance", filter.attendance);
          const query = params.toString();
          navigate(query ? `/admin/staff?${query}` : "/admin/staff");
        }}
      />

      {/* Band 2 — what today produced. */}
      <WorkforceOperationsCards data={summary.data} isLoading={summary.isLoading} />

      {/* Band 3 — the live feed. */}
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Live Activity</h2>
            <p className="text-xs text-muted-foreground">
              Every action across the app, newest first.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
              >
                Reset
              </Button>
            )}

            {/* Only the SERVER-side filters go to the export. Severity, role and
                name narrow the loaded page client-side, so sending them would
                promise a filtered file the server cannot actually produce. */}
            <ExportMenu
              report="activity"
              filters={{
                ...(actionType ? { actionType } : {}),
                ...(moduleFilter ? { module: moduleFilter } : {}),
                ...(employeeFilter ? { employeeId: employeeFilter } : {}),
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <EmployeeSearch
            value={search}
            onChange={setSearch}
            loading={search !== debouncedSearch}
            placeholder="Filter this feed by employee name…"
          />

          <div className="flex flex-wrap items-end gap-2">
            <Select
              className="w-auto min-w-[11rem]"
              options={employeeOptions}
              value={employeeFilter}
              onChange={(e) => {
                setEmployeeFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by employee"
            />
            <Select
              className="w-auto min-w-[10rem]"
              options={MODULE_OPTIONS}
              value={moduleFilter}
              onChange={(e) => {
                setModuleFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by module"
            />
            <Select
              className="w-auto min-w-[11rem]"
              options={ACTIVITY_TYPE_OPTIONS}
              value={actionType}
              onChange={(e) => {
                setActionType(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by action"
            />
            <Select
              className="w-auto min-w-[10rem]"
              options={SEVERITY_OPTIONS}
              value={severity}
              onChange={(e) => setSeverity(e.target.value as ActivitySeverity | "")}
              aria-label="Filter by severity"
            />
            <Select
              className="w-auto min-w-[9rem]"
              options={ROLE_OPTIONS}
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              aria-label="Filter by role"
            />
          </div>
        </div>

        {activity.isError ? (
          <ErrorState message="Failed to load activity." onRetry={() => activity.refetch()} />
        ) : !activity.isLoading && visible.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {hasFilters
              ? "Nothing on this page matches these filters."
              : "No activity recorded yet."}
          </div>
        ) : (
          <LiveActivityFeed
            rows={visible}
            isLoading={activity.isLoading}
            onEmployeeClick={openEmployee}
            onRecordClick={(path) => navigate(path)}
          />
        )}

        {totalPages > 1 && (
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        )}
      </Card>

      {/* The same drawer the roster uses — one component, reused. */}
      <EmployeeDrawer
        employee={drawerFor}
        open={Boolean(drawerFor)}
        onClose={() => setDrawerFor(null)}
      />
    </div>
  );
}
