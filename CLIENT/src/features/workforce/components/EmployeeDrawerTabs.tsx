/**
 * The eight tab bodies for the employee drawer.
 *
 * Each tab owns its own query, and every query is `enabled`-gated on that tab
 * being active. That is the whole point of the split: opening a drawer fires
 * ONE request, not eight. A visited tab stays in the React Query cache, so
 * returning to it is instant without re-fetching.
 *
 * The tabs render nothing the module already renders elsewhere — Attendance
 * reuses AttendanceTable, Activity reuses EmployeeTimeline, Login History
 * reuses LoginHistoryTable. A drawer is a different FRAME around the same data,
 * not a second implementation of it.
 *
 * Two rules that recur throughout:
 *   • A nullable metric (target achievement, performance score, sales/hour)
 *     renders "Not set" or "—", never 0. A missing configuration must not be
 *     presentable as a failing number.
 *   • Notes are OWNER-ONLY. The tab is not offered to a manager, and the query
 *     behind it is gated on the same check — a manager never issues the request.
 */

import { useMemo, useState } from "react";
import {
  Award, Building2, CalendarDays, GraduationCap, Mail, MapPin, Monitor,
  Phone, Pin, Plus, ShieldAlert, ShieldCheck, Trash2, Wallet,
} from "lucide-react";

import {
  Badge, Button, Card, EmptyState, ErrorState, Input, Pagination, Select, Skeleton,
} from "@/components/ui";
import { cn } from "@/utils/cn";
import { AttendanceTable } from "./AttendanceTable";
import { EmployeeTimeline } from "./EmployeeTimeline";
import { LoginHistoryTable } from "./LoginHistoryTable";
import { AttendanceBadge, EmploymentBadge, PresenceDot } from "./EmployeeStatusBadge";
import { AttendanceCalendar } from "./AttendanceCalendar";
import { ChartCard, Sparkline, WorkingHoursChart } from "./WorkforceCharts";
import {
  useCreateNote,
  useDeleteNote,
  useEmployeeActivity,
  useEmployeeAttendance,
  useEmployeeLoginHistory,
  useEmployeeNotes,
  useEmployeePermissions,
  useEmployeeSales,
  usePerformance,
  useUpdateNote,
} from "../hooks/useWorkforce";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDuration,
  formatOptionalPercent,
  formatPercent,
  formatRelative,
  formatScore,
  formatShiftWindow,
  formatTime,
  scoreAccent,
  NOTE_CATEGORY_LABELS,
  NOTE_CATEGORY_VARIANTS,
} from "../utils/format";
import type {
  EmployeeNoteCategory,
  WorkforceEmployeeDetail,
  WorkforcePeriod,
} from "../types";

export type DrawerTab =
  | "overview"
  | "sales"
  | "attendance"
  | "performance"
  | "activity"
  | "sessions"
  | "permissions"
  | "notes";

/**
 * Tab order follows how a reader actually investigates someone: who they are,
 * what they sold, whether they showed up, how that ranks, what they did, how
 * they signed in, what they may do, and finally what has been written about
 * them. `ownerOnly` tabs are filtered out of the bar entirely for a manager.
 */
export const DRAWER_TABS: Array<{ id: DrawerTab; label: string; ownerOnly?: boolean }> = [
  { id: "overview", label: "Overview" },
  { id: "sales", label: "Sales" },
  { id: "attendance", label: "Attendance" },
  { id: "performance", label: "Performance" },
  { id: "activity", label: "Activity" },
  { id: "sessions", label: "Login History" },
  { id: "permissions", label: "Permissions" },
  { id: "notes", label: "Notes", ownerOnly: true },
];

const PERIOD_OPTIONS: Array<{ value: WorkforcePeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
  { value: "year", label: "This year" },
];

/** Drawer rows are narrower than page rows, so one page is 10, not 20. */
const DRAWER_PAGE_SIZE = 10;

// =============================================================================
// SHARED BITS
// =============================================================================

