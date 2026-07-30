/**
 * Compact employee card — the mobile/tablet presentation of a roster row.
 *
 * The table is unusable below ~900px (11 columns), and a horizontally scrolling
 * table is worse than no table. This card carries the same information in a
 * stacked layout, and the pages switch between them by breakpoint rather than
 * hiding columns one at a time.
 */

import { Card } from "@/components/ui";
import { cn } from "@/utils/cn";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { AttendanceBadge, PresenceDot, RoleBadge } from "./EmployeeStatusBadge";
import { formatCurrency, formatRelative, formatShiftWindow } from "../utils/format";
import type { WorkforceEmployee } from "../types";

export function EmployeeCard({
  employee,
  onClick,
  actions,
}: {
  employee: WorkforceEmployee;
  onClick: (employee: WorkforceEmployee) => void;
  actions?: React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        "cursor-pointer p-4 transition-colors hover:border-primary/40",
        !employee.isActive && "opacity-55"
      )}
      onClick={() => onClick(employee)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <EmployeeAvatar
            id={employee.id}
            firstName={employee.firstName}
            lastName={employee.lastName}
            photoUrl={employee.photoUrl}
            presence={employee.presence}
            size="lg"
          />
          <div className="min-w-0">
            <div className="truncate font-semibold">{employee.fullName}</div>
            <div className="truncate text-xs text-muted-foreground">
              {employee.employeeCode} · {employee.phone}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <RoleBadge role={employee.role} />
              <AttendanceBadge status={employee.attendanceStatus} />
            </div>
          </div>
        </div>

        {actions && (
          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
            {actions}
          </div>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <Field label="Sales Today" value={formatCurrency(employee.todayRevenue)} emphasis />
        <Field label="Transactions" value={String(employee.todayTransactions)} />
        <Field
          label="Shift"
          value={
            employee.shift
              ? formatShiftWindow(employee.shift.startMinute, employee.shift.endMinute)
              : "Unassigned"
          }
        />
        <Field label="Attendance" value={`${employee.attendancePercentage.toFixed(0)}%`} />
      </dl>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground">
        <PresenceDot presence={employee.presence} withLabel />
        <span className="truncate">
          {employee.currentActivity
            ? `${employee.currentActivity} · ${formatRelative(employee.currentActivityAt)}`
            : `Last login ${formatRelative(employee.lastLogin)}`}
        </span>
      </div>
    </Card>
  );
}

function Field({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={cn("truncate tabular-nums", emphasis && "font-semibold")}>{value}</dd>
    </div>
  );
}
