/**
 * Severity totals for the CURRENT filter set.
 *
 * These describe the result the reader is looking at, not the whole table —
 * a "3 critical" tile that ignored the active filters would be a different
 * claim than the list beneath it, which is the sort of inconsistency that makes
 * people stop trusting the screen.
 *
 * Each tile is also a FILTER: clicking "Critical" narrows to critical. That
 * makes the number and the way to act on it the same affordance.
 */

import { Card, Skeleton } from "@/components/ui";
import { cn } from "@/utils/cn";
import type { AuditSeverity, AuditSummary } from "../types";
import { severityLabel } from "../utils/format";

/** Tile accents. Kept in step with `severityVariant` in utils/format. */
const TILE_STYLES: Record<AuditSeverity, string> = {
  CRITICAL: "text-destructive",
  HIGH: "text-amber-600 dark:text-amber-400",
  MEDIUM: "text-blue-600 dark:text-blue-400",
  LOW: "text-muted-foreground",
};

export function AuditSummaryStrip({
  summary,
  isLoading,
  activeSeverities,
  onToggleSeverity,
}: {
  summary: AuditSummary | undefined;
  isLoading: boolean;
  activeSeverities: string[];
  onToggleSeverity: (severity: string) => void;
}) {
  if (isLoading && !summary) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-7 w-12" />
          </Card>
        ))}
      </div>
    );
  }

  const bySeverity = summary?.bySeverity ?? [];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {bySeverity.map(({ severity, count }) => {
        const active = activeSeverities.includes(severity);
        return (
          <Card
            key={severity}
            role="button"
            tabIndex={0}
            aria-pressed={active}
            aria-label={`${severityLabel(severity)}: ${count} entries. Filter by this severity.`}
            onClick={() => onToggleSeverity(severity)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggleSeverity(severity);
              }
            }}
            className={cn(
              "cursor-pointer p-4 transition-colors hover:bg-muted/50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active && "border-primary bg-muted"
            )}
          >
            <p className="text-xs font-medium text-muted-foreground">
              {severityLabel(severity)}
            </p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", TILE_STYLES[severity])}>
              {count.toLocaleString()}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
