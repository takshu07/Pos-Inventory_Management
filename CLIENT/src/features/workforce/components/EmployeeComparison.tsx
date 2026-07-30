/**
 * Side-by-side comparison of two employees (OWNER only).
 *
 * A drawer on the Performance page rather than a new route: comparing is a
 * performance question, and the two people being compared are chosen from the
 * leaderboard already on screen. A separate page would mean navigating away
 * from the context that prompted the comparison.
 *
 * Each metric row marks a winner, but only where "more" or "less" is
 * unambiguously better. Revenue higher is better; refunds lower is better;
 * hours worked is NEITHER — more hours is not a better employee — so it is
 * shown without a verdict.
 */

import { useState } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { Drawer, ErrorState, Select, Skeleton } from "@/components/ui";
import { cn } from "@/utils/cn";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { RoleBadge } from "./EmployeeStatusBadge";
import { useComparison } from "../hooks/useWorkforce";
import {
  formatCurrency, formatDuration, formatOptionalPercent, formatPercent, formatScore,
} from "../utils/format";
import type { ComparisonSide, PerformanceRow, WorkforcePeriod } from "../types";

const PERIOD_OPTIONS: Array<{ value: WorkforcePeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
  { value: "year", label: "This year" },
];

/**
 * `better` says which direction wins:
 *   "high"    more is better (revenue, units)
 *   "low"     less is better (returns, discounts)
 *   "neutral" no verdict — comparing them is informative, not a judgement
 */
type Direction = "high" | "low" | "neutral";

interface MetricSpec {
  label: string;
  get: (side: ComparisonSide) => number | null;
  format: (value: number | null) => string;
  better: Direction;
}

const METRICS: MetricSpec[] = [
  { label: "Revenue", get: (s) => s.revenue, format: formatCurrency, better: "high" },
  { label: "Transactions", get: (s) => s.transactions, format: (v) => String(v ?? 0), better: "high" },
  { label: "Average bill", get: (s) => s.averageBill, format: formatCurrency, better: "high" },
  { label: "Units sold", get: (s) => s.unitsSold, format: (v) => String(v ?? 0), better: "high" },
  { label: "Returns", get: (s) => s.returns, format: (v) => String(v ?? 0), better: "low" },
  { label: "Refund value", get: (s) => s.refundValue, format: formatCurrency, better: "low" },
  { label: "Exchanges", get: (s) => s.exchanges, format: (v) => String(v ?? 0), better: "low" },
  {
    label: "Discount given",
    get: (s) => s.discountGiven,
    format: formatCurrency,
    better: "low",
  },
  {
    label: "Attendance",
    get: (s) => s.attendancePercentage,
    format: (v) => formatPercent(v ?? 0),
    better: "high",
  },
  {
    label: "Hours worked",
    get: (s) => s.workedMinutes,
    format: (v) => formatDuration(v ?? 0),
    // More hours is not "better" — it may mean overtime, or a longer shift.
    better: "neutral",
  },
  {
    label: "Late by",
    get: (s) => s.lateMinutes,
    format: (v) => formatDuration(v ?? 0),
    better: "low",
  },
  {
    label: "Target achieved",
    get: (s) => s.targetAchievement,
    format: (v) => formatOptionalPercent(v),
    better: "high",
  },
  {
    label: "Performance score",
    get: (s) => s.performanceScore,
    format: (v) => formatScore(v),
    better: "high",
  },
];

export function EmployeeComparison({
  open,
  onClose,
  candidates,
}: {
  open: boolean;
  onClose: () => void;
  /** Usually the current leaderboard, so the picker lists people in context. */
  candidates: PerformanceRow[];
}) {
  const [employeeA, setEmployeeA] = useState("");
  const [employeeB, setEmployeeB] = useState("");
  const [period, setPeriod] = useState<WorkforcePeriod>("month");

  const bothChosen = Boolean(employeeA && employeeB && employeeA !== employeeB);

  const { data, isLoading, isError, refetch } = useComparison(
    { employeeA, employeeB, period },
    open && bothChosen
  );

  const options = (exclude: string) => [
    { value: "", label: "Select an employee…" },
    ...candidates
      .filter((c) => c.id !== exclude)
      .map((c) => ({ value: c.id, label: c.fullName })),
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Compare employees"
      description="Side by side over the same period."
      width="w-full max-w-3xl"
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <Select
            options={options(employeeB)}
            value={employeeA}
            onChange={(e) => setEmployeeA(e.target.value)}
            aria-label="First employee"
          />
          <Select
            options={options(employeeA)}
            value={employeeB}
            onChange={(e) => setEmployeeB(e.target.value)}
            aria-label="Second employee"
          />
        </div>

        <Select
          className="w-auto min-w-[10rem]"
          options={PERIOD_OPTIONS}
          value={period}
          onChange={(e) => setPeriod(e.target.value as WorkforcePeriod)}
          aria-label="Period"
        />

        {!bothChosen ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Choose two employees to compare.
          </p>
        ) : isError ? (
          <ErrorState message="Failed to load the comparison." onRetry={() => refetch()} />
        ) : isLoading || !data ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <SideHeader side={data.a} />
              <SideHeader side={data.b} />
            </div>

            <div className="flex flex-col">
              {METRICS.map((metric) => (
                <MetricRow key={metric.label} metric={metric} a={data.a} b={data.b} />
              ))}
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

function SideHeader({ side }: { side: ComparisonSide }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <EmployeeAvatar
        id={side.id}
        firstName={side.fullName.split(" ")[0] ?? ""}
        lastName={side.fullName.split(" ")[1] ?? ""}
        photoUrl={side.photoUrl}
      />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{side.fullName}</div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <RoleBadge role={side.role} />
        </div>
      </div>
    </div>
  );
}

function MetricRow({
  metric,
  a,
  b,
}: {
  metric: MetricSpec;
  a: ComparisonSide;
  b: ComparisonSide;
}) {
  const av = metric.get(a);
  const bv = metric.get(b);

  /**
   * Which side wins. Null means "no verdict" — either the metric is neutral,
   * the values tie, or one side has no value at all (an unset target must not
   * lose to a set one; that compares configuration, not performance).
   */
  let winner: "a" | "b" | null = null;
  if (metric.better !== "neutral" && av != null && bv != null && av !== bv) {
    const aWins = metric.better === "high" ? av > bv : av < bv;
    winner = aWins ? "a" : "b";
  }

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border/60 py-2 last:border-0">
      <div className={cn("text-right text-sm tabular-nums", winner === "a" && "font-semibold")}>
        {metric.format(av)}
        {winner === "a" && <WinnerMark direction={metric.better} />}
      </div>

      <div className="w-32 shrink-0 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
        {metric.label}
      </div>

      <div className={cn("text-left text-sm tabular-nums", winner === "b" && "font-semibold")}>
        {winner === "b" && <WinnerMark direction={metric.better} />}
        {metric.format(bv)}
      </div>
    </div>
  );
}

/** Arrow direction reflects the METRIC, not the winner — down is good for returns. */
function WinnerMark({ direction }: { direction: Direction }) {
  const Icon = direction === "high" ? TrendingUp : direction === "low" ? TrendingDown : Minus;
  return (
    <Icon
      className="mx-1 inline h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
      aria-label="Better"
    />
  );
}
