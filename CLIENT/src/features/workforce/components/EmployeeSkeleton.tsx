/**
 * Loading and empty states for the workforce module.
 *
 * The skeleton mirrors the real row's LAYOUT (avatar circle + two text lines +
 * trailing columns) rather than being a plain grey bar. Matching the shape is
 * what stops the table from jumping when data arrives.
 */

import { Users, SearchX } from "lucide-react";
import { EmptyState, Skeleton, TableCell, TableRow } from "@/components/ui";

/** Skeleton rows for a table body. `columns` must match the header count. */
export function EmployeeTableSkeleton({
  rows = 8,
  columns = 8,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r}>
          {/* The first cell carries the avatar + name pair, so it gets its own shape. */}
          <TableCell>
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          </TableCell>
          {Array.from({ length: Math.max(0, columns - 1) }).map((_, c) => (
            <TableCell key={c}>
              <Skeleton className="h-3.5 w-16" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/** Card-grid skeleton, used where the roster renders as cards on mobile. */
export function EmployeeCardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Empty state that distinguishes "no data at all" from "no matches".
 * They call for different actions — one offers to clear filters, the other
 * cannot, and conflating them leaves the user with no way forward.
 */
export function EmployeeEmptyState({
  hasFilters,
  onClear,
  entity = "employees",
}: {
  hasFilters: boolean;
  onClear?: () => void;
  entity?: string;
}) {
  if (hasFilters) {
    return (
      <EmptyState
        icon={<SearchX className="h-8 w-8 text-muted-foreground" />}
        title={`No ${entity} match these filters`}
        description="Try a different search term, or clear the filters to see everyone."
        {...(onClear ? { action: { label: "Clear filters", onClick: onClear } } : {})}
      />
    );
  }

  return (
    <EmptyState
      icon={<Users className="h-8 w-8 text-muted-foreground" />}
      title={`No ${entity} yet`}
      description={`Once ${entity} are added they will appear here with their activity, attendance and performance.`}
    />
  );
}