function Section({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon?: React.ElementType;
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm">{value}</dd>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent?: string;
  hint?: string;
}) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-base font-bold tabular-nums", accent)}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function TabSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

function PeriodSelect({
  value,
  onChange,
}: {
  value: WorkforcePeriod;
  onChange: (v: WorkforcePeriod) => void;
}) {
  return (
    <Select
      className="w-auto min-w-[9rem]"
      options={PERIOD_OPTIONS}
      value={value}
      onChange={(e) => onChange(e.target.value as WorkforcePeriod)}
      aria-label="Period"
    />
  );
}

// =============================================================================
// 1 — OVERVIEW
//
// The only tab with no query of its own: the drawer already loaded the detail
// record for its header, so re-fetching here would be a wasted round trip.
// =============================================================================

export function OverviewTab({
  employee,
  isLoading,
}: {
  employee: WorkforceEmployeeDetail | undefined;
  isLoading: boolean;
}) {
  if (isLoading || !employee) return <TabSkeleton rows={8} />;

  return (
    <div className="flex flex-col gap-6">
      <Section title="Today">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Sales" value={formatCurrency(employee.todayRevenue)} />
          <Metric label="Transactions" value={String(employee.todayTransactions)} />
          <Metric
            label="Worked"
            value={formatDuration(employee.workedMinutesToday)}
            hint={employee.clockInAt ? `In at ${formatTime(employee.clockInAt)}` : "Not clocked in"}
          />
          <Metric
            label="Late by"
            value={employee.lateMinutesToday > 0 ? formatDuration(employee.lateMinutesToday) : "—"}
            accent={employee.lateMinutesToday > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
          />
        </div>
      </Section>

      <Section title="Current session">
        <div className="flex flex-wrap items-center gap-2">
          <PresenceDot presence={employee.presence} withLabel />
          <AttendanceBadge status={employee.attendanceStatus} />
          <EmploymentBadge status={employee.employmentStatus} />
          {!employee.isActive && <Badge variant="destructive">Account deactivated</Badge>}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field
            icon={Monitor}
            label="Current device"
            value={employee.device ?? "—"}
          />
          <Field
            label="Signed in"
            value={
              employee.presence === "ONLINE" && employee.sessionStartedAt
                ? formatRelative(employee.sessionStartedAt)
                : "Not signed in"
            }
          />
        </dl>

        {employee.currentActivity && (
          <p className="text-xs text-muted-foreground">
            Last action: {employee.currentActivity} · {formatRelative(employee.currentActivityAt)}
          </p>
        )}
      </Section>

      <Section title="Contact">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field icon={Phone} label="Phone" value={employee.phone} />
          <Field icon={Mail} label="Email" value={employee.email ?? "—"} />
          <Field icon={MapPin} label="Address" value={employee.address ?? "—"} className="col-span-2" />
          <Field
            label="Emergency contact"
            value={
              employee.emergencyContactName
                ? `${employee.emergencyContactName}${
                    employee.emergencyContactRelation
                      ? ` (${employee.emergencyContactRelation})`
                      : ""
                  }`
                : "—"
            }
          />
          <Field label="Emergency phone" value={employee.emergencyContactPhone ?? "—"} />
        </dl>
      </Section>

      <Section title="Employment">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Employee ID" value={employee.employeeCode} />
          <Field label="Role" value={employee.role} />
          <Field icon={CalendarDays} label="Joined" value={formatDate(employee.joiningDate)} />
          <Field icon={Building2} label="Assigned store" value={employee.storeCode ?? "—"} />
          <Field
            icon={Monitor}
            label="Assigned register"
            value={employee.assignedRegister ?? "Unassigned"}
          />
          <Field
            label="Monthly target"
            value={
              employee.monthlyTarget != null ? formatCurrency(employee.monthlyTarget) : "Not set"
            }
          />
          <Field
            label="Shift"
            value={
              employee.shift
                ? `${employee.shift.name} · ${formatShiftWindow(
                    employee.shift.startMinute,
                    employee.shift.endMinute
                  )}`
                : "Unassigned"
            }
            className="col-span-2"
          />
          {/* Salary is absent from the payload entirely for a manager — the
              server strips it, so the missing key (not a client check) hides it. */}
          {employee.salary != null && (
            <Field icon={Wallet} label="Salary" value={formatCurrency(Number(employee.salary))} />
          )}
          {employee.exitDate && <Field label="Exit date" value={formatDate(employee.exitDate)} />}
        </dl>
      </Section>

      <Section title="Personal">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Date of birth" value={formatDate(employee.dateOfBirth)} />
          <Field label="Gender" value={employee.gender ?? "—"} />
          <Field label="Last login" value={formatRelative(employee.lastLogin)} />
          <Field label="Record created" value={formatDate(employee.createdAt)} />
        </dl>
      </Section>
    </div>
  );
}

// =============================================================================
// 2 — SALES
// =============================================================================

export function SalesTab({
  employeeId,
  active,
}: {
  employeeId: string | undefined;
  active: boolean;
}) {
  const [period, setPeriod] = useState<WorkforcePeriod>("month");
  const { data, isLoading, isError, refetch } = useEmployeeSales(employeeId, { period }, active);

  if (isError) return <ErrorState message="Failed to load sales." onRetry={() => refetch()} />;
  if (isLoading || !data) return <TabSkeleton rows={6} />;

  const trendValues = data.trend.map((t) => t.revenue);

  return (
    <div className="flex flex-col gap-5">
      <Section title="Performance" action={<PeriodSelect value={period} onChange={setPeriod} />}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Metric label="Revenue" value={formatCurrency(data.periodRevenue)} />
          <Metric label="Transactions" value={String(data.periodTransactions)} />
          <Metric label="Average bill" value={formatCurrency(data.averageBillValue)} />
          <Metric label="Units sold" value={String(data.unitsSold)} />
          <Metric label="Customers served" value={String(data.customerCount)} />
          <Metric
            label="Sales per hour"
            // Null means no hours clocked. "₹0/hr" would claim they sold
            // nothing during hours they never worked.
            value={data.salesPerHour != null ? `${formatCurrency(data.salesPerHour)}/hr` : "—"}
            hint={
              data.workedMinutes > 0 ? `over ${formatDuration(data.workedMinutes)}` : "No hours recorded"
            }
          />
        </div>
      </Section>

      <Section title="Returns & exchanges">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric
            label="Returns"
            value={String(data.returns)}
            accent={data.returns > 0 ? "text-destructive" : undefined}
          />
          <Metric label="Refund value" value={formatCurrency(data.returnsValue)} />
          <Metric label="Exchanges" value={String(data.exchanges)} />
          <Metric label="Exchange value" value={formatCurrency(data.exchangeValue)} />
        </div>
      </Section>

      <Section title="Top category">
        <Card className="flex items-center justify-between gap-4 p-3">
          {data.topCategory ? (
            <>
              <div className="min-w-0">
                <div className="truncate text-base font-bold capitalize">{data.topCategory}</div>
                <div className="text-[11px] text-muted-foreground">
                  {data.topCategoryUnits} unit{data.topCategoryUnits === 1 ? "" : "s"} sold
                </div>
              </div>
              <Award className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Nothing sold in this period.</span>
          )}
        </Card>
      </Section>

      <Section title="Discounts given">
        <Card className="flex items-center justify-between gap-4 p-3">
          <div>
            <div className="text-base font-bold tabular-nums">
              {formatCurrency(data.discountGiven)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {formatPercent(data.discountPercentage)} of gross sales
            </div>
          </div>
          {/* The number an owner opens this tab to check. */}
          {data.discountPercentage > 10 && <Badge variant="warning">Above 10%</Badge>}
        </Card>
      </Section>

      {trendValues.length >= 2 && (
        <ChartCard title="Revenue trend" description="Daily revenue over the selected period.">
          <Sparkline values={trendValues} />
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{formatDate(data.trend[0]?.date)}</span>
            <span>{formatDate(data.trend[data.trend.length - 1]?.date)}</span>
          </div>
        </ChartCard>
      )}

      <Section title="Lifetime">
        <div className="grid grid-cols-3 gap-2">
          <Metric label="Today" value={formatCurrency(data.todayRevenue)} />
          <Metric label="This week" value={formatCurrency(data.weeklyRevenue)} />
          <Metric label="This month" value={formatCurrency(data.monthlyRevenue)} />
        </div>
      </Section>
    </div>
  );
}

// =============================================================================
// 3 — ATTENDANCE
// =============================================================================

export function AttendanceTab({
  employeeId,
  active,
}: {
  employeeId: string | undefined;
  active: boolean;
}) {
  const [period, setPeriod] = useState<WorkforcePeriod>("month");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useEmployeeAttendance(
    employeeId,
    { period, page, limit: DRAWER_PAGE_SIZE },
    active
  );

  if (isError) return <ErrorState message="Failed to load attendance." onRetry={() => refetch()} />;
  if (isLoading || !data) return <TabSkeleton rows={7} />;

  const { records, summary, total, totalPages } = data;

  const breakMinutes = records.reduce((sum, r) => sum + (r.breakMinutes ?? 0), 0);
  const lateArrivals = records.filter((r) => r.lateMinutes > 0).length;
  const leaves = summary.counts.ON_LEAVE ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Attendance"
        action={
          <PeriodSelect
            value={period}
            onChange={(v) => {
              setPeriod(v);
              setPage(1);
            }}
          />
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric
            label="Attendance"
            value={formatPercent(summary.attendancePercentage)}
            accent={
              summary.attendancePercentage >= 90
                ? "text-emerald-600 dark:text-emerald-400"
                : summary.attendancePercentage >= 75
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-destructive"
            }
          />
          <Metric label="Hours worked" value={formatDuration(summary.workedMinutes)} />
          <Metric
            label="Overtime"
            value={formatDuration(summary.overtimeMinutes)}
            accent={summary.overtimeMinutes > 0 ? "text-emerald-600 dark:text-emerald-400" : undefined}
          />
          <Metric label="Break time" value={formatDuration(breakMinutes)} hint="this page" />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric
            label="Late arrivals"
            value={String(lateArrivals)}
            accent={lateArrivals > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
            hint="this page"
          />
          <Metric
            label="Total late"
            value={formatDuration(summary.lateMinutes)}
            accent={summary.lateMinutes > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
          />
          <Metric label="Leaves" value={String(leaves)} />
          <Metric label="Absent" value={String(summary.counts.ABSENT ?? 0)} />
        </div>
      </Section>

      {/* Calendar first: "which days" is read far faster off a grid than off a
          table, and the table below answers "what exactly happened". */}
      <Section title="Calendar">
        <AttendanceCalendar records={records} />
      </Section>

      {summary.trend.length > 0 && (
        <ChartCard title="Hours worked" description="Minutes worked per day in this period.">
          <WorkingHoursChart data={summary.trend} />
        </ChartCard>
      )}

      <Section title="Records">
        {records.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-7 w-7 text-muted-foreground" />}
            title="No attendance records"
            description="Nothing was recorded for this employee in the selected period."
          />
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <AttendanceTable rows={records} showEmployee={false} />
          </div>
        )}
      </Section>

      {total > DRAWER_PAGE_SIZE && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}
    </div>
  );
}

// =============================================================================
// 4 — PERFORMANCE
//
// Reads the SAME leaderboard endpoint the Performance page uses and picks this
// employee's row out of it. That is deliberate: a rank is only meaningful
// relative to everyone else, so computing it from a single-employee query would
// produce a number that disagreed with the leaderboard.
// =============================================================================

export function PerformanceTab({
  employeeId,
  active,
}: {
  employeeId: string | undefined;
  active: boolean;
}) {
  const [period, setPeriod] = useState<WorkforcePeriod>("month");
  const { data, isLoading, isError, refetch } = usePerformance({ period });

  const row = useMemo(
    () => data?.data.find((r) => r.id === employeeId),
    [data, employeeId]
  );

  if (!active) return null;
  if (isError) return <ErrorState message="Failed to load performance." onRetry={() => refetch()} />;
  if (isLoading || !data) return <TabSkeleton rows={6} />;

  if (!row) {
    return (
      <EmptyState
        icon={<Award className="h-7 w-7 text-muted-foreground" />}
        title="Not ranked in this period"
        description="This employee recorded no sales in the selected period, so they do not appear on the leaderboard."
      />
    );
  }

  const headcount = data.data.length;

  return (
    <div className="flex flex-col gap-5">
      <Section title="Ranking" action={<PeriodSelect value={period} onChange={setPeriod} />}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Sales rank" value={`#${row.rank}`} hint={`of ${headcount}`} />
          <Metric
            label="Performance score"
            value={formatScore(row.performanceScore)}
            accent={scoreAccent(row.performanceScore)}
            hint={row.performanceScore == null ? "Set a target to score" : "out of 100"}
          />
          <Metric
            label="Target achieved"
            value={formatOptionalPercent(row.targetAchievement)}
            accent={
              row.targetAchievement == null
                ? "text-muted-foreground"
                : row.targetAchievement >= 100
                  ? "text-emerald-600 dark:text-emerald-400"
                  : row.targetAchievement >= 75
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-destructive"
            }
            hint={
              row.proratedTarget != null
                ? `target ${formatCurrency(row.proratedTarget)}`
                : "No target set"
            }
          />
          <Metric label="Attendance" value={formatPercent(row.attendancePercentage)} />
        </div>
      </Section>

      {/* The breakdown is what makes a composite score arguable rather than
          arbitrary — it shows exactly which term cost the points. */}
      {row.performanceBreakdown ? (
        <Section title="Score breakdown">
          <Card className="flex flex-col gap-2 p-3">
            <ScoreBar label="Revenue vs target" value={row.performanceBreakdown.revenue} max={40} />
            <ScoreBar label="Attendance" value={row.performanceBreakdown.attendance} max={30} />
            <ScoreBar label="Low returns" value={row.performanceBreakdown.returns} max={15} />
            <ScoreBar label="Low discounts" value={row.performanceBreakdown.discount} max={15} />
          </Card>
        </Section>
      ) : (
        <Card className="flex items-start gap-3 p-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="text-xs text-muted-foreground">
            No monthly target is set for this employee, so a performance score cannot be
            calculated. Set one from Edit Employee to enable scoring.
          </div>
        </Card>
      )}

      <Section title="Sales in this period">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Revenue" value={formatCurrency(row.revenue)} />
          <Metric label="Transactions" value={String(row.transactions)} />
          <Metric label="Average bill" value={formatCurrency(row.averageBill)} />
          <Metric label="Units sold" value={String(row.unitsSold)} />
        </div>
      </Section>

      <Section title="Quality">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric
            label="Returns"
            value={String(row.returns)}
            hint={formatCurrency(row.refundValue)}
            accent={row.returns > 0 ? "text-destructive" : undefined}
          />
          <Metric label="Refund rate" value={formatPercent(row.returnPercentage)} />
          <Metric label="Exchanges" value={String(row.exchanges)} />
          <Metric
            label="Discount rate"
            value={formatPercent(row.discountPercentage)}
            accent={row.discountPercentage > 10 ? "text-amber-600 dark:text-amber-400" : undefined}
          />
        </div>
      </Section>
    </div>
  );
}

/** One weighted term of the performance score, drawn to its own weight cap. */
function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;

  return (
    <div className="grid grid-cols-[9rem_1fr_3.5rem] items-center gap-3">
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <div className="h-2 w-full overflow-hidden rounded-sm bg-muted">
        <div
          className="h-full rounded-r-[2px] bg-primary transition-[width] duration-300"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
      <span className="text-right text-xs tabular-nums">
        {value.toFixed(1)}
        <span className="text-muted-foreground">/{max}</span>
      </span>
    </div>
  );
}

// =============================================================================
// 5 — ACTIVITY
// =============================================================================

export function ActivityTab({
  employeeId,
  active,
}: {
  employeeId: string | undefined;
  active: boolean;
}) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useEmployeeActivity(
    employeeId,
    { page, limit: 25 },
    active
  );

  if (isError) return <ErrorState message="Failed to load activity." onRetry={() => refetch()} />;

  const rows = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="flex flex-col gap-4">
      {/* showEmployee is off: inside one employee's drawer, repeating their name
          on every row is noise. */}
      <EmployeeTimeline
        rows={rows}
        isLoading={isLoading}
        emptyMessage="This employee has no recorded activity yet."
      />

      {totalPages > 1 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}
    </div>
  );
}

