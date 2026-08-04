/**
 * NotificationList — the rows.
 *
 * A list rather than a table: a notification is a message, and the useful
 * scan order is title → severity → age, which reads far better as a stacked
 * card than as columns that collapse badly on a phone.
 *
 * Unread is carried by BOTH a left accent bar and a weight change, never by
 * colour alone — a colour-only distinction disappears for anyone with low
 * colour vision, and "which of these have I dealt with" is the single most
 * important thing this screen communicates.
 */

import { Bell, Check } from "lucide-react";

import { Badge, Button } from "@/components/ui";
import { cn } from "@/utils/cn";

import type { NotificationItem } from "../types";
import {
  categoryLabel,
  formatNotificationTime,
  formatNotificationTimestamp,
  severityLabel,
  severityVariant,
} from "../utils/format";

interface NotificationListProps {
  items: NotificationItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onMarkRead: (ids: string[]) => void;
  isMarking: boolean;
}

export function NotificationList({
  items,
  selectedIds,
  onToggleSelect,
  onMarkRead,
  isMarking,
}: NotificationListProps) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Notifications">
      {items.map((item) => {
        const selected = selectedIds.has(item.id);

        return (
          <li key={item.id}>
            <div
              className={cn(
                "group relative flex gap-3 rounded-lg border bg-card p-4 transition-colors",
                "border-l-4",
                item.isRead
                  ? "border-l-transparent border-border"
                  : "border-l-primary border-border",
                selected && "ring-2 ring-primary ring-offset-1 ring-offset-background"
              )}
            >
              {/* Selection */}
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(item.id)}
                className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-input accent-primary"
                aria-label={`Select "${item.title}"`}
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3
                    className={cn(
                      "min-w-0 break-words text-sm",
                      // Weight, not just colour — see the file header.
                      item.isRead
                        ? "font-normal text-muted-foreground"
                        : "font-semibold text-foreground"
                    )}
                  >
                    {item.title}
                  </h3>

                  <Badge variant={severityVariant(item.severity)}>
                    {severityLabel(item.severity)}
                  </Badge>

                  <Badge variant="outline">{categoryLabel(item.category)}</Badge>

                  {!item.isRead && (
                    <span className="sr-only">Unread</span>
                  )}
                </div>

                <p className="mt-1 break-words text-sm text-muted-foreground">
                  {item.message}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span title={formatNotificationTimestamp(item.createdAt)}>
                    {formatNotificationTime(item.createdAt)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{item.typeLabel}</span>
                </div>
              </div>

              {/* Per-row action. Hidden for already-read rows rather than
                  disabled: a disabled control invites a click that can never
                  do anything. */}
              {!item.isRead && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isMarking}
                  onClick={() => onMarkRead([item.id])}
                  className="shrink-0 self-start"
                  aria-label={`Mark "${item.title}" as read`}
                >
                  <Check className="h-4 w-4" />
                  <span className="ml-1 hidden sm:inline">Mark read</span>
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Shown while the first page loads — mirrors the row shape to avoid a jump. */
export function NotificationListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex gap-3 rounded-lg border border-l-4 border-border bg-card p-4"
        >
          <div className="mt-1 h-4 w-4 shrink-0 animate-pulse rounded bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="flex gap-2">
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-4 w-16 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Empty state. The copy changes with the filters so it is never misleading. */
export function NotificationEmptyState({
  filtered,
  onReset,
}: {
  filtered: boolean;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Bell className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold">
        {filtered ? "No notifications match these filters" : "You're all caught up"}
      </h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {filtered
          ? "Try widening the date range, or clearing a category or severity filter."
          : "New alerts about inventory, sales, employees and security will appear here."}
      </p>
      {filtered && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onReset}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
