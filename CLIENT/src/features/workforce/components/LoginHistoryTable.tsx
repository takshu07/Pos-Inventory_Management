/**
 * Login/session history table.
 *
 * Failed attempts are included and visually marked. A login history that only
 * shows successes is a worse security tool than none, because it implies
 * nothing was attempted.
 */

import { Monitor, Smartphone, Tablet, ShieldAlert } from "lucide-react";

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui";
import { cn } from "@/utils/cn";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { SessionBadge } from "./EmployeeStatusBadge";
import { EmployeeTableSkeleton } from "./EmployeeSkeleton";
import { formatDate, formatDuration, formatTime } from "../utils/format";
import type { LoginHistoryRow } from "../types";

function DeviceIcon({ device }: { device: string | null }) {
  const Icon = device === "Mobile" ? Smartphone : device === "Tablet" ? Tablet : Monitor;
  return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

export function LoginHistoryTable({
  rows,
  isLoading,
  showEmployee = true,
  renderActions,
}: {
  rows: LoginHistoryRow[];
  isLoading?: boolean;
  showEmployee?: boolean;
  /** Owner-only session controls. Omitted entirely for a manager. */
  renderActions?: (row: LoginHistoryRow) => React.ReactNode;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          {showEmployee && <TableHead className="min-w-[13rem]">Employee</TableHead>}
          <TableHead>Login</TableHead>
          <TableHead>Logout</TableHead>
          <TableHead className="text-right">Duration</TableHead>
          <TableHead>Device</TableHead>
          <TableHead>OS</TableHead>
          <TableHead>Browser</TableHead>
          <TableHead>IP Address</TableHead>
          <TableHead>Session</TableHead>
          {renderActions && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>

      <TableBody>
        {isLoading ? (
          <EmployeeTableSkeleton
            columns={(showEmployee ? 10 : 9) + (renderActions ? 1 : 0)}
            rows={6}
          />
        ) : (
          rows.map((row) => (
            <TableRow
              key={row.id}
              className={cn(
                // A failed attempt is tinted rather than badged-only: it must be
                // findable by scanning the table, not by reading every status.
                !row.isSuccessful && "bg-destructive/5"
              )}
            >
              <TableCell className="whitespace-nowrap font-medium">
                {formatDate(row.loginAt)}
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

              <TableCell className="whitespace-nowrap tabular-nums">
                {formatTime(row.loginAt)}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {row.logoutAt ? (
                  formatTime(row.logoutAt)
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatDuration(row.durationMinutes)}
              </TableCell>

              <TableCell>
                <span className="inline-flex items-center gap-1.5 text-xs">
                  <DeviceIcon device={row.device} />
                  {row.device ?? "Unknown"}
                </span>
              </TableCell>
              <TableCell className="text-xs">{row.operatingSystem ?? "Unknown"}</TableCell>
              <TableCell className="text-xs">{row.browser ?? "Unknown"}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {row.ipAddress ?? "—"}
              </TableCell>

              <TableCell>
                {row.isSuccessful ? (
                  <div className="flex flex-col gap-1">
                    <SessionBadge status={row.sessionStatus} />
                    {/* An owner-forced logout is materially different from the
                        user signing themselves out, so it says so. */}
                    {row.wasTerminated && (
                      <span className="text-[11px] text-destructive">Force-ended</span>
                    )}
                  </div>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 text-xs font-medium text-destructive"
                    title={row.failureReason ?? "Failed login"}
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Failed
                  </span>
                )}
              </TableCell>

              {renderActions && (
                <TableCell className="text-right">{renderActions(row)}</TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
