/**
 * Attendance — the daily register.
 *
 * The page answers two questions that need different shapes, so it renders
 * both: "how is the team doing over this period" (the summary strip and the
 * trend chart) and "what exactly happened on this date for this person" (the
 * records table). Neither substitutes for the other.
 *
 * Clock-in/clock-out is offered to every role that can reach this page — it is
 * self-service, and the server derives WHO is clocking in from the session, not
 * from anything the client sends. Editing SOMEONE ELSE'S attendance is
 * owner-only and lives behind the same 403 the UI gate mirrors.
 */

import { useState } from "react";
import { CalendarCog, CalendarDays, Coffee, LogIn, LogOut } from "lucide-react";

import {
  Button, Card, EmptyState, ErrorState, Pagination, Select,
} from "@/components/ui";
import { canManageEmployees } from "@/features/auth";
import { useAuthStore } from "@/store/auth.store";
import { AttendanceCalendar } from "../components/AttendanceCalendar";
import { AttendanceTable } from "../components/AttendanceTable";
import { ExportMenu } from "../components/ExportMenu";
import { ShiftManager } from "../components/ShiftManager";
import { EmployeeSearch } from "../components/EmployeeFilters";
import { AttendanceStatCards } from "../components/WorkforceStatCards";
import {
  AttendanceTrendChart, ChartCard, WorkingHoursChart,
} from "../components/WorkforceCharts";
import {
  useAttendance,
  useAttendanceSummary,
  useClockIn,
  useClockOut,
  useEndBreak,
  useShifts,
  useStartBreak,
} from "../hooks/useWorkforce";
import { useDebounce } from "@/hooks/useDebounce";
import { formatShiftWindow } from "../utils/format";
import type { AttendanceStatus, WorkforcePeriod } from "../types";

const PERIOD_OPTIONS: Array<{ value: WorkforcePeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
  { value: "year", label: "This year" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "PRESENT", label: "Present" },
  { value: "LATE", label: "Late" },
  { value: "HALF_DAY", label: "Half Day" },
  { value: "ABSENT", label: "Absent" },
  { value: "ON_LEAVE", label: "On Leave" },
  { value: "HOLIDAY", label: "Holiday" },
  { value: "WEEK_OFF", label: "Week Off" },
];

const PAGE_SIZE = 20;

