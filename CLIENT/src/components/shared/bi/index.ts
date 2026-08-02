/**
 * Business Intelligence kit — public barrel.
 *
 * The Cash Register, Finance and Reports features all import from HERE, never
 * from individual files. That is what makes the three modules look like one
 * product: a KPI card, a chart palette, a filter bar and an export menu behave
 * identically on every screen because there is exactly one of each.
 *
 * Correct: import { KpiCard, ChartShell } from "@/components/shared/bi"
 * Wrong:   import { KpiCard } from "@/components/shared/bi/KpiCard"
 */

// ── Formatting & status vocabulary ──────────────────────────────────────────
export * from "./format";

// ── KPI surfaces ────────────────────────────────────────────────────────────
export {
  KpiCard,
  KpiGrid,
  KpiCardSkeleton,
  KpiGridSkeleton,
  AnimatedNumber,
  TrendIndicator,
  StatRow,
} from "./KpiCard";
export type { KpiCardProps, TrendDirection } from "./KpiCard";

// ── Charts ──────────────────────────────────────────────────────────────────
export {
  ChartShell,
  BiAreaChart,
  BiLineChart,
  BiBarChart,
  BiPieChart,
  BiHeatMap,
  BiSparkline,
  seriesColor,
  SERIES_VARS,
} from "./Charts";
export type { ChartShellProps, SeriesDef, HeatCell } from "./Charts";

// ── Filters ─────────────────────────────────────────────────────────────────
export {
  FilterBar,
  ActiveFilterChips,
  DebouncedSearch,
  cleanFilters,
  activeFilterCount,
  DEFAULT_FILTERS,
  PERIOD_OPTIONS,
} from "./FilterBar";
export type {
  FilterBarProps,
  ReportFilterState,
  FilterOptions,
  FilterKey,
  PeriodKeyword,
} from "./FilterBar";

// ── Export ──────────────────────────────────────────────────────────────────
export { ExportMenu, downloadExport } from "./ExportMenu";
export type { ExportMenuProps, ExportFormat } from "./ExportMenu";

// ── Tables ──────────────────────────────────────────────────────────────────
export { ReportTable } from "./ReportTable";
export type { ReportColumn, ReportTableProps } from "./ReportTable";

// ── Page scaffolding ────────────────────────────────────────────────────────
export { PageHeader, SectionHeader, MetricPanel } from "./PageHeader";
