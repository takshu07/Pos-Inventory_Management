/**
 * Inventory charts.
 *
 * The palette tokens (--wf-s1/s2/s3) are the SAME ones the workforce charts
 * define — a validated, colour-blind-safe set with verified contrast in both
 * light and dark. Reusing them means a blue series means the same thing across
 * the whole app, and there is only one palette to re-validate if it changes.
 *
 * Mark specs follow the shared chart conventions: bars capped at 24px with a
 * 4px rounded data-end, a 2px surface gap separating neighbours, hairline
 * gridlines, and a legend whenever two or more series appear.
 */

import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import { cn } from "@/utils/cn";
import { formatCurrency, formatNumber } from "../utils/format";

// =============================================================================
// PALETTE
//
// Duplicated as CSS custom properties rather than imported, because these are
// style tokens rather than values — the alternative is a runtime import of the
// workforce module purely to read three hex codes.
// =============================================================================

const VIZ_CSS = `
.inv-viz {
  --inv-surface: #ffffff;
  --inv-grid: #ece9f5;
  --inv-axis: #9b96ad;
  --inv-s1: #5b5bd6;
  --inv-s2: #e07a5f;
  --inv-s3: #1baf7a;
}
@media (prefers-color-scheme: dark) {
  .inv-viz {
    --inv-surface: #1a1826;
    --inv-grid: #2c2940;
    --inv-axis: #7d7899;
    --inv-s1: #7b7bf0;
    --inv-s2: #e8907a;
    --inv-s3: #2bc48c;
  }
}
:root[data-theme="dark"] .inv-viz {
  --inv-surface: #1a1826;
  --inv-grid: #2c2940;
  --inv-axis: #7d7899;
  --inv-s1: #7b7bf0;
  --inv-s2: #e8907a;
  --inv-s3: #2bc48c;
}
:root[data-theme="light"] .inv-viz {
  --inv-surface: #ffffff;
  --inv-grid: #ece9f5;
  --inv-axis: #9b96ad;
  --inv-s1: #5b5bd6;
  --inv-s2: #e07a5f;
  --inv-s3: #1baf7a;
}
`;

function VizStyle() {
  return <style dangerouslySetInnerHTML={{ __html: VIZ_CSS }} />;
}

function ChartSkeleton({ height }: { height: number }) {
  return <Skeleton className="w-full" style={{ height }} />;
}

function NoData({ height, message }: { height: number; message: string }) {
  return (
    <div
      className="flex items-center justify-center text-sm text-muted-foreground"
      style={{ height }}
    >
      {message}
    </div>
  );
}

// =============================================================================
// CHART CARD
// =============================================================================

