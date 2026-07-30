/**
 * The live operations feed — Employee · Time · Module · Action · Status · Record.
 *
 * A TABLE rather than the drawer's timeline, because the two answer different
 * questions. The timeline answers "what did this person do today", where the
 * chronology is the point. This answers "what is happening across the shop
 * right now", where scanning a column for the one Critical row is the point —
 * and columns scan, prose does not.
 *
 * Severity is computed server-side by the workforce engine, so re-classifying
 * an action is one engine change that applies retroactively to all history.
 * Here it drives two channels deliberately: a badge (says WHAT) and a left
 * border (catches the eye while scrolling). One without the other fails at one
 * of those jobs.
 */

import { ExternalLink } from "lucide-react";

import {
  Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui";
import { cn } from "@/utils/cn";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { RoleBadge } from "./EmployeeStatusBadge";
import { EmployeeTableSkeleton } from "./EmployeeSkeleton";
import { formatTime, SEVERITY_LABELS, SEVERITY_VARIANTS } from "../utils/format";
import type { ActivityRow } from "../types";

/**
 * Where a referenced record lives, so a feed row can open the thing it happened
 * to. Only types with a real destination are listed — a row whose reference has
 * no page renders as plain text rather than a link that goes nowhere.
 */
const REFERENCE_ROUTES: Record<string, (id: string) => string> = {
  SALE: (id) => `/sales/${id}`,
  CUSTOMER: (id) => `/customers/${id}`,
  PRODUCT: (id) => `/admin/products?highlight=${id}`,
  VARIANT: (id) => `/admin/products?highlight=${id}`,
  CATEGORY: (id) => `/admin/categories?highlight=${id}`,
  EMPLOYEE: (id) => `/admin/staff?highlight=${id}`,
};

export function LiveActivityFeed({
  rows,
  isLoading,
  onEmployeeClick,
  onRecordClick,
}: {
  rows: ActivityRow[];
  isLoading?: boolean;
  /** Opens the employee drawer — the same drawer used everywhere else. */
  onEmployeeClick?: (employeeId: string) => void;
  onRecordClick?: (path: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Time</TableHead>
            <TableHead className="min-w-[13rem]">Employee</TableHead>
            <TableHead>Module</TableHead>
            <TableHead className="min-w-[16rem]">Action</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Record</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <EmployeeTableSkeleton columns={6} rows={8} />
          ) : (
            rows.map((row) => {
              const route =
                row.referenceType && row.referenceId
                  ? REFERENCE_ROUTES[row.referenceType]?.(row.referenceId)
                  : undefined;

              return (
                <TableRow
                  key={row.id}
                  className={cn(
                    "border-l-2",
                    row.severity === "CRITICAL"
                      ? "border-l-destructive bg-destructive/[0.03]"
                      : row.severity === "WARNING"
                        ? "border-l-amber-500"
                        : "border-l-transparent"
                  )}
                >
                  <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                    {formatTime(row.createdAt)}
                  </TableCell>

                  <TableCell>
                    {row.employee ? (
                      <button
                        type="button"
                        onClick={() => onEmployeeClick?.(row.employee!.id)}
                        className={cn(
                          "flex items-center gap-2.5 text-left",
                          onEmployeeClick && "cursor-pointer hover:underline"
                        )}
                      >
                        <EmployeeAvatar
                          id={row.employee.id}
                          firstName={row.employee.fullName.split(" ")[0] ?? ""}
                          lastName={row.employee.fullName.split(" ")[1] ?? ""}
                          photoUrl={row.employee.photoUrl}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm">{row.employee.fullName}</div>
                          <RoleBadge role={row.employee.role} />
                        </div>
                      </button>
                    ) : (
                      <span className="text-muted-foreground">System</span>
                    )}
                  </TableCell>

                  <TableCell className="whitespace-nowrap text-xs uppercase tracking-wide text-muted-foreground">
                    {row.module}
                  </TableCell>

                  <TableCell className="text-sm">{row.description}</TableCell>

                  <TableCell>
                    <Badge variant={SEVERITY_VARIANTS[row.severity] ?? "secondary"}>
                      {SEVERITY_LABELS[row.severity] ?? row.severity}
                    </Badge>
                  </TableCell>

                  <TableCell className="whitespace-nowrap text-xs">
                    {row.referenceId ? (
                      route && onRecordClick ? (
                        <button
                          type="button"
                          onClick={() => onRecordClick(route)}
                          className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
                        >
                          #{row.referenceId.slice(-8)}
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </button>
                      ) : (
                        // No destination for this reference type — show the id
                        // rather than a link that would go nowhere.
                        <span className="font-mono text-muted-foreground">
                          #{row.referenceId.slice(-8)}
                        </span>
                      )
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
