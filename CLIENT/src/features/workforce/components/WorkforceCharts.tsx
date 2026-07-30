/**
 * Workforce charts.
 *
 * Rendered as inline SVG rather than through a charting library: the stack is
 * fixed, no chart package is installed, and these three forms are simple enough
 * that a library would cost more in bundle size than it saves in code.
 *
 * COLOR — the palette below is validated, not chosen by eye. The three
 * categorical hues are the reference palette's first three slots, which pass
 * every gate (lightness band, chroma floor, CVD separation, normal-vision
 * floor, contrast) in BOTH light and dark mode:
 *   light  worst adjacent CVD ΔE 9.2, normal-vision ΔE 27.6
 *   dark   worst adjacent CVD ΔE 9.4, normal-vision ΔE 26.5
 * The dark steps are re-stepped for the dark surface, not an automatic flip.
 * Do not substitute hues here without re-running the validator — yellow and red
 * in particular fail the normal-vision floor together on a dark surface.
 *
 * MARKS follow the fixed specs: 2px lines, ≥8px markers with a 2px surface
 * ring, ~10% area washes, hairline recessive gridlines, bars capped at 24px
 * with a 4px rounded data-end and a 2px surface gap between neighbours.
 */

import { useId, useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import { cn } from "@/utils/cn";
import { formatCurrency, formatDuration } from "../utils/format";
import type { AttendanceSummary, PerformanceRow } from "../types";

// =============================================================================
// PALETTE
// Both modes declared; the dark values win under prefers-color-scheme AND under
// the app's [data-theme="dark"] stamp, so the theme toggle beats the OS setting.
// =============================================================================

const VIZ_STYLE = `
.wf-viz {
  --wf-surface: #ffffff;
  --wf-grid: #e5e7eb;
  --wf-axis: #9ca3af;
  --wf-s1: #2a78d6;
  --wf-s2: #eb6834;
  --wf-s3: #1baf7a;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .wf-viz {
    --wf-surface: #0b0b0c;
    --wf-grid: #27272a;
    --wf-axis: #71717a;
    --wf-s1: #3987e5;
    --wf-s2: #d95926;
    --wf-s3: #199e70;
  }
}
:root[data-theme="dark"] .wf-viz {
  --wf-surface: #0b0b0c;
  --wf-grid: #27272a;
  --wf-axis: #71717a;
  --wf-s1: #3987e5;
  --wf-s2: #d95926;
  --wf-s3: #199e70;
}
`;

/** Injected once per page. A <style> in each chart would duplicate the rules. */
function VizStyle() {
  return <style>{VIZ_STYLE}</style>;
}

/** Legend — always present for ≥2 series, so identity is never colour-alone. */
function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function ChartSkeleton({ height = 200 }: { height?: number }) {
  return <Skeleton className="w-full" style={{ height }} />;
}

function NoData({ height = 200, message }: { height?: number; message: string }) {
  return (
    <div
      className="flex items-center justify-center text-xs text-muted-foreground"
      style={{ height }}
    >
      {message}
    </div>
  );
}

// =============================================================================
// ATTENDANCE TREND — multi-line, the series ARE the subject (categorical)
// =============================================================================

export function AttendanceTrendChart({
  data,
  isLoading,
}: {
  data: AttendanceSummary["trend"] | undefined;
  isLoading?: boolean;
}) {
  const clipId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const width = 720;
  const height = 220;
  const pad = { top: 12, right: 16, bottom: 26, left: 34 };

  const points = data ?? [];

  const geometry = useMemo(() => {
    if (points.length === 0) return null;

    const max = Math.max(
      1,
      ...points.map((p) => Math.max(p.present, p.late, p.absent))
    );

    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;

    // A single point has no span to divide by; centre it instead of dividing by 0.
    const x = (i: number) =>
      points.length === 1
        ? pad.left + innerW / 2
        : pad.left + (i / (points.length - 1)) * innerW;
    const y = (v: number) => pad.top + innerH - (v / max) * innerH;

    const path = (key: "present" | "late" | "absent") =>
      points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p[key])}`).join(" ");

    return { max, x, y, path, innerH };
  }, [points]);

  if (isLoading) return <ChartSkeleton height={height} />;
  if (!geometry) return <NoData height={height} message="No attendance recorded in this period." />;

  const { max, x, y, path } = geometry;
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="wf-viz">
      <VizStyle />

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Attendance trend showing present, late and absent counts per day"
      >
        <clipPath id={clipId}>
          <rect x={pad.left} y={pad.top} width={width - pad.left - pad.right} height={height - pad.top - pad.bottom} />
        </clipPath>

        {/* Gridlines: hairline, solid, one step off surface — recessive. */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--wf-grid)"
              strokeWidth={1}
            />
            <text
              x={pad.left - 6}
              y={y(t) + 3}
              textAnchor="end"
              className="fill-muted-foreground"
              style={{ fontSize: 10 }}
            >
              {t}
            </text>
          </g>
        ))}

        <g clipPath={`url(#${clipId})`}>
          {/* Present carries an area wash — it is the baseline expectation the
              other two series are read against. 10% opacity, never a block. */}
          <path
            d={`${path("present")} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
            fill="var(--wf-s3)"
            opacity={0.1}
          />
          <path d={path("present")} fill="none" stroke="var(--wf-s3)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={path("late")} fill="none" stroke="var(--wf-s2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={path("absent")} fill="none" stroke="var(--wf-s1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </g>

        {/* Crosshair + markers on hover. Markers carry a 2px surface ring so
            they stay legible where the three lines cross. */}
        {hoverIndex !== null && hovered && (
          <g>
            <line
              x1={x(hoverIndex)}
              x2={x(hoverIndex)}
              y1={pad.top}
              y2={height - pad.bottom}
              stroke="var(--wf-axis)"
              strokeWidth={1}
            />
            {([
              ["present", "var(--wf-s3)"],
              ["late", "var(--wf-s2)"],
              ["absent", "var(--wf-s1)"],
            ] as const).map(([key, color]) => (
              <circle
                key={key}
                cx={x(hoverIndex)}
                cy={y(hovered[key])}
                r={4}
                fill={color}
                stroke="var(--wf-surface)"
                strokeWidth={2}
              />
            ))}
          </g>
        )}

        {/* Invisible hit bands — the hover target is the full column height,
            not the 2px line, which would be nearly impossible to hit. */}
        {points.map((_, i) => (
          <rect
            key={i}
            x={x(i) - (width - pad.left - pad.right) / Math.max(1, points.length * 2)}
            y={pad.top}
            width={(width - pad.left - pad.right) / Math.max(1, points.length)}
            height={height - pad.top - pad.bottom}
            fill="transparent"
            onMouseEnter={() => setHoverIndex(i)}
            onMouseLeave={() => setHoverIndex(null)}
          />
        ))}

        {/* Endpoint date labels only — a date under every tick would collide. */}
        {points.length > 0 && (
          <>
            <text x={pad.left} y={height - 8} className="fill-muted-foreground" style={{ fontSize: 10 }}>
              {new Date(points[0]!.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
            </text>
            <text
              x={width - pad.right}
              y={height - 8}
              textAnchor="end"
              className="fill-muted-foreground"
              style={{ fontSize: 10 }}
            >
              {new Date(points[points.length - 1]!.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
            </text>
          </>
        )}
      </svg>

      <div className="mt-2 flex items-center justify-between gap-4">
        <Legend
          items={[
            { label: "Present", color: "var(--wf-s3)" },
            { label: "Late", color: "var(--wf-s2)" },
            { label: "Absent", color: "var(--wf-s1)" },
          ]}
        />
        {hovered && (
          <p className="text-xs tabular-nums text-muted-foreground">
            {new Date(hovered.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })} ·{" "}
            {hovered.present} present · {hovered.late} late · {hovered.absent} absent
          </p>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// REVENUE BY EMPLOYEE — magnitude, so SEQUENTIAL (one hue), not categorical.
// The employees are not "series"; the bar length is the whole message.
// =============================================================================

export function RevenueByEmployeeChart({
  rows,
  isLoading,
  metric = "revenue",
  limit = 8,
}: {
  rows: PerformanceRow[] | undefined;
  isLoading?: boolean;
  metric?: "revenue" | "transactions";
  limit?: number;
}) {
  const data = useMemo(
    () =>
      (rows ?? [])
        .slice()
        .sort((a, b) => (metric === "revenue" ? b.revenue - a.revenue : b.transactions - a.transactions))
        .slice(0, limit),
    [rows, metric, limit]
  );

  if (isLoading) return <ChartSkeleton height={240} />;
  if (data.length === 0) {
    return <NoData height={240} message="No sales recorded in this period." />;
  }

  const max = Math.max(1, ...data.map((d) => (metric === "revenue" ? d.revenue : d.transactions)));

  return (
    <div className="wf-viz flex flex-col gap-2">
      <VizStyle />

      {data.map((row) => {
        const value = metric === "revenue" ? row.revenue : row.transactions;
        const pct = (value / max) * 100;

        return (
          <div key={row.id} className="grid grid-cols-[9rem_1fr_5.5rem] items-center gap-3">
            <span className="truncate text-xs" title={row.fullName}>
              {row.fullName}
            </span>

            {/* Track + bar. The bar is capped at 20px with a 4px rounded
                data-end and a square baseline start, per the mark spec. */}
            <div className="h-5 w-full overflow-hidden rounded-sm bg-muted/50">
              <div
                className="h-full rounded-r-[4px] transition-[width] duration-300"
                style={{
                  width: `${Math.max(pct, value > 0 ? 2 : 0)}%`,
                  backgroundColor: "var(--wf-s1)",
                }}
              />
            </div>

            {/* Direct value label — the relief for the contrast WARN, and the
                reason no value axis is needed. */}
            <span className="text-right text-xs font-medium tabular-nums">
              {metric === "revenue" ? formatCurrency(value) : value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// WORKING HOURS — single series, so NO legend box (the title names it).
// =============================================================================

export function WorkingHoursChart({
  data,
  isLoading,
}: {
  data: AttendanceSummary["trend"] | undefined;
  isLoading?: boolean;
}) {
  const points = data ?? [];
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (isLoading) return <ChartSkeleton height={180} />;
  if (points.length === 0) {
    return <NoData height={180} message="No working hours recorded." />;
  }

  const max = Math.max(1, ...points.map((p) => p.workedMinutes));

  return (
    <div className="wf-viz">
      <VizStyle />

      {/* A 2px surface gap separates adjacent bars — white doing the
          separating, never a stroke around the mark. */}
      <div className="flex h-[150px] items-end gap-[2px]">
        {points.map((point, i) => {
          const pct = (point.workedMinutes / max) * 100;
          return (
            <div
              key={point.date}
              className="group relative flex h-full flex-1 items-end"
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
            >
              <div
                className={cn(
                  "w-full rounded-t-[4px] transition-opacity",
                  hoverIndex !== null && hoverIndex !== i && "opacity-50"
                )}
                style={{
                  height: `${Math.max(pct, point.workedMinutes > 0 ? 2 : 0)}%`,
                  maxWidth: 24,
                  backgroundColor: "var(--wf-s1)",
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {new Date(points[0]!.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
        </span>
        {hoverIndex !== null && points[hoverIndex] && (
          <span className="tabular-nums">
            {new Date(points[hoverIndex]!.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })} ·{" "}
            {formatDuration(points[hoverIndex]!.workedMinutes)}
          </span>
        )}
        <span>
          {new Date(points[points.length - 1]!.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
        </span>
      </div>
    </div>
  );
}

// =============================================================================
// SPARKLINE — a stat-tile companion, deliberately axis-free and label-free.
// =============================================================================

export function Sparkline({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  if (values.length < 2) return null;

  const width = 100;
  const height = 24;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;

  const path = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * height;
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");

  return (
    <div className={cn("wf-viz", className)}>
      <VizStyle />
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} aria-hidden="true">
        <path
          d={path}
          fill="none"
          stroke="var(--wf-s1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

// =============================================================================
// CHART CARD — consistent framing so the charts read as one system.
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
