import { Skeleton } from "@/components/ui";

/**
 * Loading skeletons that mirror the real layouts.
 *
 * Column and row counts match the live table so the page does not reflow when
 * data arrives — the point of a skeleton is to reserve the exact space, not
 * merely to show that something is happening.
 */

export function CategoryTableSkeleton({
  rows = 8,
  columns = 7,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="w-full">
      <div className="flex items-center gap-4 border-b border-border px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className={i === 0 ? "h-4 w-10" : "h-4 flex-1"} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-border/50 px-4 py-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
          {Array.from({ length: columns - 1 }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CategoryCardGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border p-4">
          <Skeleton className="mb-3 h-28 w-full rounded-md" />
          <Skeleton className="mb-2 h-4 w-2/3" />
          <Skeleton className="mb-3 h-3 w-full" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CategorySummarySkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border p-4">
          <Skeleton className="mb-3 h-3 w-20" />
          <Skeleton className="h-7 w-14" />
        </div>
      ))}
    </div>
  );
}

export function CategoryDetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <div className="grid grid-cols-2 gap-3 pt-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
