/**
 * Employee detail drawer — the module's deep view.
 *
 * Two things here are load-bearing:
 *
 *   1. LAZY TABS. Only the active tab's component is mounted, and each tab's
 *      query is `enabled`-gated on being active. Opening the drawer costs one
 *      detail request plus (once the user picks a tab) that tab's request —
 *      never six. Unmounting inactive tabs also throws away their local page
 *      state, which is the behaviour we want: reopening Activity should start
 *      at page 1, not wherever it was left.
 *
 *   2. NOT MOUNTED WHEN CLOSED. The base Drawer primitive renders its markup
 *      regardless of `open` (it animates via translate), so gating on
 *      `employeeId` here is what stops a closed drawer from holding queries
 *      alive in the background.
 *
 * Owner-only actions live in the footer and are gated on `canManageEmployees`.
 * That gate is convenience — every mutation independently 403s for a manager.
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, IndianRupee, KeyRound, Receipt, ShieldCheck, UserCog } from "lucide-react";

import { Button, Drawer } from "@/components/ui";
import { canAssignRole, canManageEmployees } from "@/features/auth";
import { useAuthStore } from "@/store/auth.store";
import { cn } from "@/utils/cn";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { AttendanceBadge, EmploymentBadge, PresenceDot, RoleBadge } from "./EmployeeStatusBadge";
import {
  ActivityTab,
  AttendanceTab,
  DRAWER_TABS,
  DrawerHeaderStat,
  NotesTab,
  OverviewTab,
  PerformanceTab,
  PermissionsTab,
  SalesTab,
  SessionsTab,
  type DrawerTab,
} from "./EmployeeDrawerTabs";
import { useEmployee } from "../hooks/useWorkforce";
import { formatCurrency, formatDuration, formatPercent } from "../utils/format";
import type { WorkforceEmployee } from "../types";

interface Props {
  /** The row that was clicked. Its fields render the header before detail arrives. */
  employee: WorkforceEmployee | null;
  open: boolean;
  onClose: () => void;
  /** Owner-only callbacks. Omitted by the manager portal, which has no writes. */
  onEdit?: (employee: WorkforceEmployee) => void;
  onResetPassword?: (employee: WorkforceEmployee) => void;
  onChangeRole?: (employee: WorkforceEmployee) => void;
}

export function EmployeeDrawer({
  employee,
  open,
  onClose,
  onEdit,
  onResetPassword,
  onChangeRole,
}: Props) {
  const [tab, setTab] = useState<DrawerTab>("overview");

  const role = useAuthStore((s) => s.user?.role ?? null);
  const canManage = canManageEmployees(role);

  // Owner-only tabs (Notes) are removed from the bar entirely rather than shown
  // disabled: a disabled "Notes" tab still tells a manager that private notes
  // exist, which is precisely what the feature is meant to keep private.
  const visibleTabs = useMemo(
    () => DRAWER_TABS.filter((t) => !t.ownerOnly || canManage),
    [canManage]
  );

  // Reset to Overview whenever a DIFFERENT employee is opened. Keeping the
  // previous employee's tab would show, say, the Permissions tab of someone the
  // user never asked about.
  useEffect(() => {
    setTab("overview");
  }, [employee?.id]);

  // If the active tab is no longer visible (a role change mid-session demotes
  // the viewer while Notes is open), fall back rather than render a blank panel.
  useEffect(() => {
    if (!visibleTabs.some((t) => t.id === tab)) setTab("overview");
  }, [visibleTabs, tab]);

  const { data: detail, isLoading } = useEmployee(open ? employee?.id : undefined);

  if (!employee) return null;

  const canChangeThisRole =
    canManage && employee.role !== "OWNER" && canAssignRole(role, employee.role);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="w-full max-w-3xl"
      footer={
        canManage ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onResetPassword && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onResetPassword(employee)}
                leftIcon={<KeyRound className="h-3.5 w-3.5" />}
              >
                Reset Password
              </Button>
            )}
            {onChangeRole && canChangeThisRole && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onChangeRole(employee)}
                leftIcon={<ShieldCheck className="h-3.5 w-3.5" />}
              >
                Change Role
              </Button>
            )}
            {onEdit && (
              <Button
                size="sm"
                onClick={() => onEdit(employee)}
                leftIcon={<UserCog className="h-3.5 w-3.5" />}
              >
                Edit Employee
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {/* ── Identity header ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 border-b border-border pb-4">
        <div className="flex items-start gap-4">
          <EmployeeAvatar
            id={employee.id}
            firstName={employee.firstName}
            lastName={employee.lastName}
            photoUrl={employee.photoUrl}
            presence={employee.presence}
            size="lg"
          />

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold leading-tight">
              {employee.fullName}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {employee.employeeCode} · {employee.phone}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <RoleBadge role={employee.role} />
              <EmploymentBadge status={employee.employmentStatus} />
              <AttendanceBadge status={employee.attendanceStatus} />
              <PresenceDot presence={employee.presence} withLabel />
            </div>
          </div>
        </div>

        {/* At-a-glance strip: the four numbers that decide whether the reader
            needs to open a tab at all. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <DrawerHeaderStat
            icon={IndianRupee}
            label="Sales today"
            value={formatCurrency(employee.todayRevenue)}
          />
          <DrawerHeaderStat
            icon={Receipt}
            label="Transactions"
            value={String(employee.todayTransactions)}
          />
          <DrawerHeaderStat
            icon={CalendarCheck}
            label="Worked today"
            value={formatDuration(employee.workedMinutesToday)}
          />
          <DrawerHeaderStat
            icon={CalendarCheck}
            label="Attendance"
            value={formatPercent(employee.attendancePercentage, 0)}
          />
        </div>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Employee details"
        className="sticky top-0 z-10 -mx-6 mb-4 flex gap-1 overflow-x-auto border-b border-border bg-card px-6"
      >
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2.5 text-sm transition-colors",
              tab === t.id
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Active tab only ───────────────────────────────────────────────── */}
      <div role="tabpanel">
        {tab === "overview" && <OverviewTab employee={detail} isLoading={isLoading} />}
        {tab === "sales" && <SalesTab employeeId={employee.id} active />}
        {tab === "attendance" && <AttendanceTab employeeId={employee.id} active />}
        {tab === "performance" && <PerformanceTab employeeId={employee.id} active />}
        {tab === "activity" && <ActivityTab employeeId={employee.id} active />}
        {tab === "sessions" && <SessionsTab employeeId={employee.id} active />}
        {tab === "permissions" && <PermissionsTab employeeId={employee.id} active />}
        {/* Double-gated: the tab is filtered out of the bar for a manager AND
            `active` is false, so the owner-only query never fires for them. */}
        {tab === "notes" && <NotesTab employeeId={employee.id} active={canManage} />}
      </div>
    </Drawer>
  );
}
