/**
 * Monthly attendance calendar.
 *
 * A grid answers "which days did this go wrong" in one glance, which a table of
 * the same rows cannot — the table answers "what exactly happened on the 14th".
 * Both are shown, in that order, because they are different questions.
 *
 * The status legend is deliberately the same vocabulary as AttendanceBadge, so
 * a colour means the same thing in the calendar, the table and the roster.
 */

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui";
import { cn } from "@/utils/cn";
import { formatDate, formatDuration, ATTENDANCE_LABELS } from "../utils/format";
import type { AttendanceRow, AttendanceStatus } from "../types";

/**
 * Cell styling per status. Uses the same hue family as the badges — an ABSENT
 * day is destructive-red in both places, so the two never contradict.
 */
const CELL_STYLES: Record<AttendanceStatus, string> = {
  PRESENT: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  LATE: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  HALF_DAY: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  ABSENT: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  ON_LEAVE: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  HOLIDAY: "bg-muted text-muted-foreground",
  WEEK_OFF: "bg-muted text-muted-foreground",
};

/** One-character marks, per the spec's ✓ / L / A shorthand. */
const CELL_MARKS: Record<AttendanceStatus, string> = {
  PRESENT: "✓",
  LATE: "L",
  HALF_DAY: "½",
  ABSENT: "A",
  ON_LEAVE: "•",
  HOLIDAY: "H",
  WEEK_OFF: "—",
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** Local YYYY-MM-DD key. Avoids toISOString(), which shifts across timezones. */
function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function AttendanceCalendar({
  records,
  /** Month to open on. Defaults to the newest record's month, else today. */
  initialMonth,
}: {
  records: AttendanceRow[];
  initialMonth?: Date;
}) {
  // Index by local date so a lookup is O(1) per cell rather than a scan.
  const byDate = useMemo(() => {
    const map = new Map<string, AttendanceRow>();
    for (const row of records) map.set(dayKey(new Date(row.date)), row);
    return map;
  }, [records]);

  const [cursor, setCursor] = useState(() => {
    if (initialMonth) return new Date(initialMonth.getFullYear(), initialMonth.getMonth(), 1);
    // Opening on the newest record's month means the grid is never empty when
    // the data is simply from last month.
    const newest = records[0]?.date;
    const base = newest ? new Date(newest) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = new Date(year, month, 1).getDay();
  const todayKey = dayKey(new Date());

  const cells: Array<{ day: number; key: string } | null> = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      key: dayKey(new Date(year, month, i + 1)),
    })),
  ];

  // Which statuses actually occur this month — the legend lists only those,
  // so it stays short instead of always showing all seven.
  const present = useMemo(() => {
    const set = new Set<AttendanceStatus>();
    for (const cell of cells) {
      if (!cell) continue;
      const row = byDate.get(cell.key);
      if (row) set.add(row.status);
    }
    return [...set];
  }, [cells, byDate]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous month"
          onClick={() => setCursor(new Date(year, month - 1, 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <span className="text-sm font-medium">
          {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Next month"
          onClick={() => setCursor(new Date(year, month + 1, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Attendance calendar">
        {WEEKDAYS.map((label, i) => (
          <div
            key={`${label}-${i}`}
            className="pb-1 text-center text-[10px] font-medium uppercase text-muted-foreground"
            aria-hidden="true"
          >
            {label}
          </div>
        ))}

        {cells.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} aria-hidden="true" />;

          const row = byDate.get(cell.key);
          const isToday = cell.key === todayKey;

          // A day with no record is not "absent" — nothing was recorded, which
          // is a different fact and must not be coloured as a failure.
          const title = row
            ? `${formatDate(row.date)} · ${ATTENDANCE_LABELS[row.status]}${
                row.workedMinutes > 0 ? ` · ${formatDuration(row.workedMinutes)}` : ""
              }${row.lateMinutes > 0 ? ` · ${formatDuration(row.lateMinutes)} late` : ""}`
            : `${cell.key} · no record`;

          return (
            <div
              key={cell.key}
              title={title}
              className={cn(
                "flex aspect-square flex-col items-center justify-center rounded-md text-[11px] leading-none",
                row ? CELL_STYLES[row.status] : "bg-muted/40 text-muted-foreground/60",
                isToday && "ring-2 ring-primary ring-offset-1 ring-offset-background"
              )}
            >
              <span className="text-[9px] opacity-70">{cell.day}</span>
              <span className="mt-0.5 font-semibold">{row ? CELL_MARKS[row.status] : ""}</span>
            </div>
          );
        })}
      </div>

      {present.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {present.map((status) => (
            <span key={status} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex h-4 w-4 items-center justify-center rounded text-[9px] font-semibold",
                  CELL_STYLES[status]
                )}
                aria-hidden="true"
              >
                {CELL_MARKS[status]}
              </span>
              {ATTENDANCE_LABELS[status]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
