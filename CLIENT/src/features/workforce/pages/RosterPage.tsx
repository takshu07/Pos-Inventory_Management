/**
 * The roster page, shared by /admin/managers and /admin/employees.
 *
 * ONE component, two configurations. The Managers and Employees screens differ
 * in which endpoint they hit, which columns they show and what they call the
 * people in them — not in how they behave. Filtering, paging, the responsive
 * card fallback and the drawer are identical, so they are written once. Two
 * copies of this page would drift within a month.
 *
 * The layout switches between the table and the card list at the `lg`
 * breakpoint rather than hiding columns: an 11-column table below ~900px is
 * unusable, and a horizontally scrolling table is worse than a card.
 */

import { useState } from "react";

import { ErrorState, Pagination } from "@/components/ui";
import { canManageEmployees } from "@/features/auth";
import { useAuthStore } from "@/store/auth.store";
import { EmployeeCard } from "../components/EmployeeCard";
import { EmployeeDrawer } from "../components/EmployeeDrawer";
import { EmployeeEditDrawer } from "../components/EmployeeEditDrawer";
import { ResetPasswordDialog } from "../components/ResetPasswordDialog";
import {
  applyDerivedFilters,
  EmployeeFilters,
  EmployeeSearch,
} from "../components/EmployeeFilters";
import { EmployeeCardSkeleton, EmployeeEmptyState } from "../components/EmployeeSkeleton";
import { EmployeeTable } from "../components/EmployeeTable";
import { RosterStatCards } from "../components/WorkforceStatCards";
import {
  useManagerStats,
  useRoster,
  useShifts,
  useStaffStats,
} from "../hooks/useWorkforce";
import { useWorkforceFilters } from "../hooks/useWorkforceFilters";
import type { WorkforceEmployee } from "../types";

export type RosterVariant = "managers" | "staff";

const COPY: Record<
  RosterVariant,
  { title: string; subtitle: string; labelPrefix: string; entity: string }
> = {
  managers: {
    title: "Managers",
    subtitle:
      "Every manager account, with today's presence, attendance and sales at a glance.",
    labelPrefix: "Managers",
    entity: "managers",
  },
  staff: {
    title: "Employees",
    subtitle:
      "The full staff roster — presence, shift, attendance and today's sales for each employee.",
    labelPrefix: "Employees",
    entity: "employees",
  },
};

export function RosterPage({ variant }: { variant: RosterVariant }) {
  const copy = COPY[variant];

  // The URL prefix namespaces this page's query params, so navigating between
  // the two rosters never carries one's ?page onto the other.
  const {
    filters,
    setFilters,
    page,
    limit,
    setPage,
    reset,
    hasActiveFilters,
    serverParams,
    isSearching,
  } = useWorkforceFilters(variant, 20);

  const role = useAuthStore((s) => s.user?.role ?? null);
  const canManage = canManageEmployees(role);

  const [selected, setSelected] = useState<WorkforceEmployee | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<WorkforceEmployee | null>(null);
  const [resetting, setResetting] = useState<WorkforceEmployee | null>(null);

  const { data: shifts } = useShifts();

  const query = useRoster(variant, serverParams);

  // Both stat hooks are called unconditionally to keep hook order stable; only
  // the matching one is read. They are cheap COUNT queries sharing one cache
  // entry each, so the second is effectively free.
  const managerStats = useManagerStats();
  const staffStats = useStaffStats();
  const stats = variant === "managers" ? managerStats : staffStats;

  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // presence/attendance are derived columns the server cannot filter on, so
  // they narrow the loaded page here. See applyDerivedFilters.
  const visible = applyDerivedFilters(rows, filters);

  const openDrawer = (employee: WorkforceEmployee) => {
    setSelected(employee);
    setDrawerOpen(true);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
      </div>

      <RosterStatCards
        data={stats.data}
        isLoading={stats.isLoading}
        labelPrefix={copy.labelPrefix}
      />

      <div className="flex flex-col gap-3">
        <EmployeeSearch
          value={filters.search}
          onChange={(v) => setFilters({ search: v })}
          loading={isSearching || query.isFetching}
        />
        <EmployeeFilters
          filters={filters}
          onChange={setFilters}
          onReset={reset}
          hasActiveFilters={hasActiveFilters}
          shifts={shifts ?? []}
          // The Managers roster is already scoped to one role by its endpoint;
          // a role filter there would be a control that does nothing.
          showRoleFilter={variant === "staff"}
        />
      </div>

      {query.isError ? (
        <ErrorState
          message={`Failed to load ${copy.entity}.`}
          onRetry={() => query.refetch()}
        />
      ) : query.isLoading ? (
        <>
          <div className="hidden lg:block">
            <EmployeeTable rows={[]} variant={variant} isLoading onRowClick={openDrawer} />
          </div>
          <div className="lg:hidden">
            <EmployeeCardSkeleton />
          </div>
        </>
      ) : visible.length === 0 ? (
        <EmployeeEmptyState
          hasFilters={hasActiveFilters}
          onClear={reset}
          entity={copy.entity}
        />
      ) : (
        <>
          <div className="hidden lg:block">
            <EmployeeTable rows={visible} variant={variant} onRowClick={openDrawer} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {visible.map((employee) => (
              <EmployeeCard key={employee.id} employee={employee} onClick={openDrawer} />
            ))}
          </div>
        </>
      )}

      {/* Paging reflects the SERVER total, not the derived-filtered count — the
          client filters narrow the current page, they don't change how many
          pages the query has. */}
      {total > 0 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}

      {/* Owner-only handlers. Passing them conditionally is what leaves a
          manager's drawer footer empty — and every one of these endpoints
          independently 403s for a manager regardless. */}
      <EmployeeDrawer
        employee={selected}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        {...(canManage
          ? {
              onEdit: (employee) => {
                setDrawerOpen(false);
                setEditing(employee);
              },
              onResetPassword: (employee) => {
                setDrawerOpen(false);
                setResetting(employee);
              },
            }
          : {})}
      />

      <EmployeeEditDrawer
        employee={editing}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
      />

      <ResetPasswordDialog
        employee={resetting}
        open={Boolean(resetting)}
        onClose={() => setResetting(null)}
      />
    </div>
  );
}

export default RosterPage;
