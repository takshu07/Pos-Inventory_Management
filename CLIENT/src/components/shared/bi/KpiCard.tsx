/**
 * KPI cards — the animated headline metrics every finance and report screen
 * opens with.
 *
 * TWO DESIGN DECISIONS WORTH STATING
 * ----------------------------------
 * 1. THE COUNTER RESPECTS prefers-reduced-motion. An animated number is a nice
 *    touch; a number that animates for someone with vestibular sensitivity is
 *    a barrier. When motion is reduced the value simply appears.
 *
 * 2. TREND POLARITY IS A PROP, NOT AN ASSUMPTION. "Expenses up 12%" is bad
 *    news and must not render as a green up-arrow. The server already inverts
 *    the trend for cost-like metrics; `invertTrend` here is the escape hatch
 *    for anywhere that computes its own.
 */

import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";

import { Card, Skeleton } from "@/components/ui";
import { cn } from "@/utils/cn";
import { formatSignedPercent } from "./format";

// =============================================================================
// ANIMATED COUNTER
// =============================================================================

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Eases a number from its previous value to the new one.
 *
 * Animates from the PREVIOUS value rather than from zero, so a dashboard
 * refresh that barely changes a figure does not replay a full count-up — which
 * would make every poll look like a dramatic event.
 */
export function AnimatedNumber({
  value,
  format,
  durationMs = 650,
  className,
}: {
  value: number;
  format: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (prefersReducedMotion()) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }

    const from = fromRef.current;
    const delta = value - from;

    if (delta === 0) {
      setDisplay(value);
      return;
    }

    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      // easeOutCubic — fast start, gentle settle. Reads as "arriving at a
      // figure" rather than as a slot machine.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + delta * eased);

      if (t < 1) frameRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      fromRef.current = value;
    };
  }, [value, durationMs]);

  return (
    <span className={cn("tabular-nums", className)}>{format(display)}</span>
  );
}

// =============================================================================
// TREND INDICATOR
// =============================================================================

export type TrendDirection = "up" | "down" | "flat";

export function TrendIndicator({
  direction,
  value,
  label,
  className,
}: {
  direction: TrendDirection;
  /** Percentage change. Rendered with its sign. */
  value: number;
  /** What the change is measured against, e.g. "vs previous month". */
  label?: string;
  className?: string;
}) {
  const Icon = direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : Minus;

  const tone =
    direction === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : direction === "down"
        ? "text-red-600 dark:text-red-400"
        : "text-muted-foreground";

  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", tone, className)}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="tabular-nums">{formatSignedPercent(value)}</span>
      {label && <span className="font-normal text-muted-foreground">{label}</span>}
    </span>
  );
}

// =============================================================================
// KPI CARD
// =============================================================================

export interface KpiCardProps {
  label: string;
  value: number;
  format: (n: number) => string;
  icon?: LucideIcon;
  /** Secondary line under the value — a count, a comparison, a caveat. */
  hint?: string;
  trend?: { direction: TrendDirection; value: number; label?: string };
  /**
   * Inverts the trend colour. Set on cost-like metrics where "up" is bad and
   * the caller has NOT already inverted it server-side.
   */
  invertTrend?: boolean;
  /** Accent stripe. Purely decorative — never the only carrier of meaning. */
  accent?: "default" | "success" | "warning" | "danger" | "info";
  onClick?: () => void;
  className?: string;
}

const ACCENTS: Record<NonNullable<KpiCardProps["accent"]>, string> = {
  default: "before:bg-primary/60",
  success: "before:bg-emerald-500/70",
  warning: "before:bg-amber-500/70",
  danger: "before:bg-red-500/70",
  info: "before:bg-blue-500/70",
};

export function KpiCard({
  label,
  value,
  format,
  icon: Icon,
  hint,
  trend,
  invertTrend = false,
  accent = "default",
  onClick,
  className,
}: KpiCardProps) {
  const direction =
    trend && invertTrend
      ? trend.direction === "up"
        ? "down"
        : trend.direction === "down"
          ? "up"
          : "flat"
      : trend?.direction;

  const interactive = typeof onClick === "function";

  return (
    <Card
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick!();
              }
            }
          : undefined
      }
      className={cn(
        "relative overflow-hidden p-4",
        // The accent is a ::before stripe rather than a border, so it does not
        // shift the card's box and can animate independently.
        "before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
        ACCENTS[accent],
        interactive &&
          "cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3 pl-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-1.5 text-2xl font-semibold leading-tight tracking-tight">
            <AnimatedNumber value={value} format={format} />
          </p>
          {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
          {trend && direction && (
            <div className="mt-2">
              <TrendIndicator
                direction={direction}
                value={trend.value}
                {...(trend.label !== undefined ? { label: trend.label } : {})}
              />
            </div>
          )}
        </div>

        {Icon && (
          <span className="shrink-0 rounded-lg bg-muted/60 p-2 text-muted-foreground">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
    </Card>
  );
}

// =============================================================================
// GRID & SKELETON
// =============================================================================

export function KpiGrid({
  children,
  columns = 4,
  className,
}: {
  children: React.ReactNode;
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}) {
  const cols = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
    5: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  }[columns];

  return <div className={cn("grid grid-cols-1 gap-3", cols, className)}>{children}</div>;
}

export function KpiCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="pl-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2.5 h-7 w-32" />
        <Skeleton className="mt-2 h-3 w-20" />
      </div>
    </Card>
  );
}

export function KpiGridSkeleton({ count = 4, columns = 4 }: { count?: number; columns?: 2 | 3 | 4 | 5 }) {
  return (
    <KpiGrid columns={columns}>
      {Array.from({ length: count }, (_, i) => (
        <KpiCardSkeleton key={i} />
      ))}
    </KpiGrid>
  );
}

// =============================================================================
// STAT ROW — a compact label/value pair for summary panels
// =============================================================================

export function StatRow({
  label,
  value,
  emphasis = false,
  tone,
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** Renders as a total line: heavier weight, rule above. */
  emphasis?: boolean;
  tone?: "default" | "positive" | "negative" | "muted";
  className?: string;
}) {
  const toneClass = {
    default: "",
    positive: "text-emerald-600 dark:text-emerald-400",
    negative: "text-red-600 dark:text-red-400",
    muted: "text-muted-foreground",
  }[tone ?? "default"];

  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 py-1.5",
        emphasis && "mt-1 border-t border-border pt-2.5",
        className
      )}
    >
      <span className={cn("text-sm", emphasis ? "font-semibold" : "text-muted-foreground")}>
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          emphasis ? "text-base font-semibold" : "text-sm font-medium",
          toneClass
        )}
      >
        {value}
      </span>
    </div>
  );
}