export default function AttendancePage() {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const canManage = canManageEmployees(role);

  const [shiftsOpen, setShiftsOpen] = useState(false);
  const [period, setPeriod] = useState<WorkforcePeriod>("month");
  const [status, setStatus] = useState<AttendanceStatus | "">("");
  const [shiftId, setShiftId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 300);

  const params = {
    period,
    page,
    limit: PAGE_SIZE,
    ...(status ? { status } : {}),
    ...(shiftId ? { shiftId } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  };

  const { data: shifts } = useShifts();
  const records = useAttendance(params);
  // The summary covers the whole period regardless of paging, so it
  // deliberately omits page/limit — including them would refetch the strip on
  // every page change for an identical result.
  const summary = useAttendanceSummary({
    period,
    ...(status ? { status } : {}),
    ...(shiftId ? { shiftId } : {}),
  });

  const clockIn = useClockIn();
  const clockOut = useClockOut();
  const startBreak = useStartBreak();
  const endBreak = useEndBreak();

  const rows = records.data?.data ?? [];
  const total = records.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** Any filter change invalidates the current page number. */
  const resetPage = () => setPage(1);

  const shiftOptions = [
    { value: "", label: "All shifts" },
    ...(shifts ?? []).map((s) => ({
      value: s.id,
      label: `${s.name} (${formatShiftWindow(s.startMinute, s.endMinute)})`,
    })),
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Attendance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Daily attendance register — clock-ins, hours worked, lateness and overtime.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Shift definitions drive every late/overtime judgement on this page,
              so managing them belongs beside the register they produce. */}
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShiftsOpen(true)}
              leftIcon={<CalendarCog className="h-3.5 w-3.5" />}
            >
              Shifts
            </Button>
          )}

          <ExportMenu
            report="attendance"
            filters={{
              period,
              ...(status ? { status } : {}),
              ...(shiftId ? { shiftId } : {}),
              ...(debouncedSearch ? { search: debouncedSearch } : {}),
            }}
          />

          <Button
            variant="outline"
            size="sm"
            onClick={() => clockIn.mutate(undefined)}
            disabled={clockIn.isPending}
            leftIcon={<LogIn className="h-3.5 w-3.5" />}
          >
            Clock In
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => startBreak.mutate(undefined)}
            disabled={startBreak.isPending}
            leftIcon={<Coffee className="h-3.5 w-3.5" />}
          >
            Start Break
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => endBreak.mutate(undefined)}
            disabled={endBreak.isPending}
            leftIcon={<Coffee className="h-3.5 w-3.5" />}
          >
            End Break
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => clockOut.mutate(undefined)}
            disabled={clockOut.isPending}
            leftIcon={<LogOut className="h-3.5 w-3.5" />}
          >
            Clock Out
          </Button>
        </div>
      </div>

      <AttendanceStatCards data={summary.data} isLoading={summary.isLoading} />

      {summary.data && summary.data.trend.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Attendance trend"
            description="Present, late and absent headcount per day."
          >
            <AttendanceTrendChart data={summary.data.trend} isLoading={summary.isLoading} />
          </ChartCard>
          <ChartCard
            title="Working hours"
            description="Total minutes worked across the team per day."
          >
            <WorkingHoursChart data={summary.data.trend} isLoading={summary.isLoading} />
          </ChartCard>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <EmployeeSearch
          value={search}
          onChange={(v) => {
            setSearch(v);
            resetPage();
          }}
          loading={search !== debouncedSearch || records.isFetching}
          placeholder="Search attendance by employee name or ID…"
        />

        <div className="flex flex-wrap items-end gap-2">
          <Select
            className="w-auto min-w-[9rem]"
            options={PERIOD_OPTIONS}
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value as WorkforcePeriod);
              resetPage();
            }}
            aria-label="Period"
          />
          <Select
            className="w-auto min-w-[9rem]"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as AttendanceStatus | "");
              resetPage();
            }}
            aria-label="Filter by status"
          />
          <Select
            className="w-auto min-w-[10rem]"
            options={shiftOptions}
            value={shiftId}
            onChange={(e) => {
              setShiftId(e.target.value);
              resetPage();
            }}
            aria-label="Filter by shift"
          />
        </div>
      </div>

      {records.isError ? (
        <ErrorState
          message="Failed to load attendance records."
          onRetry={() => records.refetch()}
        />
      ) : !records.isLoading && rows.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-8 w-8 text-muted-foreground" />}
          title="No attendance records"
          description="Nothing was recorded for this period. Try widening the date range or clearing the filters."
        />
      ) : (
        <div className="overflow-x-auto">
          <AttendanceTable rows={rows} isLoading={records.isLoading} showEmployee />
        </div>
      )}

      {/* A single employee's month reads far better as a grid than as rows, so
          the calendar appears once a specific person is in view. Across the
          whole team the grid would be ambiguous — one cell, many people. */}
      {rows.length > 0 && (
        <Card className="flex flex-col gap-3 p-4">
          <div>
            <h2 className="text-sm font-semibold">Monthly Calendar</h2>
            <p className="text-xs text-muted-foreground">
              {search
                ? "Days for the employees matching your search."
                : "Search for an employee to see their month at a glance."}
            </p>
          </div>
          <AttendanceCalendar records={rows} />
        </Card>
      )}

      {total > 0 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}

      <ShiftManager open={shiftsOpen} onClose={() => setShiftsOpen(false)} />
    </div>
  );
}
