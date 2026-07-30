/**
 * Chronological activity timeline.
 *
 * Rendered from the EXISTING audit records (EmployeeAction) — this module adds
 * no activity tracking of its own. The server has already turned each row into
 * a human sentence and a category; this component only lays them out.
 *
 * Entries are grouped by day. A flat list of timestamps is unreadable past
 * about twenty rows, and "when did this happen" is nearly always asked as
 * "which day, then what time".
 */

import { Clock } from "lucide-react";

import { Skeleton } from "@/components/ui";
import { cn } from "@/utils/cn";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { ACTIVITY_COLORS, formatTime } from "../utils/format";
import type { ActivityRow } from "../types";

/** Groups rows into day buckets, preserving the server's newest-first order. */
function groupByDay(rows: ActivityRow[]) {
  const groups = new Map<string, ActivityRow[]>();

  for (const row of rows) {
    const key = new Date(row.createdAt).toDateString();
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.entries()];
}

function dayLabel(dateString: string): string {
  const date = new Date(dateString);
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();

  if (date.toDateString() === today) return "Today";
  if (date.toDateString() === yesterday) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function EmployeeTimeline({
  rows,
  isLoading,
  /** Show who performed each action. Off inside a single employee's drawer. */
  showEmployee = false,
  emptyMessage = "No activity recorded yet.",
}: {
  rows: ActivityRow[];
  isLoading?: boolean;
  showEmployee?: boolean;
  emptyMessage?: string;
}) {
  if (isLoading) return <TimelineSkeleton />;

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <Clock className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  const groups = groupByDay(rows);

  return (
    <div className="flex flex-col gap-6">
      {groups.map(([day, entries]) => (
        <section key={day}>
          <h3 className="sticky top-0 z-10 -mx-1 bg-card/95 px-1 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
            {dayLabel(day)}
          </h3>

          <ol className="relative mt-2 space-y-0.5">
            {/* The vertical rail. Rendered once per group rather than per row so
                it is continuous rather than a stack of segments. */}
            <span
              className="absolute bottom-2 left-[7px] top-2 w-px bg-border"
              aria-hidden="true"
            />

            {entries.map((entry) => (
              <li key={entry.id} className="relative flex gap-3 py-2 pl-6">
                <span
                  className={cn(
                    "absolute left-0 top-3.5 h-[15px] w-[15px] rounded-full border-[3px] border-card",
                    ACTIVITY_COLORS[entry.category] ?? ACTIVITY_COLORS["OTHER"]
                  )}
                  aria-hidden="true"
                />

                <time
                  className="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground"
                  dateTime={entry.createdAt}
                >
                  {formatTime(entry.createdAt)}
                </time>

                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug">{entry.description}</p>

                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="uppercase tracking-wide">{entry.module}</span>
                    {entry.referenceId && (
                      // Truncated: the full cuid is noise, the tail is enough to
                      // correlate with another screen.
                      <span className="font-mono">#{entry.referenceId.slice(-8)}</span>
                    )}
                  </div>
                </div>

                {showEmployee && entry.employee && (
                  <div className="flex shrink-0 items-center gap-2">
                    <EmployeeAvatar
                      id={entry.employee.id}
                      firstName={entry.employee.fullName.split(" ")[0] ?? ""}
                      lastName={entry.employee.fullName.split(" ")[1] ?? ""}
                      photoUrl={entry.employee.photoUrl}
                      size="sm"
                    />
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {entry.employee.fullName}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex gap-3 pl-6">
          <Skeleton className="h-3 w-12 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}
