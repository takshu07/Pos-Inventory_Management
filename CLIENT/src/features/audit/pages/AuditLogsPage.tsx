/**
 * Audit Logs — /admin/audit-logs.
 *
 * The system's record of who did what: every create, update and delete across
 * every module, plus logins, cash movements, role changes and exports.
 *
 * RBAC: OWNER-only. `OwnerRoute` guards the route, and every endpoint behind it
 * independently 403s for anyone else. The guard is the boundary — nav hiding is
 * not. There is deliberately no manager view: the trail spans finance, salary
 * and privilege changes, and it records the manager's own actions.
 *
 * READ-ONLY. Nothing on this screen writes, and the API exposes no way to. An
 * audit trail the application can edit is not evidence of anything.
 *
 * PERFORMANCE POSTURE (this is the largest table in the system)
 * ------------------------------------------------------------
 *   • Defaults to the last 30 days, not all time, so the first request is not
 *     the most expensive one the screen can make.
 *   • The list never fetches the JSON snapshots — only the detail drawer does,
 *     for the single entry someone opened.
 *   • Search is debounced, and totals past the server's cap render as "10,000+"
 *     rather than paying for an exact count nobody reads.
 */

import { useState } from "react";
import { ShieldAlert } from "lucide-react";

import { ErrorState, Pagination } from "@/components/ui";
import { AuditDetailDrawer } from "../components/AuditDetailDrawer";
import { AuditFilters, AuditSearch } from "../components/AuditFilters";
import {
  AuditCardSkeleton,
  AuditEmptyState,
  AuditTableSkeleton,
} from "../components/AuditStates";
import { AuditSummaryStrip } from "../components/AuditSummaryStrip";
import { AuditCardList, AuditTable } from "../components/AuditTable";
import {
  useAuditFilterOptions,
  useAuditLogs,
  useAuditSummary,
} from "../hooks/useAudit";
import { useAuditFilters } from "../hooks/useAuditFilters";
import type { AuditLogEntry } from "../types";
import { formatTotal } from "../utils/format";

export function AuditLogsPage() {
  const {
    filters,
    setFilters,
    toggleValue,
    page,
    setPage,
    reset,
    hasActiveFilters,
    activeFilterCount,
    serverParams,
    isSearching,
  } = useAuditFilters("audit", 25);

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const query = useAuditLogs(serverParams);
  const summary = useAuditSummary(serverParams);
  const options = useAuditFilterOptions();

  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  // Only the very first load shows skeletons. Paging and filtering keep the
  // previous rows on screen (placeholderData), so the table does not flash.
  const showSkeleton = query.isLoading && rows.length === 0;

  return (
    <div className="flex flex-col gap-5 p-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ShieldAlert className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            Audit Logs
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every recorded change across the system — who did it, when, and what
            it affected.
          </p>
        </div>

        {meta && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            <span className="font-semibold text-foreground tabular-nums">
              {formatTotal(meta.total, meta.totalIsExact)}
            </span>{" "}
            {meta.total === 1 ? "entry" : "entries"}
          </p>
        )}
      </div>

      {/* ── Severity totals, under the active filters ──────────────────── */}
      <AuditSummaryStrip
        summary={summary.data}
        isLoading={summary.isLoading}
        activeSeverities={filters.severity}
        onToggleSeverity={(severity) => toggleValue("severity", severity)}
      />

      {/* ── Search + filters ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <AuditSearch
          value={filters.search}
          onChange={(value) => setFilters({ search: value })}
          isSearching={isSearching}
        />

        <AuditFilters
          filters={filters}
          options={options.data}
          activeFilterCount={activeFilterCount}
          onChange={setFilters}
          onToggle={toggleValue}
          onReset={reset}
        />
      </div>

      {/* ── Results ────────────────────────────────────────────────────── */}
      {query.isError ? (
        <ErrorState
          title="Could not load the audit trail"
          message={
            query.error instanceof Error
              ? query.error.message
              : "Something went wrong."
          }
          onRetry={() => void query.refetch()}
        />
      ) : showSkeleton ? (
        <>
          <AuditTableSkeleton />
          <AuditCardSkeleton />
        </>
      ) : rows.length === 0 ? (
        <AuditEmptyState
          hasFilters={hasActiveFilters}
          isDefaultPeriod={!hasActiveFilters && filters.period === "month"}
          onClear={reset}
          onWidenPeriod={() => setFilters({ period: "all" })}
        />
      ) : (
        <>
          <AuditTable
            rows={rows}
            onSelect={(entry) => setSelectedId(entry.id)}
            selectedId={selectedId}
          />
          <AuditCardList rows={rows} onSelect={(entry) => setSelectedId(entry.id)} />

          {totalPages > 1 && (
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          )}

          {/* When the count is capped, `totalPages` understates the truth —
              say so rather than letting the pager imply a hard end. */}
          {meta && !meta.totalIsExact && (
            <p className="text-center text-xs text-muted-foreground">
              Showing the most recent {meta.total.toLocaleString()} matching
              entries. Narrow the date range or add a filter to reach older
              activity.
            </p>
          )}
        </>
      )}

      {/* ── Detail ─────────────────────────────────────────────────────── */}
      <AuditDetailDrawer
        entryId={selectedId}
        onClose={() => setSelectedId(undefined)}
        // Following a related entry swaps the drawer's subject in place, so an
        // investigation can walk a record's history without losing the list.
        onSelectRelated={(entry: AuditLogEntry) => setSelectedId(entry.id)}
      />
    </div>
  );
}
