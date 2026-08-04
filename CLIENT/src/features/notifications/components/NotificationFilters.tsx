/**
 * NotificationFilters — the filter bar.
 *
 * Category and severity are multi-select chips rather than dropdowns because
 * the two questions people actually ask are "what needs my attention" and
 * "what happened in inventory" — both are one click on a chip and both benefit
 * from seeing the counts without opening a menu.
 *
 * Counts come from the summary endpoint and are UNFILTERED, so a chip always
 * shows how much exists in that bucket rather than how much survives the
 * current filter. A chip whose count changes when you click a different chip
 * is unreadable.
 */

import { Search } from "lucide-react";

import { Badge, Button, SearchBox, Select } from "@/components/ui";
import { cn } from "@/utils/cn";

import type {
  NotificationCategory,
  NotificationSeverity,
  NotificationSummary,
} from "../types";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_SEVERITIES } from "../types";
import { categoryLabel, severityLabel, severityVariant } from "../utils/format";

interface NotificationFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;

  categories: NotificationCategory[];
  onToggleCategory: (category: NotificationCategory) => void;

  severities: NotificationSeverity[];
  onToggleSeverity: (severity: NotificationSeverity) => void;

  readState: "all" | "unread" | "read";
  onReadStateChange: (value: "all" | "unread" | "read") => void;

  summary?: NotificationSummary;
  onReset: () => void;
  hasActiveFilters: boolean;
}

export function NotificationFilters({
  search,
  onSearchChange,
  categories,
  onToggleCategory,
  severities,
  onToggleSeverity,
  readState,
  onReadStateChange,
  summary,
  onReset,
  hasActiveFilters,
}: NotificationFiltersProps) {
  const categoryCount = (category: NotificationCategory) =>
    summary?.byCategory.find((c) => c.category === category);

  const severityCount = (severity: NotificationSeverity) =>
    summary?.bySeverity.find((s) => s.severity === severity);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      {/* ── Search + read state ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <SearchBox
            value={search}
            onChange={onSearchChange}
            placeholder="Search notifications…"
          />
        </div>

        <div className="flex items-center gap-2">
          <Select
            aria-label="Read state"
            value={readState}
            options={[
              { value: "all", label: "All" },
              { value: "unread", label: "Unread only" },
              { value: "read", label: "Read only" },
            ]}
            onChange={(e) =>
              onReadStateChange(e.target.value as "all" | "unread" | "read")
            }
            className="min-w-[10rem]"
          />

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={onReset}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* ── Category chips ──────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Category
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          {NOTIFICATION_CATEGORIES.map((category) => {
            const active = categories.includes(category);
            const counts = categoryCount(category);
            return (
              <button
                key={category}
                type="button"
                aria-pressed={active}
                onClick={() => onToggleCategory(category)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {categoryLabel(category)}
                {counts && counts.total > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                      counts.unread > 0
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                    // The chip shows unread-of-total; the tooltip spells it out
                    // so the two numbers are never ambiguous.
                    title={`${counts.unread} unread of ${counts.total}`}
                  >
                    {counts.unread > 0 ? counts.unread : counts.total}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Severity chips ──────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Severity
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by severity">
          {NOTIFICATION_SEVERITIES.map((severity) => {
            const active = severities.includes(severity);
            const counts = severityCount(severity);
            return (
              <button
                key={severity}
                type="button"
                aria-pressed={active}
                onClick={() => onToggleSeverity(severity)}
                className={cn(
                  "rounded-full transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "opacity-100 ring-2 ring-primary ring-offset-1 ring-offset-background" : "opacity-70 hover:opacity-100"
                )}
              >
                <Badge variant={severityVariant(severity)} className="cursor-pointer">
                  {severityLabel(severity)}
                  {counts && counts.total > 0 && (
                    <span className="ml-1.5 tabular-nums">({counts.total})</span>
                  )}
                </Badge>
              </button>
            );
          })}
        </div>
      </div>

      {!summary && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Search className="h-3 w-3" />
          Counts load with the summary.
        </p>
      )}
    </div>
  );
}