export function ChartCard({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-sm">{title}</CardTitle>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// =============================================================================
// MOVEMENT TREND — two opposing series, so a legend is mandatory
// =============================================================================

export function MovementTrendChart({
  data,
  isLoading,
}: {
  data: Array<{ date: string; stockIn: number; stockOut: number }>;
  isLoading?: boolean;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (isLoading) return <ChartSkeleton height={200} />;
  if (data.length === 0) {
    return <NoData height={200} message="No stock movements in this period." />;
  }

  const max = Math.max(1, ...data.map((d) => Math.max(d.stockIn, d.stockOut)));
  const hovered = hoverIndex !== null ? data[hoverIndex] : null;

  return (
    <div className="inv-viz">
      <VizStyle />

      {/* Two series → legend is not optional. */}
      <div className="mb-3 flex items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: "var(--inv-s3)" }}
            aria-hidden="true"
          />
          Stock in
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: "var(--inv-s2)" }}
            aria-hidden="true"
          />
          Stock out
        </span>
      </div>

      {/* Opposing bars from a shared centre line: in above, out below. The
          mirror makes net flow readable without doing arithmetic. */}
      <div className="flex h-[160px] items-center gap-[2px]">
        {data.map((point, i) => (
          <div
            key={point.date}
            className="group relative flex h-full flex-1 flex-col justify-center"
            onMouseEnter={() => setHoverIndex(i)}
            onMouseLeave={() => setHoverIndex(null)}
          >
            <div className="flex h-1/2 items-end">
              <div
                className={cn(
                  "w-full rounded-t-[4px] transition-opacity",
                  hoverIndex !== null && hoverIndex !== i && "opacity-50"
                )}
                style={{
                  height: `${(point.stockIn / max) * 100}%`,
                  maxWidth: 24,
                  backgroundColor: "var(--inv-s3)",
                }}
              />
            </div>

            <span
              className="h-px w-full"
              style={{ backgroundColor: "var(--inv-grid)" }}
              aria-hidden="true"
            />

            <div className="flex h-1/2 items-start">
              <div
                className={cn(
                  "w-full rounded-b-[4px] transition-opacity",
                  hoverIndex !== null && hoverIndex !== i && "opacity-50"
                )}
                style={{
                  height: `${(point.stockOut / max) * 100}%`,
                  maxWidth: 24,
                  backgroundColor: "var(--inv-s2)",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{new Date(data[0]!.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
        {hovered && (
          <span className="tabular-nums">
            {new Date(hovered.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })} ·{" "}
            <span className="text-emerald-600 dark:text-emerald-400">+{hovered.stockIn}</span>{" "}
            <span className="text-destructive">−{hovered.stockOut}</span>
          </span>
        )}
        <span>
          {new Date(data[data.length - 1]!.date).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
          })}
        </span>
      </div>
    </div>
  );
}

// =============================================================================
// CATEGORY VALUE — magnitude, so SEQUENTIAL (one hue), not categorical
// =============================================================================

export function CategoryValueChart({
  data,
  showValue,
  isLoading,
}: {
  data: Array<{ categoryName: string; units: number; stockValue?: number }>;
  /** False for non-owners, who receive units but no value. */
  showValue: boolean;
  isLoading?: boolean;
}) {
  if (isLoading) return <ChartSkeleton height={200} />;
  if (data.length === 0) {
    return <NoData height={200} message="No categorised stock." />;
  }

  const metric = (d: (typeof data)[number]) => (showValue ? (d.stockValue ?? 0) : d.units);
  const max = Math.max(1, ...data.map(metric));

  return (
    <div className="inv-viz flex flex-col gap-2">
      <VizStyle />

      {data.map((row) => {
        const value = metric(row);
        const pct = (value / max) * 100;

        return (
          <div
            key={row.categoryName}
            className="grid grid-cols-[8rem_1fr_5.5rem] items-center gap-3"
          >
            <span className="truncate text-xs capitalize" title={row.categoryName}>
              {row.categoryName}
            </span>

            {/* Track + bar, 4px rounded data-end, square at the baseline. */}
            <div className="h-5 w-full overflow-hidden rounded-sm bg-muted/50">
              <div
                className="h-full rounded-r-[4px] transition-[width] duration-300"
                style={{
                  width: `${Math.max(pct, value > 0 ? 2 : 0)}%`,
                  backgroundColor: "var(--inv-s1)",
                }}
              />
            </div>

            {/* Direct value label — why no value axis is needed. */}
            <span className="text-right text-xs font-medium tabular-nums">
              {showValue ? formatCurrency(value) : formatNumber(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// AGING — single series, so NO legend box (the title names it)
// =============================================================================

export function AgingChart({
  data,
  showValue,
  isLoading,
}: {
  data: Array<{ label: string; skuCount: number; units: number; stockValue?: number; retailValue: number }>;
  showValue: boolean;
  isLoading?: boolean;
}) {
  if (isLoading) return <ChartSkeleton height={180} />;
  if (data.every((d) => d.skuCount === 0)) {
    return <NoData height={180} message="No aged stock to report." />;
  }

  const metric = (d: (typeof data)[number]) =>
    showValue ? (d.stockValue ?? 0) : d.retailValue;
  const max = Math.max(1, ...data.map(metric));

  return (
    <div className="inv-viz">
      <VizStyle />

      <div className="flex h-[150px] items-end gap-[2px]">
        {data.map((bucket) => {
          const value = metric(bucket);
          const pct = (value / max) * 100;

          return (
            <div key={bucket.label} className="flex h-full flex-1 flex-col justify-end">
              <div
                className="w-full rounded-t-[4px]"
                style={{
                  height: `${Math.max(pct, value > 0 ? 2 : 0)}%`,
                  maxWidth: 48,
                  // Older buckets shade toward the warning hue — the point of
                  // an aging chart is that right is worse than left.
                  backgroundColor:
                    bucket.label.includes("180") || bucket.label.includes("91")
                      ? "var(--inv-s2)"
                      : "var(--inv-s1)",
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex gap-[2px]">
        {data.map((bucket) => (
          <div key={bucket.label} className="flex-1 text-center">
            <div className="truncate text-[10px] text-muted-foreground">{bucket.label}</div>
            <div className="text-xs font-medium tabular-nums">
              {formatCurrency(metric(bucket))}
            </div>
            <div className="text-[10px] text-muted-foreground">{bucket.skuCount} SKUs</div>
          </div>
        ))}
      </div>
    </div>
  );
}
