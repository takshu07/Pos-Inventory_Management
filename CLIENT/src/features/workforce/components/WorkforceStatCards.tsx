/**
 * Summary card strips for the workforce module.
 *
 * Deliberately mirrors the card grammar of DiscountDashboard and
 * OwnerProductDashboard (same density, same uppercase micro-label, same value
 * weight) so the owner's modules read as one system rather than three designs.
 *
 * Cards are clickable where a card maps to a filter — clicking "Absent Today"
 * should filter the table, not merely inform. Cards without a filter are
 * rendered as plain divs so nothing looks interactive that isn't.
 */

import {
  Users, UserCog, UserCheck, Wifi, WifiOff, CalendarCheck,
  CalendarX, Clock, IndianRupee, Receipt, Palmtree,
  Undo2, Printer, UserPlus, Boxes,
} from "lucide-react";

import { Card, Skeleton } from "@/components/ui";
import { cn } from "@/utils/cn";
import { formatCurrency, formatDuration } from "../utils/format";
import type { RosterStats, WorkforceSummary } from "../types";

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: string;
  onClick?: (() => void) | undefined;
}

export function StatCard({ icon: Icon, label, value, accent, onClick }: StatCardProps) {
  const Wrapper = onClick ? "button" : "div";

  return (
    <Card className={cn("p-3 transition-colors", onClick && "hover:border-primary/40")}>
      <Wrapper
        {...(onClick ? { onClick, type: "button" as const } : {})}
        className={cn("w-full text-left", onClick && "cursor-pointer")}
      >
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </div>
        <div className={cn("mt-1 text-lg font-bold tabular-nums", accent)}>{value}</div>
      </Wrapper>
    </Card>
  );
}

export function StatCardSkeleton() {
  return (
    <Card className="p-3">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-2 h-6 w-14" />
    </Card>
  );
}

/**
 * The module-level dashboard strip: headcount, presence and today's attendance
 * at a glance. This is the first thing on the Employee Activity page.
 */
export function WorkforceSummaryCards({
  data,
  isLoading,
  onSelect,
}: {
  data: WorkforceSummary | undefined;
  isLoading: boolean;
  onSelect?: (filter: { role?: string; presence?: string; attendance?: string }) => void;
}) {
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
      <StatCard
        icon={Users}
        label="Total Staff"
        value={String(data.totalEmployees)}
        onClick={onSelect ? () => onSelect({ role: "" }) : undefined}
      />
      <StatCard
        icon={UserCog}
        label="Managers"
        value={String(data.managers)}
        onClick={onSelect ? () => onSelect({ role: "MANAGER" }) : undefined}
      />
      <StatCard
        icon={UserCheck}
        label="Cashiers"
        value={String(data.cashiers)}
        onClick={onSelect ? () => onSelect({ role: "CASHIER" }) : undefined}
      />
      <StatCard
        icon={Wifi}
        label="Online"
        value={String(data.online)}
        accent="text-emerald-600 dark:text-emerald-400"
        onClick={onSelect ? () => onSelect({ presence: "ONLINE" }) : undefined}
      />
      <StatCard
        icon={WifiOff}
        label="Offline"
        value={String(data.offline)}
        onClick={onSelect ? () => onSelect({ presence: "OFFLINE" }) : undefined}
      />
      <StatCard
        icon={CalendarCheck}
        label="Working Today"
        value={String(data.workingToday)}
        accent="text-emerald-600 dark:text-emerald-400"
      />
      <StatCard
        icon={Palmtree}
        label="On Leave"
        value={String(data.onLeave)}
        accent="text-blue-600 dark:text-blue-400"
        onClick={onSelect ? () => onSelect({ attendance: "ON_LEAVE" }) : undefined}
      />
      <StatCard
        icon={CalendarX}
        label="Absent Today"
        value={String(data.absentToday)}
        accent={data.absentToday > 0 ? "text-destructive" : undefined}
        onClick={onSelect ? () => onSelect({ attendance: "ABSENT" }) : undefined}
      />
    </div>
  );
}

/**
 * Today's OUTPUT, as opposed to today's headcount above it.
 *
 * A second strip rather than sixteen cards in one grid: the first strip answers
 * "who is here", this one answers "what have they done", and mixing the two
 * makes neither readable. Every number here is counted from records the other
 * modules already write — this module never tracks its own.
 */
