/**
 * Performance — the sales leaderboard.
 *
 * Ranking is the whole point of this page, so the rank comes from the SERVER
 * and is rendered, never recomputed. If the client re-sorted, two people
 * looking at the same period could see different #1s the moment a tie-break
 * rule differed by a hair.
 *
 * The table carries the detail (returns, discounts, attendance); the chart
 * carries the comparison. Revenue across employees is a magnitude, not a set of
 * series, so its chart is a single-hue bar list with direct value labels rather
 * than a categorical palette.
 */

import { useMemo, useState } from "react";
import {
  BadgePercent, GitCompare, IndianRupee, Package, Receipt, Trophy, Undo2,
} from "lucide-react";

import {
  Button, Card, EmptyState, ErrorState, Select, Table, TableBody, TableCell,
  TableHead, TableHeader, TableRow,
} from "@/components/ui";
import { cn } from "@/utils/cn";
import { EmployeeAvatar } from "../components/EmployeeAvatar";
import { RoleBadge } from "../components/EmployeeStatusBadge";
import { EmployeeTableSkeleton } from "../components/EmployeeSkeleton";
import { canManageEmployees } from "@/features/auth";
import { useAuthStore } from "@/store/auth.store";
import { EmployeeComparison } from "../components/EmployeeComparison";
import { ExportMenu } from "../components/ExportMenu";
import { ChartCard, RevenueByEmployeeChart } from "../components/WorkforceCharts";
import { StatCard } from "../components/WorkforceStatCards";
import { usePerformance } from "../hooks/useWorkforce";
import {
  formatCurrency, formatOptionalPercent, formatPercent, formatScore, scoreAccent,
} from "../utils/format";
import type { PerformanceRow, WorkforcePeriod } from "../types";

const PERIOD_OPTIONS: Array<{ value: WorkforcePeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
  { value: "year", label: "This year" },
];

const ROLE_OPTIONS = [
  { value: "", label: "Everyone" },
  { value: "MANAGER", label: "Managers only" },
  { value: "CASHIER", label: "Cashiers only" },
];

const METRIC_OPTIONS = [
  { value: "revenue", label: "By revenue" },
  { value: "transactions", label: "By transactions" },
];

/** Medal colouring for the top three. Rank 4+ gets a plain number. */
function RankCell({ rank }: { rank: number }) {
  const medal =
    rank === 1
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      : rank === 2
        ? "bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200"
        : rank === 3
          ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
          : null;

  if (!medal) {
    return <span className="tabular-nums text-muted-foreground">{rank}</span>;
  }

  return (
    <span
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold tabular-nums",
        medal
      )}
    >
      {rank}
    </span>
  );
}

