import * as React from "react";
import { cn } from "@/utils/cn";

/**
 * Skeleton Component — Loading Placeholder
 * Replaces content while data loads. Prevents layout shift.
 */

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("relative overflow-hidden rounded-md bg-muted/60", className)}
      // A skeleton is decorative scaffolding, not content — screen readers should
      // announce the loading state from the region that owns it, not read out a
      // stack of empty boxes.
      aria-hidden="true"
      {...props}
    >
      {/* GPU-composited sweep — see @keyframes skeleton-shimmer in styles/index.css. */}
      <div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/[0.07] to-transparent"
        style={{ animation: "skeleton-shimmer 1.6s ease-in-out infinite" }}
      />
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-9 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-10 w-full mt-4" />
    </div>
  );
}
