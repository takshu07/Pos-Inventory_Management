/**
 * Business-intelligence chart kit.
 *
 * PALETTE
 * -------
 * The tokens below are the SAME validated, colour-blind-safe set the workforce
 * and inventory charts already use, with verified contrast in both light and
 * dark. Reusing them means a blue series means the same thing across the whole
 * application, and there is exactly one palette to re-validate if it changes.
 *
 * They are declared as CSS custom properties rather than imported constants
 * because they are style tokens, not values — the alternative is a runtime
 * import of another feature module purely to read six hex codes.
 *
 * MARK SPECS (shared conventions, applied consistently here)
 * ----------------------------------------------------------
 *   • Bars cap at 28px with a 4px rounded data-end and a 2px surface gap.
 *   • Gridlines are hairline and horizontal only — vertical rules add ink and
 *     no information on a time axis.
 *   • A legend appears whenever two or more series are plotted, never for one.
 *   • Axes are formatted, never raw: "₹1.2L", not "120000".
 *   • Every chart has an explicit empty state. A blank plot area is
 *     indistinguishable from a broken query.
 */

import { Fragment, useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import { cn } from "@/utils/cn";
import { formatCurrencyCompact, formatCurrency, formatNumber, formatPercent } from "./format";

// =============================================================================
// PALETTE
// =============================================================================

const VIZ_CSS = `
.bi-viz {
  --bi-surface: #ffffff;
  --bi-grid: #e5e7eb;
  --bi-axis: #9ca3af;
  --bi-text: #374151;
  --bi-s1: #2a78d6;
  --bi-s2: #eb6834;
  --bi-s3: #1baf7a;
  --bi-s4: #8b5cf6;
  --bi-s5: #d9a441;
  --bi-s6: #d64550;
  --bi-positive: #1baf7a;
  --bi-negative: #d64550;
}
@media (prefers-color-scheme: dark) {
  .bi-viz {
    --bi-surface: #0b0b0c;
    --bi-grid: #27272a;
    --bi-axis: #71717a;
    --bi-text: #d4d4d8;
    --bi-s1: #3987e5;
    --bi-s2: #d95926;
    --bi-s3: #199e70;
    --bi-s4: #9d76f7;
    --bi-s5: #c99433;
    --bi-s6: #e05a63;
    --bi-positive: #199e70;
    --bi-negative: #e05a63;
  }
}
:root[data-theme="dark"] .bi-viz {
  --bi-surface: #0b0b0c;
  --bi-grid: #27272a;
  --bi-axis: #71717a;
  --bi-text: #d4d4d8;
  --bi-s1: #3987e5;
  --bi-s2: #d95926;
  --bi-s3: #199e70;
  --bi-s4: #9d76f7;
  --bi-s5: #c99433;
  --bi-s6: #e05a63;
  --bi-positive: #199e70;
  --bi-negative: #e05a63;
}
:root[data-theme="light"] .bi-viz {
  --bi-surface: #ffffff;
  --bi-grid: #e5e7eb;
  --bi-axis: #9ca3af;
  --bi-text: #374151;
  --bi-s1: #2a78d6;
  --bi-s2: #eb6834;
  --bi-s3: #1baf7a;
  --bi-s4: #8b5cf6;
  --bi-s5: #d9a441;
  --bi-s6: #d64550;
  --bi-positive: #1baf7a;
  --bi-negative: #d64550;
}
`;

export const SERIES_VARS = [
  "var(--bi-s1)",
  "var(--bi-s2)",
  "var(--bi-s3)",
  "var(--bi-s4)",
  "var(--bi-s5)",
  "var(--bi-s6)",
] as const;

/** Cycles the palette so a chart with more series than colours still renders. */
export function seriesColor(index: number): string {
  return SERIES_VARS[index % SERIES_VARS.length]!;
}

// =============================================================================
// SHELL
// =============================================================================

export interface ChartShellProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  isLoading?: boolean;
  isEmpty?: boolean;
  emptyMessage?: string;
  height?: number;
  children: React.ReactNode;
  className?: string;
}

