/**
 * Loading, empty and error states for the audit trail.
 *
 * The empty state distinguishes THREE situations, because they need different
 * offers and conflating them strands the reader:
 *   • filtered to nothing   → clear the filters
 *   • nothing in this period→ widen the range (the default IS a 30-day filter,
 *                             so this is the most common empty result by far)
 *   • genuinely no activity → nothing to do; explain rather than offer a button
 *
 * A single "No results" would leave someone staring at an empty screen on a
 * busy system, which is exactly when an audit trail must not look broken.
 */

import { FileClock, FilterX, CalendarSearch } from "lucide-react";

import { Card, EmptyState, Skeleton } from "@/components/ui";

/** Row skeletons for the table. Column widths mirror the real header. */
export function AuditTableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="hidden lg:block" aria-hidden="true">
      <div className="divide-y divide-border rounded-lg border border-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-40 flex-1" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Card skeletons for the sub-`lg` layout. */
export function AuditCardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 lg:hidden" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export function AuditEmptyState({
  hasFilters,
  isDefaultPeriod,
  onClear,
  onWidenPeriod,
}: {
  hasFilters: boolean;
  /** True when only the default 30-day window is narrowing the result. */
  isDefaultPeriod: boolean;
  onClear: () => void;
  onWidenPeriod: () => void;
}) {
  if (hasFilters) {
    return (
      <EmptyState
        icon={<FilterX className="h-8 w-8 text-muted-foreground" />}
        title="No activity matches these filters"
        description="Try a different module, action, severity or date range."
        action={{ label: "Clear filters", onClick: onClear }}
      />
    );
  }

  // No filters beyond the default window — the range is the likely culprit.
  if (isDefaultPeriod) {
    return (
      <EmptyState
        icon={<CalendarSearch className="h-8 w-8 text-muted-foreground" />}
        title="No activity in the last 30 days"
        description="The audit trail is showing a 30-day window by default. Widen it to look further back."
        action={{ label: "Show all time", onClick: onWidenPeriod }}
      />
    );
  }

  return (
    <EmptyState
      icon={<FileClock className="h-8 w-8 text-muted-foreground" />}
      title="No recorded activity yet"
      description="Entries appear here automatically as people create, change and delete records across the system."
    />
  );
}
