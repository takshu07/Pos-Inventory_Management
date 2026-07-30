import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { formatCurrency } from "@/utils/formatters";
import type { ChartPoint, MonthlyPoint } from "../types";

/**
 * CategoryCharts — the Phase 3 chart set.
 *
 * COLOR
 * The app's design tokens cover UI chrome but define no chart series colors, so
 * this module carries its own small palette. Both modes were validated against
 * the app's ACTUAL surfaces (light #ffffff, dark #020817) for the lightness
 * band, chroma floor, colour-vision-deficiency separation, normal-vision
 * separation and 3:1 contrast — all pass. Do not substitute hues by eye;
 * re-validate if they change.
 *
 * FORM
 *  • Trend over time → area + line, both in ₹ on ONE axis. Revenue and profit
 *    share a scale, so a second y-axis is never needed. (A dual-axis chart is
 *    the single most misread chart form; two different scales get two charts.)
 *  • Magnitude across categories → horizontal bars in one hue. Category names
 *    are long, so horizontal keeps them readable without rotated ticks.
 *
 * Identity is never carried by colour alone: the trend chart has a legend, and
 * every bar is directly labelled with its value.
 */

// Validated categorical slots 1 & 2 (blue, orange), per mode.
const SERIES = {
  light: { revenue: "#2a78d6", profit: "#eb6834", bar: "#2a78d6" },
  dark: { revenue: "#3987e5", profit: "#d95926", bar: "#3987e5" },
} as const;

/**
 * Tracks the active theme. The app toggles a `.dark` class on <html>, so the
 * chart cannot rely on a media query alone — a viewer on a light OS with the
 * app in dark mode must still get the dark steps.
 */
function useChartTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
      ? "dark"
      : "light"
  );

  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setTheme(el.classList.contains("dark") ? "dark" : "light");
    const observer = new MutationObserver(sync);
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    sync();
    return () => observer.disconnect();
  }, []);

  return theme;
}

const AXIS = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

const compactCurrency = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
  if (abs >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `₹${Math.round(v / 1000)}k`;
  return `₹${v}`;
};

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  return new Date(Number(y), Number(m) - 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "2-digit",
  });
};

function ChartShell({
  title,
  subtitle,
  height = 280,
  isEmpty,
  children,
}: {
  title: string;
  subtitle?: string;
  height?: number;
  isEmpty: boolean;
  children: React.ReactElement;
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent className="flex-1">
        {isEmpty ? (
          <div
            style={{ height }}
            className="flex items-center justify-center text-sm text-muted-foreground"
          >
            No data for the selected period.
          </div>
        ) : (
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              {children}
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TooltipBox({
  label,
  rows,
}: {
  label: string;
  rows: { name: string; value: string; color: string }[];
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
      <p className="mb-2 text-sm font-medium text-foreground">{label}</p>
      <div className="flex flex-col gap-1 text-xs">
        {rows.map((r) => (
          <span key={r.name} className="flex items-center gap-2 text-muted-foreground">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: r.color }}
              aria-hidden
            />
            {r.name}:&nbsp;<span className="font-medium text-foreground">{r.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Revenue & profit over time. Both series are ₹ — one shared axis. */
export function CategoryTrendChart({
  data,
  title = "Revenue & profit trend",
}: {
  data: MonthlyPoint[];
  title?: string;
}) {
  const c = SERIES[useChartTheme()];

  return (
    <ChartShell title={title} isEmpty={data.length === 0} height={300}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="catRevenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={c.revenue} stopOpacity={0.28} />
            <stop offset="95%" stopColor={c.revenue} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          vertical={false}
          stroke="hsl(var(--border))"
          opacity={0.6}
        />
        <XAxis
          dataKey="month"
          tickFormatter={monthLabel}
          axisLine={false}
          tickLine={false}
          tick={AXIS}
          dy={8}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={AXIS}
          tickFormatter={compactCurrency}
          width={64}
        />
        <Tooltip
          cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox
                label={monthLabel(String(label))}
                rows={[
                  { name: "Revenue", value: formatCurrency(Number(payload[0]?.value ?? 0)), color: c.revenue },
                  { name: "Profit", value: formatCurrency(Number(payload[1]?.value ?? 0)), color: c.profit },
                ]}
              />
            ) : null
          }
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={28}
          iconType="circle"
          iconSize={8}
          formatter={(value) => (
            <span className="text-xs text-muted-foreground">{value}</span>
          )}
        />
        <Area
          name="Revenue"
          type="monotone"
          dataKey="revenue"
          stroke={c.revenue}
          strokeWidth={2}
          fill="url(#catRevenueFill)"
          fillOpacity={1}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }}
        />
        <Line
          name="Profit"
          type="monotone"
          dataKey="profit"
          stroke={c.profit}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }}
        />
      </AreaChart>
    </ChartShell>
  );
}

/**
 * Magnitude across categories. One hue — the bars are the same kind of thing,
 * so colour carries no extra meaning and must not pretend otherwise.
 */
export function CategoryRankBarChart({
  data,
  title,
  subtitle,
  valueType = "currency",
}: {
  data: ChartPoint[];
  title: string;
  subtitle?: string;
  valueType?: "currency" | "number" | "percent";
}) {
  const c = SERIES[useChartTheme()];

  const format = (v: number) =>
    valueType === "currency"
      ? formatCurrency(v)
      : valueType === "percent"
        ? `${v}%`
        : v.toLocaleString("en-IN");

  const axisFormat = (v: number) =>
    valueType === "currency" ? compactCurrency(v) : valueType === "percent" ? `${v}%` : String(v);

  // Give long category names room without rotating ticks.
  const height = Math.max(200, data.length * 34 + 40);

  return (
    <ChartShell title={title} subtitle={subtitle} isEmpty={data.length === 0} height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 56, left: 4, bottom: 4 }}
        barCategoryGap={6}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          horizontal={false}
          stroke="hsl(var(--border))"
          opacity={0.6}
        />
        <XAxis
          type="number"
          axisLine={false}
          tickLine={false}
          tick={AXIS}
          tickFormatter={axisFormat}
        />
        <YAxis
          type="category"
          dataKey="name"
          axisLine={false}
          tickLine={false}
          tick={AXIS}
          width={110}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipBox
                label={String(payload[0]?.payload?.name ?? "")}
                rows={[
                  { name: title, value: format(Number(payload[0]?.value ?? 0)), color: c.bar },
                ]}
              />
            ) : null
          }
        />
        <Bar
          dataKey="value"
          fill={c.bar}
          radius={[0, 4, 4, 0]}
          label={{
            position: "right",
            // Recharts hands the label a RenderableText (string | number |
            // undefined), not the raw datum — coerce before formatting.
            formatter: (label: unknown) => format(Number(label ?? 0)),
            fontSize: 11,
            fill: "hsl(var(--muted-foreground))",
          }}
        >
          {/* Explicit cells keep the fill stable if Recharts ever cycles. */}
          {data.map((d) => (
            <Cell key={d.name} fill={c.bar} />
          ))}
        </Bar>
      </BarChart>
    </ChartShell>
  );
}