/**
 * The frame every chart sits in.
 *
 * Owns the three states a chart can be in — loading, empty, populated — so no
 * individual chart has to remember to handle them. A blank plot area with no
 * message is the single most common way a working dashboard looks broken.
 */
export function ChartShell({
  title,
  subtitle,
  action,
  isLoading,
  isEmpty,
  emptyMessage = "No data for the selected filters.",
  height = 280,
  children,
  className,
}: ChartShellProps) {
  return (
    <Card className={cn("bi-viz", className)}>
      <style>{VIZ_CSS}</style>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate">{title}</CardTitle>
          {subtitle && (
            <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <Skeleton className="w-full rounded-lg" style={{ height }} />
        ) : isEmpty ? (
          <div
            className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-center"
            style={{ height }}
          >
            <p className="text-sm font-medium text-muted-foreground">Nothing to plot</p>
            <p className="max-w-xs text-xs text-muted-foreground">{emptyMessage}</p>
          </div>
        ) : (
          <div style={{ height }}>{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// TOOLTIP
// =============================================================================

type Formatter = (value: number) => string;

const FORMATTERS: Record<string, Formatter> = {
  currency: formatCurrency,
  compact: formatCurrencyCompact,
  number: formatNumber,
  percent: (n) => formatPercent(n),
};

function BiTooltip({
  active,
  payload,
  label,
  valueFormat = "currency",
  labelFormatter,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string }>;
  label?: string;
  valueFormat?: keyof typeof FORMATTERS;
  labelFormatter?: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;

  const format = FORMATTERS[valueFormat] ?? formatCurrency;

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
      <p className="mb-1 text-xs font-medium text-foreground">
        {labelFormatter && label ? labelFormatter(label) : label}
      </p>
      <div className="space-y-0.5">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: entry.color }}
              aria-hidden
            />
            <span className="text-muted-foreground">{entry.name ?? entry.dataKey}</span>
            <span className="ml-auto font-medium tabular-nums text-foreground">
              {typeof entry.value === "number" ? format(entry.value) : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// SHARED AXIS PROPS
// =============================================================================

const axisProps = {
  stroke: "var(--bi-axis)",
  tick: { fill: "var(--bi-axis)", fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

const gridProps = {
  stroke: "var(--bi-grid)",
  strokeDasharray: "3 3",
  // Horizontal only — vertical rules on a time axis add ink and no information.
  vertical: false,
} as const;

// =============================================================================
// SERIES DEFINITION
// =============================================================================

export interface SeriesDef {
  key: string;
  label: string;
  /** Overrides the palette position. Use for semantic colour (profit/loss). */
  color?: string;
}

// =============================================================================
// AREA CHART
// =============================================================================

export function BiAreaChart({
  data,
  xKey,
  series,
  valueFormat = "compact",
  tooltipFormat = "currency",
  xTickFormatter,
  stacked = false,
}: {
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: SeriesDef[];
  valueFormat?: keyof typeof FORMATTERS;
  tooltipFormat?: keyof typeof FORMATTERS;
  xTickFormatter?: (value: string) => string;
  stacked?: boolean;
}) {
  const yFormat = FORMATTERS[valueFormat] ?? formatCurrencyCompact;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`bi-grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color ?? seriesColor(i)} stopOpacity={0.28} />
              <stop offset="100%" stopColor={s.color ?? seriesColor(i)} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>

        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} {...axisProps} tickFormatter={xTickFormatter} minTickGap={24} />
        <YAxis {...axisProps} tickFormatter={(v) => yFormat(Number(v))} width={64} />
        <Tooltip
          content={
            <BiTooltip
              valueFormat={tooltipFormat}
              {...(xTickFormatter ? { labelFormatter: xTickFormatter } : {})}
            />
          }
          cursor={{ stroke: "var(--bi-grid)", strokeWidth: 1 }}
        />
        {series.length > 1 && (
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: "var(--bi-text)", paddingTop: 8 }}
          />
        )}

        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? seriesColor(i)}
            strokeWidth={2}
            fill={`url(#bi-grad-${s.key})`}
            stackId={stacked ? "stack" : undefined}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--bi-surface)" }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// =============================================================================
// LINE CHART
// =============================================================================

export function BiLineChart({
  data,
  xKey,
  series,
  valueFormat = "compact",
  tooltipFormat = "currency",
  xTickFormatter,
}: {
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: SeriesDef[];
  valueFormat?: keyof typeof FORMATTERS;
  tooltipFormat?: keyof typeof FORMATTERS;
  xTickFormatter?: (value: string) => string;
}) {
  const yFormat = FORMATTERS[valueFormat] ?? formatCurrencyCompact;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} {...axisProps} tickFormatter={xTickFormatter} minTickGap={24} />
        <YAxis {...axisProps} tickFormatter={(v) => yFormat(Number(v))} width={64} />
        <Tooltip
          content={
            <BiTooltip
              valueFormat={tooltipFormat}
              {...(xTickFormatter ? { labelFormatter: xTickFormatter } : {})}
            />
          }
          cursor={{ stroke: "var(--bi-grid)", strokeWidth: 1 }}
        />
        {series.length > 1 && (
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: "var(--bi-text)", paddingTop: 8 }}
          />
        )}

        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? seriesColor(i)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--bi-surface)" }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// =============================================================================
// BAR CHART
// =============================================================================

export function BiBarChart({
  data,
  xKey,
  series,
  valueFormat = "compact",
  tooltipFormat = "currency",
  xTickFormatter,
  stacked = false,
  layout = "vertical",
}: {
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: SeriesDef[];
  valueFormat?: keyof typeof FORMATTERS;
  tooltipFormat?: keyof typeof FORMATTERS;
  xTickFormatter?: (value: string) => string;
  stacked?: boolean;
  /** "vertical" = upright bars. "horizontal" = bars running left→right, which
   *  is what long category names need to stay legible. */
  layout?: "vertical" | "horizontal";
}) {
  const yFormat = FORMATTERS[valueFormat] ?? formatCurrencyCompact;
  const isHorizontal = layout === "horizontal";

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout={isHorizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 12, left: isHorizontal ? 8 : 0, bottom: 0 }}
        barCategoryGap={isHorizontal ? "18%" : "22%"}
      >
        <CartesianGrid {...gridProps} vertical={isHorizontal} horizontal={!isHorizontal} />

        {isHorizontal ? (
          <>
            <XAxis type="number" {...axisProps} tickFormatter={(v) => yFormat(Number(v))} />
            <YAxis
              type="category"
              dataKey={xKey}
              {...axisProps}
              width={132}
              tickFormatter={xTickFormatter}
            />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axisProps} tickFormatter={xTickFormatter} minTickGap={16} />
            <YAxis {...axisProps} tickFormatter={(v) => yFormat(Number(v))} width={64} />
          </>
        )}

        <Tooltip
          content={
            <BiTooltip
              valueFormat={tooltipFormat}
              {...(xTickFormatter ? { labelFormatter: xTickFormatter } : {})}
            />
          }
          cursor={{ fill: "var(--bi-grid)", fillOpacity: 0.28 }}
        />
        {series.length > 1 && (
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: "var(--bi-text)", paddingTop: 8 }}
          />
        )}

        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color ?? seriesColor(i)}
            stackId={stacked ? "stack" : undefined}
            maxBarSize={28}
            // Rounded data-end only. Rounding the baseline too would detach the
            // bar from the axis it is measured against.
            radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// =============================================================================
// PIE / DONUT
// =============================================================================

export function BiPieChart({
  data,
  nameKey,
  valueKey,
  variant = "donut",
  valueFormat = "currency",
  centerLabel,
  centerValue,
}: {
  data: Array<Record<string, unknown>>;
  nameKey: string;
  valueKey: string;
  variant?: "pie" | "donut";
  valueFormat?: keyof typeof FORMATTERS;
  /** Donut only. The figure the slices add up to. */
  centerLabel?: string;
  centerValue?: string;
}) {
  const isDonut = variant === "donut";

  // Sorting descending puts the largest slice first, which is what makes a
  // donut readable clockwise from 12 o'clock.
  const sorted = useMemo(
    () => [...data].sort((a, b) => Number(b[valueKey] ?? 0) - Number(a[valueKey] ?? 0)),
    [data, valueKey]
  );

  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={sorted}
            dataKey={valueKey}
            nameKey={nameKey}
            cx="50%"
            cy="50%"
            innerRadius={isDonut ? "58%" : 0}
            outerRadius="82%"
            paddingAngle={sorted.length > 1 ? 2 : 0}
            strokeWidth={2}
            stroke="var(--bi-surface)"
          >
            {sorted.map((_, i) => (
              <Cell key={i} fill={seriesColor(i)} />
            ))}
          </Pie>
          <Tooltip content={<BiTooltip valueFormat={valueFormat} />} />
          <Legend
            iconType="circle"
            iconSize={8}
            layout="vertical"
            align="right"
            verticalAlign="middle"
            wrapperStyle={{ fontSize: 12, color: "var(--bi-text)", paddingLeft: 12 }}
          />
        </PieChart>
      </ResponsiveContainer>

      {isDonut && centerValue && (
        // Positioned over the hole, pointer-events off so it never intercepts
        // a hover meant for a slice.
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pr-24">
          <span className="text-lg font-semibold tabular-nums">{centerValue}</span>
          {centerLabel && (
            <span className="text-xs text-muted-foreground">{centerLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// HEAT MAP
// =============================================================================

export interface HeatCell {
  row: string;
  column: string;
  value: number;
}

/**
 * A sequential heat map, rendered as a CSS grid rather than through recharts —
 * recharts has no heat-map primitive, and a scatter with square marks fights
 * its own layout at every breakpoint.
 *
 * Intensity is a single-hue ramp with the text colour flipping past the
 * midpoint, so a label on a dark cell stays readable.
 */
export function BiHeatMap({
  cells,
  rows,
  columns,
  valueFormat = "number",
  className,
}: {
  cells: HeatCell[];
  rows: string[];
  columns: string[];
  valueFormat?: keyof typeof FORMATTERS;
  className?: string;
}) {
  const format = FORMATTERS[valueFormat] ?? formatNumber;

  const { lookup, max } = useMemo(() => {
    const map = new Map<string, number>();
    let peak = 0;
    for (const c of cells) {
      map.set(`${c.row}::${c.column}`, c.value);
      if (c.value > peak) peak = c.value;
    }
    return { lookup: map, max: peak };
  }, [cells]);

  return (
    <div className={cn("bi-viz overflow-x-auto", className)}>
      <style>{VIZ_CSS}</style>
      <div
        className="grid min-w-max gap-px"
        style={{ gridTemplateColumns: `minmax(96px, auto) repeat(${columns.length}, minmax(52px, 1fr))` }}
      >
        <div />
        {columns.map((c) => (
          <div key={c} className="px-1 pb-1.5 text-center text-[11px] font-medium text-muted-foreground">
            {c}
          </div>
        ))}

        {rows.map((r) => (
          // A keyed Fragment, not a bare <> — each row emits N+1 siblings into
          // the grid, and a bare fragment cannot carry the key React needs.
          <Fragment key={r}>
            <div className="pr-2 text-right text-xs font-medium text-muted-foreground">
              {r}
            </div>
            {columns.map((c) => {
              const value = lookup.get(`${r}::${c}`) ?? 0;
              const intensity = max === 0 ? 0 : value / max;
              return (
                <div
                  key={`${r}-${c}`}
                  title={`${r} · ${c}: ${format(value)}`}
                  className="flex h-9 items-center justify-center rounded-[3px] text-[11px] font-medium tabular-nums transition-colors"
                  style={{
                    backgroundColor: `color-mix(in srgb, var(--bi-s1) ${Math.round(intensity * 100)}%, transparent)`,
                    color: intensity > 0.55 ? "#ffffff" : "var(--bi-text)",
                  }}
                >
                  {value === 0 ? "" : format(value)}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// SPARKLINE
// =============================================================================

/** A bare trend line for inline use in table cells and compact cards. */
export function BiSparkline({
  data,
  dataKey,
  color,
  height = 32,
}: {
  data: Array<Record<string, unknown>>;
  dataKey: string;
  color?: string;
  height?: number;
}) {
  return (
    <div className="bi-viz" style={{ height, width: "100%" }}>
      <style>{VIZ_CSS}</style>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color ?? "var(--bi-s1)"}
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
