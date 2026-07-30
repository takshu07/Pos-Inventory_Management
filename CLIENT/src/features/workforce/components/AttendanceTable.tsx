/**
 * Attendance records table.
 *
 * Used both on the standalone Attendance page (with the Employee column) and
 * inside the drawer's Attendance tab (without it) — the same component, since
 * the rows are identical and only the audience differs.
 */

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui";
import { cn } from "@/utils/cn";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { AttendanceBadge } from "./EmployeeStatusBadge";
import { EmployeeTableSkeleton } from "./EmployeeSkeleton";
import { formatDate, formatDuration, formatTime } from "../utils/format";
import type { AttendanceRow } from "../types";

export function AttendanceTable({
  rows,
  isLoading,
  showEmployee = true,
  onRowClick,
}: {
  rows: AttendanceRow[];
  isLoading?: boolean;
  showEmployee?: boolean;
  onRowClick?: (row: AttendanceRow) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          {showEmployee && <TableHead className="min-w-[13rem]">Employee</TableHead>}
          <TableHead>Shift</TableHead>
          <TableHead>Clock In</TableHead>
          <TableHead>Clock Out</TableHead>
          <TableHead className="text-right">Break</TableHead>
          <TableHead className="text-right">Worked</TableHead>
          <TableHead className="text-right">Late</TableHead>
          <TableHead className="text-right">Overtime</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {isLoading ? (
          <EmployeeTableSkeleton columns={showEmployee ? 10 : 9} rows={6} />
        ) : (
          rows.map((row) => (
            <TableRow
              key={row.id}
              {...(onRowClick ? { onClick: () => onRowClick(row) } : {})}
              className={cn(onRowClick && "cursor-pointer")}
            >
              <TableCell className="whitespace-nowrap font-medium">
                {formatDate(row.date)}
              </TableCell>

              {showEmployee && (
                <TableCell>
                  {row.employee ? (
                    <div className="flex items-center gap-2.5">
                      <EmployeeAvatar
                        id={row.employee.id}
                        firstName={row.employee.fullName.split(" ")[0] ?? ""}
                        lastName={row.employee.fullName.split(" ")[1] ?? ""}
                        photoUrl={row.employee.photoUrl}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm">{row.employee.fullName}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {row.employee.employeeCode}
                        </div>
                      </div>
                    </div>
                  ) : (
                    "—"
                  )}
                </TableCell>
              )}

              <TableCell className="whitespace-nowrap text-xs">
                {row.shift ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: row.shift.colorHex ?? "#94a3b8" }}
                      aria-hidden="true"
                    />
                    {row.shift.name}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>

              <TableCell className="whitespace-nowrap tabular-nums">
                {formatTime(row.clockInAt)}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {/* A missing clock-out on a day with a clock-in means the shift
                    is still open — that is information, not a gap. */}
                {row.clockOutAt ? (
                  formatTime(row.clockOutAt)
                ) : row.clockInAt ? (
                  <span className="text-emerald-600 dark:text-emerald-400">In progress</span>
                ) : (
                  "—"
                )}
              </TableCell>

              <TableCell className="text-right tabular-nums">
                {row.isOnBreak ? (
                  // An open break is live state, not history — say so rather
                  // than showing a number that is still climbing.
                  <span className="text-amber-600 dark:text-amber-400">
                    On break · {formatDuration(row.breakMinutes)}
                  </span>
                ) : row.breakMinutes > 0 ? (
                  formatDuration(row.breakMinutes)
                ) : (
                  "—"
                )}
              </TableCell>

              <TableCell className="text-right tabular-nums">
                {formatDuration(row.workedMinutes)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  row.lateMinutes > 0 && "text-amber-600 dark:text-amber-400"
                )}
              >
                {row.lateMinutes > 0 ? formatDuration(row.lateMinutes) : "—"}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  row.overtimeMinutes > 0 && "text-emerald-600 dark:text-emerald-400"
                )}
              >
                {row.overtimeMinutes > 0 ? formatDuration(row.overtimeMinutes) : "—"}
              </TableCell>

              <TableCell>
                <AttendanceBadge status={row.status} />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
