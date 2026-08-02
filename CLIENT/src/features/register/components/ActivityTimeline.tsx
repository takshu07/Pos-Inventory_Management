/**
 * The shift timeline.
 *
 * WHY A TIMELINE AND NOT A TABLE
 * ------------------------------
 * The question this answers is "when did the drawer go wrong", which is a
 * question about ORDER, not about columns. A table sorted by date is the same
 * data, but a reader has to reconstruct the sequence from timestamps; a
 * timeline shows it. The running balance beside each entry is what turns
 * "something is short" into "it was right at 14:20 and wrong at 15:05".
 */

import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CircleDot,
  FileText,
  LockOpen,
  Lock,
  Receipt,
  RefreshCw,
  ShieldCheck,
  StickyNote,
} from "lucide-react";

import { Badge, Skeleton } from "@/components/ui";
import { cn } from "@/utils/cn";
import {
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPE_VARIANTS,
  formatCurrencyExact,
  formatTime,
} from "@/components/shared/bi";
import type { RegisterActivity, RegisterActivityType } from "../types";

const ICONS: Record<RegisterActivityType, typeof CircleDot> = {
  OPENED: LockOpen,
  SALE: ArrowUpRight,
  REFUND: ArrowDownLeft,
  EXCHANGE: RefreshCw,
  CASH_DROP: Banknote,
  CASH_PAYOUT: Receipt,
  EXPENSE: FileText,
  ADJUSTMENT: CircleDot,
  NOTE: StickyNote,
  CLOSED: Lock,
  RECONCILED: ShieldCheck,
};

export function ActivityTimeline({
  activities,
  isLoading,
  emptyMessage = "Nothing has happened on this drawer yet.",
  className,
}: {
  activities: RegisterActivity[];
  isLoading?: boolean;
  emptyMessage?: string;
  className?: string;
}) {
  if (isLoading) {
    return (
      <div className={cn("space-y-3", className)}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <p className={cn("py-8 text-center text-sm text-muted-foreground", className)}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <ol className={cn("relative space-y-0", className)}>
      {activities.map((activity, index) => {
        const Icon = ICONS[activity.type] ?? CircleDot;
        const isLast = index === activities.length - 1;
        const hasCashImpact = activity.amount !== 0;

        return (
          <li key={activity.id} className="relative flex gap-3 pb-4 last:pb-0">
            {/* The connecting rail. Absent on the last item so the timeline
                terminates rather than trailing into nothing. */}
            {!isLast && (
              <span
                className="absolute left-4 top-9 h-[calc(100%-2.25rem)] w-px bg-border"
                aria-hidden
              />
            )}

            <span
              className={cn(
                "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-card",
                hasCashImpact && activity.amount > 0 && "border-emerald-300 text-emerald-600 dark:border-emerald-800 dark:text-emerald-400",
                hasCashImpact && activity.amount < 0 && "border-red-300 text-red-600 dark:border-red-800 dark:text-red-400",
                !hasCashImpact && "border-border text-muted-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <Badge variant={ACTIVITY_TYPE_VARIANTS[activity.type] ?? "secondary"}>
                  {ACTIVITY_TYPE_LABELS[activity.type] ?? activity.type}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatTime(activity.createdAt)}
                </span>
                {activity.employee && (
                  <span className="text-xs text-muted-foreground">
                    · {activity.employee.name}
                  </span>
                )}
              </div>

              <p className="mt-1 break-words text-sm">{activity.description}</p>

              {(hasCashImpact || activity.balanceAfter !== null) && (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs">
                  {hasCashImpact && (
                    <span
                      className={cn(
                        "font-medium tabular-nums",
                        activity.amount > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      )}
                    >
                      {activity.amount > 0 ? "+" : "−"}
                      {formatCurrencyExact(Math.abs(activity.amount))}
                    </span>
                  )}
                  {activity.balanceAfter !== null && (
                    <span className="tabular-nums text-muted-foreground">
                      Drawer: {formatCurrencyExact(activity.balanceAfter)}
                    </span>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
