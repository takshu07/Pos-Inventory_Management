/**
 * The roster table, shared by the Managers and Employees tabs.
 *
 * One component, two configurations. The tabs show different columns (managers
 * get Phone/Email, staff get Role/Attendance), which is expressed as a column
 * SET rather than as two components — duplicating a table to change three
 * headers is how two tables drift apart.
 *
 * Rows are virtualized above a threshold; below it the hook is inert and the
 * table renders normally. See useVirtualRows.
 */

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui";
import { cn } from "@/utils/cn";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { AttendanceBadge, PresenceDot, RoleBadge } from "./EmployeeStatusBadge";
import { EmployeeTableSkeleton } from "./EmployeeSkeleton";
import { useVirtualRows } from "../hooks/useVirtualRows";
import {
  formatCurrency, formatRelative, formatScore, formatShiftWindow, formatTime, scoreAccent,
} from "../utils/format";
import type { WorkforceEmployee } from "../types";

export type EmployeeTableVariant = "managers" | "staff";

/** Fixed row height, in pixels. Must match the rendered row for windowing to work. */
const ROW_HEIGHT = 64;

interface Props {
  rows: WorkforceEmployee[];
  variant: EmployeeTableVariant;
  isLoading?: boolean;
  onRowClick: (employee: WorkforceEmployee) => void;
  renderActions?: (employee: WorkforceEmployee) => React.ReactNode;
}