// =============================================================================
// 6 — LOGIN HISTORY
// =============================================================================

export function SessionsTab({
  employeeId,
  active,
}: {
  employeeId: string | undefined;
  active: boolean;
}) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useEmployeeLoginHistory(
    employeeId,
    { page, limit: DRAWER_PAGE_SIZE },
    active
  );

  if (isError) {
    return <ErrorState message="Failed to load login history." onRetry={() => refetch()} />;
  }

  const rows = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;

  if (!isLoading && rows.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck className="h-7 w-7 text-muted-foreground" />}
        title="No sign-ins recorded"
        description="This employee has not signed in yet."
      />
    );
  }

  const openSession = rows.find((r) => r.sessionStatus === "ACTIVE");

  return (
    <div className="flex flex-col gap-4">
      {openSession && (
        <Card className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <PresenceDot presence="ONLINE" />
              Currently signed in
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              Since {formatDateTime(openSession.loginAt)}
              {openSession.device ? ` · ${openSession.device}` : ""}
              {openSession.operatingSystem ? ` · ${openSession.operatingSystem}` : ""}
              {openSession.browser ? ` · ${openSession.browser}` : ""}
            </div>
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatDuration(openSession.durationMinutes)}
          </span>
        </Card>
      )}

      <div className="-mx-2 overflow-x-auto">
        <LoginHistoryTable rows={rows} isLoading={isLoading} showEmployee={false} />
      </div>

      {totalPages > 1 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}
    </div>
  );
}