export default function PerformancePage() {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const canManage = canManageEmployees(role);

  const [period, setPeriod] = useState<WorkforcePeriod>("month");
  const [roleFilter, setRoleFilter] = useState("");
  const [metric, setMetric] = useState<"revenue" | "transactions">("revenue");
  const [comparing, setComparing] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = usePerformance({
    period,
    ...(roleFilter ? { role: roleFilter as PerformanceRow["role"] } : {}),
  });

  const rows = data?.data ?? [];

  /**
   * Team aggregates. Computed here rather than fetched: they are pure sums of
   * a page the client already holds, so a second endpoint would be a round trip
   * that could also drift from what the table shows.
   *
   * The average score deliberately skips unscored employees rather than
   * counting them as 0 — averaging in "no target set" would drag the team score
   * down for a configuration gap.
   */
  const totals = useMemo(() => {
    const scored = rows.filter((r) => r.performanceScore != null);

    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const transactions = rows.reduce((s, r) => s + r.transactions, 0);

    return {
      revenue,
      transactions,
      averageBill: transactions > 0 ? revenue / transactions : 0,
      unitsSold: rows.reduce((s, r) => s + r.unitsSold, 0),
      returns: rows.reduce((s, r) => s + r.returns, 0),
      refundValue: rows.reduce((s, r) => s + r.refundValue, 0),
      discountGiven: rows.reduce((s, r) => s + r.discountGiven, 0),
      averageScore:
        scored.length > 0
          ? scored.reduce((s, r) => s + (r.performanceScore ?? 0), 0) / scored.length
          : null,
    };
  }, [rows]);

  /** Top and bottom five by revenue, for the two comparison charts. */
  const topFive = useMemo(() => rows.slice(0, 5), [rows]);
  const bottomFive = useMemo(
    // Only employees who actually sold something — an employee with no sales is
    // an attendance question, not a performance one.
    () => rows.filter((r) => r.revenue > 0).slice(-5).reverse(),
    [rows]
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Performance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sales leaderboard for the selected period — revenue, transactions, returns and
          discounts per employee.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Select
          className="w-auto min-w-[9rem]"
          options={PERIOD_OPTIONS}
          value={period}
          onChange={(e) => setPeriod(e.target.value as WorkforcePeriod)}
          aria-label="Period"
        />
        <Select
          className="w-auto min-w-[10rem]"
          options={ROLE_OPTIONS}
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by role"
        />
        <div className="ml-auto flex items-center gap-2">
          {data && (
            <p className="text-xs text-muted-foreground">
              {new Date(data.period.from).toLocaleDateString()} –{" "}
              {new Date(data.period.to).toLocaleDateString()}
              {isFetching && " · updating…"}
            </p>
          )}

          {/* Comparison is owner-only — the endpoint 403s for a manager, so
              offering the button to them would be a dead end. */}
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setComparing(true)}
              leftIcon={<GitCompare className="h-3.5 w-3.5" />}
            >
              Compare
            </Button>
          )}

          <ExportMenu
            report="performance"
            filters={{ period, ...(roleFilter ? { role: roleFilter } : {}) }}
            disabled={rows.length === 0}
          />
        </div>
      </div>

      {/* Aggregate strip — the team's totals, so a leaderboard row can be read
          as a share of something rather than as a bare number. */}
      {!isLoading && rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <StatCard icon={IndianRupee} label="Revenue" value={formatCurrency(totals.revenue)} />
          <StatCard icon={Receipt} label="Transactions" value={String(totals.transactions)} />
          <StatCard icon={IndianRupee} label="Avg Bill" value={formatCurrency(totals.averageBill)} />
          <StatCard icon={Package} label="Units Sold" value={String(totals.unitsSold)} />
          <StatCard
            icon={Undo2}
            label="Returns"
            value={String(totals.returns)}
            accent={totals.returns > 0 ? "text-destructive" : undefined}
          />
          <StatCard icon={IndianRupee} label="Refunds" value={formatCurrency(totals.refundValue)} />
          <StatCard icon={BadgePercent} label="Discounts" value={formatCurrency(totals.discountGiven)} />
          <StatCard
            icon={Trophy}
            label="Avg Score"
            value={formatScore(totals.averageScore)}
            accent={scoreAccent(totals.averageScore)}
          />
        </div>
      )}

      {isError ? (
        <ErrorState message="Failed to load performance." onRetry={() => refetch()} />
      ) : !isLoading && rows.length === 0 ? (
        <EmptyState
          icon={<Trophy className="h-8 w-8 text-muted-foreground" />}
          title="No sales in this period"
          description="Nobody recorded a sale in the selected period. Try a wider range."
        />
      ) : (
        <>
          <ChartCard
            title={metric === "revenue" ? "Revenue by employee" : "Transactions by employee"}
            description="Top performers in the selected period."
            action={
              <Select
                className="w-auto min-w-[9.5rem]"
                options={METRIC_OPTIONS}
                value={metric}
                onChange={(e) => setMetric(e.target.value as "revenue" | "transactions")}
                aria-label="Chart metric"
              />
            }
          >
            <RevenueByEmployeeChart rows={rows} isLoading={isLoading} metric={metric} />
          </ChartCard>

          {/* Top and bottom side by side. Seeing them together is the point —
              the gap between them is the number a manager acts on. */}
          {bottomFive.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="Top performers" description="Highest revenue in this period.">
                <RevenueByEmployeeChart rows={topFive} metric="revenue" limit={5} />
              </ChartCard>
              <ChartCard
                title="Needs attention"
                description="Lowest revenue among employees who recorded sales."
              >
                <RevenueByEmployeeChart rows={bottomFive} metric="revenue" limit={5} />
              </ChartCard>
            </div>
          )}

          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead className="min-w-[14rem]">Employee</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Txns</TableHead>
                  <TableHead className="text-right">Avg Bill</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Returns</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Attendance</TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {isLoading ? (
                  <EmployeeTableSkeleton columns={12} />
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <RankCell rank={row.rank} />
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center gap-3">
                          <EmployeeAvatar
                            id={row.id}
                            firstName={row.fullName.split(" ")[0] ?? ""}
                            lastName={row.fullName.split(" ")[1] ?? ""}
                            photoUrl={row.photoUrl}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{row.fullName}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {row.employeeCode}
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        <RoleBadge role={row.role} />
                      </TableCell>

                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(row.revenue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.transactions}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(row.averageBill)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.unitsSold}</TableCell>

                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          row.returns > 0 && "text-destructive"
                        )}
                      >
                        {row.returns > 0 ? (
                          <>
                            {row.returns}
                            <span className="ml-1 text-[11px] text-muted-foreground">
                              {formatCurrency(row.refundValue)}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>

                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(row.discountGiven)}
                        <span
                          className={cn(
                            "ml-1 text-[11px]",
                            // A discount rate above 10% is the number worth a
                            // second look — the same threshold the drawer flags.
                            row.discountPercentage > 10
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                          )}
                        >
                          {formatPercent(row.discountPercentage, 0)}
                        </span>
                      </TableCell>

                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          row.attendancePercentage >= 90
                            ? "text-emerald-600 dark:text-emerald-400"
                            : row.attendancePercentage >= 75
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-destructive"
                        )}
                      >
                        {formatPercent(row.attendancePercentage, 0)}
                      </TableCell>

                      {/* Both are NULL without a target. "Not set" is the
                          honest rendering — 0% would read as total failure. */}
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={cn(
                            row.targetAchievement == null
                              ? "text-muted-foreground"
                              : row.targetAchievement >= 100
                                ? "text-emerald-600 dark:text-emerald-400"
                                : row.targetAchievement >= 75
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-destructive"
                          )}
                        >
                          {formatOptionalPercent(row.targetAchievement)}
                        </span>
                      </TableCell>

                      <TableCell className="text-right font-medium tabular-nums">
                        <span className={scoreAccent(row.performanceScore)}>
                          {formatScore(row.performanceScore)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {/* Candidates come from the leaderboard already on screen, so the picker
          lists the people in the context that prompted the comparison. */}
      <EmployeeComparison
        open={comparing}
        onClose={() => setComparing(false)}
        candidates={rows}
      />
    </div>
  );
}
