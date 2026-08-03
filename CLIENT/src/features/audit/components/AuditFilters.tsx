/**
 * Audit Logs — filter bar.
 *
 * Severity, module and action are MULTI-select: "show me deletions and role
 * changes" is one question, not two searches. They render as toggle chips
 * rather than multi-selects because the applied set has to stay visible — a
 * collapsed control that hides which filters are on is how someone
 * misreads an empty result as "nothing happened".
 *
 * Everything writes through `useAuditFilters`, so every control is URL-backed
 * and the whole view stays shareable.
 */

import { CalendarRange, Filter, X } from "lucide-react";

import { Badge, Button, Input, SearchBox, Select } from "@/components/ui";
import { cn } from "@/utils/cn";
import type { AuditFilterState } from "../hooks/useAuditFilters";
import type { AuditFilterOptions, AuditPeriod, AuditSeverity } from "../types";
import { severityVariant } from "../utils/format";

const PERIOD_OPTIONS: Array<{ value: AuditPeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
  { value: "quarter", label: "Last 90 days" },
  { value: "year", label: "Last year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range…" },
];

export function AuditSearch({
  value,
  onChange,
  isSearching,
}: {
  value: string;
  onChange: (value: string) => void;
  isSearching: boolean;
}) {
  return (
    <SearchBox
      value={value}
      // SearchBox hands the STRING, not the change event — it already unwraps
      // `e.target.value` internally. Treating it as an event read
      // `undefined.target`, so every keystroke cleared the query instead of
      // setting it and audit search returned the unfiltered list. Fixed
      // 2026-08-03; asserted by the "passes the raw string through" test.
      onChange={onChange}
      // Says what search actually covers. It does NOT search inside the change
      // snapshots — see the note in the server's validation module — and
      // implying otherwise would make people trust an empty result.
      placeholder="Search by person or affected record ID…"
      // `loading` is the prop SearchBox actually accepts; it renders the
      // spinner. `aria-busy` was being dropped silently — SearchBox does not
      // spread unknown props onto the input.
      loading={isSearching}
    />
  );
}

/** A toggleable filter chip. Pressed state is conveyed to assistive tech too. */
function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

export function AuditFilters({
  filters,
  options,
  activeFilterCount,
  onChange,
  onToggle,
  onReset,
}: {
  filters: AuditFilterState;
  options: AuditFilterOptions | undefined;
  activeFilterCount: number;
  onChange: (patch: Partial<AuditFilterState>) => void;
  onToggle: (key: "module" | "action" | "severity", value: string) => void;
  onReset: () => void;
}) {
  const severities = options?.severities ?? [];
  const modules = options?.modules ?? [];
  const actors = options?.actors ?? [];
  const entities = options?.entities ?? [];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      {/* Row 1 — severity, the filter this screen exists for. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />
          Severity
        </span>

        {severities.map((option) => {
          const active = filters.severity.includes(option.value);
          return (
            <Chip
              key={option.value}
              active={active}
              onClick={() => onToggle("severity", option.value)}
            >
              <span className="flex items-center gap-1.5">
                {!active && (
                  <Badge
                    variant={severityVariant(option.value as AuditSeverity)}
                    className="h-1.5 w-1.5 rounded-full p-0"
                    aria-hidden="true"
                  />
                )}
                {option.label}
              </span>
            </Chip>
          );
        })}

        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="ml-auto h-7 text-xs"
          >
            <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Clear {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}
          </Button>
        )}
      </div>

      {/* Row 2 — the dropdown filters. */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          aria-label="Filter by time period"
          value={filters.period}
          onChange={(e) => onChange({ period: e.target.value as AuditPeriod })}
          options={PERIOD_OPTIONS}
        />

        <Select
          aria-label="Filter by person"
          value={filters.employeeId}
          onChange={(e) => onChange({ employeeId: e.target.value })}
          placeholder="Anyone"
          options={actors.map((actor) => ({
            value: actor.value,
            // The count tells the reader who is actually active in the trail,
            // which is genuinely useful when picking whom to investigate.
            label: `${actor.label} (${actor.count.toLocaleString()})`,
          }))}
        />

        <Select
          aria-label="Filter by affected entity type"
          value={filters.tableName}
          onChange={(e) => onChange({ tableName: e.target.value })}
          placeholder="Any entity"
          options={entities}
        />

        <Select
          aria-label="Sort entries"
          value={`${filters.sortBy}:${filters.sortOrder}`}
          onChange={(e) => {
            const [sortBy, sortOrder] = e.target.value.split(":");
            onChange({
              sortBy: sortBy as AuditFilterState["sortBy"],
              sortOrder: sortOrder as "asc" | "desc",
            });
          }}
          options={[
            { value: "createdAt:desc", label: "Newest first" },
            { value: "createdAt:asc", label: "Oldest first" },
            { value: "severity:desc", label: "Most severe first" },
          ]}
        />
      </div>

      {/* Custom range — only when the period calls for it. */}
      {filters.period === "custom" && (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-muted/40 p-2">
          <CalendarRange
            className="mb-2 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="flex-1 min-w-[10rem]">
            <Input
              type="date"
              label="From"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => onChange({ from: e.target.value })}
            />
          </div>
          <div className="flex-1 min-w-[10rem]">
            <Input
              type="date"
              label="To"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => onChange({ to: e.target.value })}
            />
          </div>
          {(!filters.from || !filters.to) && (
            // The server rejects a custom period without both ends, so say so
            // here rather than letting the request 400.
            <p className="w-full text-xs text-muted-foreground">
              Pick both dates to apply a custom range.
            </p>
          )}
        </div>
      )}

      {/* Row 3 — modules. Collapsed to a scroll strip; there are 24 of them. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Module</span>
        {modules.map((option) => (
          <Chip
            key={option.value}
            active={filters.module.includes(option.value)}
            onClick={() => onToggle("module", option.value)}
          >
            {option.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}