export function WorkforceOperationsCards({
  data,
  isLoading,
}: {
  data: WorkforceSummary | undefined;
  isLoading: boolean;
}) {
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatCard
        icon={IndianRupee}
        label="Sales Today"
        value={formatCurrency(data.salesToday)}
        accent="text-emerald-600 dark:text-emerald-400"
      />
      <StatCard icon={Receipt} label="Transactions" value={String(data.transactionsToday)} />
      <StatCard
        icon={Undo2}
        label="Refunds"
        value={String(data.refundsToday)}
        accent={data.refundsToday > 0 ? "text-destructive" : undefined}
      />
      <StatCard icon={Printer} label="Labels Printed" value={String(data.labelsPrinted)} />
      <StatCard icon={UserPlus} label="Customers Added" value={String(data.customersAdded)} />
      <StatCard icon={Boxes} label="Inventory Updates" value={String(data.inventoryUpdates)} />
    </div>
  );
}

/**
 * Role-scoped strip shown above the Managers and Employees tables.
 * One component for both tabs — the tabs differ in data, not in shape.
 */
export function RosterStatCards({
  data,
  isLoading,
  labelPrefix,
}: {
  data: RosterStats | undefined;
  isLoading: boolean;
  labelPrefix: string;
}) {
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      <StatCard icon={Users} label={`Total ${labelPrefix}`} value={String(data.total)} />
      <StatCard
        icon={Wifi}
        label="Online"
        value={String(data.online)}
        accent="text-emerald-600 dark:text-emerald-400"
      />
      <StatCard icon={WifiOff} label="Offline" value={String(data.offline)} />
      <StatCard
        icon={CalendarCheck}
        label="Working"
        value={String(data.working)}
        accent="text-emerald-600 dark:text-emerald-400"
      />
      <StatCard
        icon={Palmtree}
        label="On Leave"
        value={String(data.onLeave)}
        accent="text-blue-600 dark:text-blue-400"
      />
      <StatCard
        icon={IndianRupee}
        label="Today's Sales"
        value={formatCurrency(data.todayRevenue)}
      />
      <StatCard icon={Receipt} label="Transactions" value={String(data.todayTransactions)} />
    </div>
  );
}

/** Attendance page cards. */
export function AttendanceStatCards({
  data,
  isLoading,
}: {
  data:
    | {
        headcount: number;
        presentToday: number;
        absentToday: number;
        onLeaveToday: number;
        lateToday: number;
        attendancePercentage: number;
        workedMinutes: number;
        overtimeMinutes?: number;
      }
    | undefined;
  isLoading: boolean;
}) {
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
      <StatCard icon={Users} label="Headcount" value={String(data.headcount)} />
      <StatCard
        icon={CalendarCheck}
        label="Present Today"
        value={String(data.presentToday)}
        accent="text-emerald-600 dark:text-emerald-400"
      />
      <StatCard
        icon={CalendarX}
        label="Absent Today"
        value={String(data.absentToday)}
        accent={data.absentToday > 0 ? "text-destructive" : undefined}
      />
      <StatCard
        icon={Clock}
        label="Late Today"
        value={String(data.lateToday)}
        accent={data.lateToday > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
      />
      <StatCard
        icon={Palmtree}
        label="On Leave"
        value={String(data.onLeaveToday)}
        accent="text-blue-600 dark:text-blue-400"
      />
      <StatCard
        icon={CalendarCheck}
        label="Attendance"
        value={`${data.attendancePercentage.toFixed(1)}%`}
        accent={
          data.attendancePercentage >= 90
            ? "text-emerald-600 dark:text-emerald-400"
            : data.attendancePercentage >= 75
              ? "text-amber-600 dark:text-amber-400"
              : "text-destructive"
        }
      />
      <StatCard
        icon={Clock}
        label="Avg Hours"
        // Per PRESENT head, not per employee: dividing by headcount would make
        // a day with three absences look like everyone worked short hours.
        value={formatDuration(
          data.presentToday > 0 ? Math.round(data.workedMinutes / data.presentToday) : 0
        )}
      />
      <StatCard
        icon={Clock}
        label="Overtime"
        value={formatDuration(data.overtimeMinutes ?? 0)}
        accent={
          (data.overtimeMinutes ?? 0) > 0 ? "text-emerald-600 dark:text-emerald-400" : undefined
        }
      />
    </div>
  );
}