// =============================================================================
// 7 — PERMISSIONS
//
// Read-only by design. The matrix is DERIVED from the role by the server's
// permission engine, so it is not editable per employee — changing what someone
// may do means changing their role, which is its own action with its own
// confirmation. Rendering it read-only is honest about that.
// =============================================================================

export function PermissionsTab({
  employeeId,
  active,
}: {
  employeeId: string | undefined;
  active: boolean;
}) {
  const { data, isLoading, isError, refetch } = useEmployeePermissions(employeeId, active);

  if (isError) return <ErrorState message="Failed to load permissions." onRetry={() => refetch()} />;
  if (isLoading || !data) return <TabSkeleton rows={8} />;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Permissions follow the <span className="font-medium">{data.role}</span> role and are the
        same for everyone holding it. To change what this employee can do, change their role.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="py-2 text-left font-medium">Module</th>
              <th className="py-2 text-center font-medium">View</th>
              <th className="py-2 text-center font-medium">Create</th>
              <th className="py-2 text-center font-medium">Edit</th>
              <th className="py-2 text-center font-medium">Delete</th>
            </tr>
          </thead>
          <tbody>
            {data.permissions.map((grant) => (
              <tr key={grant.module} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-2">{grant.label}</td>
                <PermissionCell granted={grant.view} />
                <PermissionCell granted={grant.create} />
                <PermissionCell granted={grant.edit} />
                <PermissionCell granted={grant.delete} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PermissionCell({ granted }: { granted: boolean }) {
  return (
    <td className="py-2 text-center">
      {/* A dot for granted, an em-dash for not: a grid of ✓ and ✗ reads as
          noise, whereas presence/absence scans down a column instantly. */}
      {granted ? (
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-label="Allowed" />
      ) : (
        <span className="text-muted-foreground" aria-label="Not allowed">—</span>
      )}
    </td>
  );
}

// =============================================================================
// 8 — NOTES (OWNER-ONLY)
//
// Private HR notes. This tab is not rendered for a manager and its query is
// gated on the same condition, so a manager never issues the request — the
// server would reject it anyway, which is the second of the two gates.
// =============================================================================

const NOTE_CATEGORY_OPTIONS: Array<{ value: EmployeeNoteCategory; label: string }> = [
  { value: "GENERAL", label: "General" },
  { value: "PRAISE", label: "Excellent Performer" },
  { value: "TRAINING", label: "Needs Training" },
  { value: "PROMOTION", label: "Promotion Candidate" },
  { value: "WARNING", label: "Written Warning" },
];

export function NotesTab({
  employeeId,
  active,
}: {
  employeeId: string | undefined;
  active: boolean;
}) {
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<EmployeeNoteCategory>("GENERAL");

  const { data, isLoading, isError, refetch } = useEmployeeNotes(employeeId, active);
  const createNote = useCreateNote(employeeId);
  const updateNote = useUpdateNote(employeeId);
  const deleteNote = useDeleteNote(employeeId);

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed) return;

    createNote.mutate(
      { category, body: trimmed, isPinned: false },
      {
        onSuccess: () => {
          setBody("");
          setCategory("GENERAL");
        },
      }
    );
  };

  if (isError) return <ErrorState message="Failed to load notes." onRetry={() => refetch()} />;

  const notes = data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <Select
            className="w-auto min-w-[12rem]"
            options={NOTE_CATEGORY_OPTIONS}
            value={category}
            onChange={(e) => setCategory(e.target.value as EmployeeNoteCategory)}
            aria-label="Note category"
          />
          <Button
            size="sm"
            className="ml-auto"
            onClick={submit}
            disabled={!body.trim() || createNote.isPending}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Add note
          </Button>
        </div>

        <Input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write an internal note — only you can see these…"
          maxLength={2000}
          // Enter submits; the notes here are one-liners in practice, and
          // requiring a mouse trip to the button for each would be tedious.
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />

        <p className="text-[11px] text-muted-foreground">
          Private to the owner. Managers and cashiers can never see these notes.
        </p>
      </Card>

      {isLoading ? (
        <TabSkeleton rows={4} />
      ) : notes.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="h-7 w-7 text-muted-foreground" />}
          title="No notes yet"
          description="Record praise, training needs, or a written warning. Only the owner can read them."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((note) => (
            <Card
              key={note.id}
              className={cn(
                "flex flex-col gap-2 p-3",
                // A pinned note is the one thing a reader must not miss.
                note.isPinned && "border-primary/40 bg-primary/[0.03]"
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={NOTE_CATEGORY_VARIANTS[note.category] ?? "secondary"}>
                  {NOTE_CATEGORY_LABELS[note.category] ?? note.category}
                </Badge>
                {note.isPinned && (
                  <Badge variant="outline" className="gap-1">
                    <Pin className="h-3 w-3" aria-hidden="true" />
                    Pinned
                  </Badge>
                )}

                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={note.isPinned ? "Unpin note" : "Pin note"}
                    onClick={() =>
                      updateNote.mutate({
                        noteId: note.id,
                        payload: { isPinned: !note.isPinned },
                      })
                    }
                  >
                    <Pin className={cn("h-3.5 w-3.5", note.isPinned && "fill-current")} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete note"
                    onClick={() => deleteNote.mutate(note.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <p className="whitespace-pre-wrap text-sm leading-snug">{note.body}</p>

              <div className="text-[11px] text-muted-foreground">
                {note.author?.fullName ?? "Unknown"} · {formatDateTime(note.createdAt)}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** Small helper the drawer header uses for its at-a-glance strip. */
export function DrawerHeaderStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 truncate text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