export function EmployeeTable({
  rows,
  variant,
  isLoading,
  onRowClick,
  renderActions,
}: Props) {
  const isManagers = variant === "managers";

  const virtual = useVirtualRows({ count: rows.length, rowHeight: ROW_HEIGHT });
  const visible = virtual.enabled ? rows.slice(virtual.startIndex, virtual.endIndex) : rows;

  // Kept in step with the header below — the skeleton spans this many cells.
  const columnCount = (isManagers ? 14 : 14) + (renderActions ? 1 : 0);

  const body = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-[15rem]">Employee</TableHead>
          {isManagers ? (
            <>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
            </>
          ) : (
            <>
              <TableHead>Role</TableHead>
              <TableHead>Counter</TableHead>
            </>
          )}
          <TableHead>Shift</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="min-w-[11rem]">Session / Device</TableHead>
          {isManagers && <TableHead>Register</TableHead>}
          <TableHead className="min-w-[11rem]">Current Activity</TableHead>
          <TableHead className="text-right">Sales Today</TableHead>
          <TableHead className="text-right">Month</TableHead>
          <TableHead className="text-right">Avg Bill</TableHead>
          {!isManagers && <TableHead className="text-right">Units</TableHead>}
          <TableHead className="text-right">Attendance</TableHead>
          <TableHead className="text-right">Rating</TableHead>
          <TableHead>Last Sale</TableHead>
          {renderActions && <TableHead className="w-12 text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>

      <TableBody>
        {isLoading ? (
          <EmployeeTableSkeleton columns={columnCount} />
        ) : (
          <>
            {/* Top spacer preserves scroll height for the rows above the window. */}
            {virtual.enabled && virtual.paddingTop > 0 && (
              <tr aria-hidden="true" style={{ height: virtual.paddingTop }} />
            )}

            {visible.map((employee) => (
              <TableRow
                key={employee.id}
                onClick={() => onRowClick(employee)}
                className={cn(
                  "cursor-pointer",
                  // A deactivated account is still shown — its history matters —
                  // but dimmed so it never reads as active staff.
                  !employee.isActive && "opacity-55"
                )}
                style={{ height: ROW_HEIGHT }}
              >
                {/* ── Employee: photo, name, code ── */}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <EmployeeAvatar
                      id={employee.id}
                      firstName={employee.firstName}
                      lastName={employee.lastName}
                      photoUrl={employee.photoUrl}
                      presence={employee.presence}
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{employee.fullName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {employee.employeeCode}
                      </div>
                    </div>
                  </div>
                </TableCell>

                {isManagers ? (
                  <>
                    <TableCell className="whitespace-nowrap">{employee.phone}</TableCell>
                    <TableCell className="max-w-[14rem] truncate text-muted-foreground">
                      {employee.email ?? "—"}
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell>
                      <RoleBadge role={employee.role} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {employee.assignedRegister ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </>
                )}

                {/* ── Shift ── */}
                <TableCell className="whitespace-nowrap text-xs">
                  {employee.shift ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: employee.shift.colorHex ?? "#94a3b8" }}
                        aria-hidden="true"
                      />
                      {formatShiftWindow(employee.shift.startMinute, employee.shift.endMinute)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </TableCell>

                {/* ── Status: presence + today's attendance together ── */}
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <PresenceDot presence={employee.presence} withLabel />
                    <AttendanceBadge status={employee.attendanceStatus} />
                  </div>
                </TableCell>

                {/* ── Session + device: who is actually connected, on what ── */}
                <TableCell>
                  {employee.presence === "ONLINE" && employee.sessionStartedAt ? (
                    <div className="min-w-0">
                      <div className="truncate text-xs">
                        {employee.device ?? "Unknown device"}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        since {formatRelative(employee.sessionStartedAt)}
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">No session</span>
                  )}
                </TableCell>

                {isManagers && (
                  <TableCell className="whitespace-nowrap text-xs">
                    {employee.assignedRegister ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}

                {/* ── Current activity ── */}
                <TableCell>
                  {employee.currentActivity ? (
                    <div className="min-w-0">
                      <div className="truncate text-xs">{employee.currentActivity}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatRelative(employee.currentActivityAt)}
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">No activity</span>
                  )}
                </TableCell>

                {/* ── Money: tabular-nums keeps the columns visually aligned ── */}
                <TableCell className="text-right font-medium tabular-nums">
                  {formatCurrency(employee.todayRevenue)}
                  <div className="text-[11px] font-normal text-muted-foreground">
                    {employee.todayTransactions} txn
                    {employee.todayTransactions === 1 ? "" : "s"}
                  </div>
                </TableCell>

                <TableCell className="text-right tabular-nums">
                  {formatCurrency(employee.monthlyRevenue)}
                </TableCell>

                <TableCell className="text-right tabular-nums">
                  {formatCurrency(employee.averageBill)}
                </TableCell>

                {!isManagers && (
                  <TableCell className="text-right tabular-nums">
                    {employee.unitsSold}
                  </TableCell>
                )}

                <TableCell className="text-right tabular-nums">
                  <span
                    className={cn(
                      employee.attendancePercentage >= 90
                        ? "text-emerald-600 dark:text-emerald-400"
                        : employee.attendancePercentage >= 75
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-destructive"
                    )}
                  >
                    {employee.attendancePercentage.toFixed(0)}%
                  </span>
                </TableCell>

                {/* Rating is NULL when no target is set — "Not set" rather than
                    a 0 that would read as the worst possible performance. */}
                <TableCell className="text-right tabular-nums">
                  <span className={scoreAccent(employee.performanceScore)}>
                    {formatScore(employee.performanceScore)}
                  </span>
                </TableCell>

                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {employee.lastSaleAt ? (
                    formatRelative(employee.lastSaleAt)
                  ) : (
                    <span className="text-muted-foreground/60">No sales</span>
                  )}
                  <div className="text-[11px]">
                    {employee.isWorkingNow && employee.clockInAt
                      ? `In at ${formatTime(employee.clockInAt)}`
                      : formatRelative(employee.lastLogin)}
                  </div>
                </TableCell>

                {renderActions && (
                  <TableCell
                    className="text-right"
                    // The actions cell must not also trigger the row's drawer.
                    onClick={(e) => e.stopPropagation()}
                  >
                    {renderActions(employee)}
                  </TableCell>
                )}
              </TableRow>
            ))}

            {virtual.enabled && virtual.paddingBottom > 0 && (
              <tr aria-hidden="true" style={{ height: virtual.paddingBottom }} />
            )}
          </>
        )}
      </TableBody>
    </Table>
  );

  // Only wrap in a scroll container when windowing is active — otherwise the
  // page's own scroll should drive the table.
  if (!virtual.enabled) return body;

  return (
    <div
      ref={virtual.scrollRef}
      onScroll={virtual.onScroll}
      className="max-h-[70vh] overflow-y-auto"
    >
      {body}
    </div>
  );
}
