// =============================================================================
// WORKFORCE EXPORT SERVICE
//
// Exports the four workforce reports: attendance, performance, login history
// and employee activity.
//
// Two decisions worth stating:
//
//   1. EXPORTS RUN THROUGH THE SAME SERVICE FUNCTIONS THE SCREENS USE. An
//      export must agree with what the user is looking at, and the only way to
//      guarantee that is to read the same code path — including its RBAC
//      scoping, so a manager's export contains exactly the rows a manager's
//      screen does. A bespoke query here would drift the first time either
//      changed.
//
//   2. EXPORTS COVER EVERY MATCHING ROW, NOT THE CURRENT PAGE. Exporting what
//      happens to be on screen is a subtly wrong file — the user asked for
//      "the attendance report", not "page 3 of it". A hard cap keeps that from
//      becoming an unbounded query.
//
// The CSV/Excel/PDF writing itself is delegated to utils/exportRenderer, shared
// with the category module. Nothing about table rendering is re-implemented.
// =============================================================================

import {
  fileStamp,
  renderExport,
  type ExportColumn,
  type ExportFormat,
  type ExportPayload,
} from "../utils/exportRenderer";
import {
  getActivity,
  getAttendance,
  getLoginHistory,
  getPerformance,
} from "./workforce.service";
import type { AuthenticatedUser } from "../types/employee.types";
import type {
  ActivityQuery,
  AttendanceQuery,
  LoginHistoryQuery,
  PerformanceQuery,
} from "../validation/workforce.validation";

/**
 * Upper bound on an export.
 *
 * Generous enough that a year of attendance for a 50-person shop fits, small
 * enough that a malformed filter cannot pull the whole table into memory.
 */
const EXPORT_LIMIT = 5000;

export type WorkforceReport = "attendance" | "performance" | "login-history" | "activity";

function formatDateTime(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 16).replace("T", " ");
}

function periodLabel(from: Date, to: Date): string {
  return `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`;
}

// ── Column sets ──────────────────────────────────────────────────────────────

const ATTENDANCE_COLUMNS: ExportColumn[] = [
  { key: "date", label: "Date", type: "date" },
  { key: "employeeName", label: "Employee", type: "text" },
  { key: "employeeCode", label: "Employee ID", type: "text" },
  { key: "role", label: "Role", type: "text" },
  { key: "shift", label: "Shift", type: "text" },
  { key: "clockIn", label: "Clock In", type: "text" },
  { key: "clockOut", label: "Clock Out", type: "text" },
  { key: "breakMinutes", label: "Break (min)", type: "number" },
  { key: "workedMinutes", label: "Worked (min)", type: "number" },
  { key: "lateMinutes", label: "Late (min)", type: "number" },
  { key: "overtimeMinutes", label: "Overtime (min)", type: "number" },
  { key: "status", label: "Status", type: "text" },
  { key: "source", label: "Source", type: "text" },
];

const PERFORMANCE_COLUMNS: ExportColumn[] = [
  { key: "rank", label: "Rank", type: "number" },
  { key: "employeeName", label: "Employee", type: "text" },
  { key: "employeeCode", label: "Employee ID", type: "text" },
  { key: "role", label: "Role", type: "text" },
  { key: "revenue", label: "Revenue", type: "currency" },
  { key: "transactions", label: "Transactions", type: "number" },
  { key: "averageBill", label: "Avg Bill", type: "currency" },
  { key: "unitsSold", label: "Units Sold", type: "number" },
  { key: "returns", label: "Returns", type: "number" },
  { key: "refundValue", label: "Refund Value", type: "currency" },
  { key: "returnPercentage", label: "Return %", type: "percent" },
  { key: "exchanges", label: "Exchanges", type: "number" },
  { key: "discountGiven", label: "Discount Given", type: "currency" },
  { key: "discountPercentage", label: "Discount %", type: "percent" },
  { key: "attendancePercentage", label: "Attendance %", type: "percent" },
  { key: "monthlyTarget", label: "Monthly Target", type: "currency" },
  { key: "targetAchievement", label: "Target %", type: "percent" },
  { key: "performanceScore", label: "Score", type: "number" },
];

const LOGIN_HISTORY_COLUMNS: ExportColumn[] = [
  { key: "loginAt", label: "Login", type: "text" },
  { key: "employeeName", label: "Employee", type: "text" },
  { key: "employeeCode", label: "Employee ID", type: "text" },
  { key: "role", label: "Role", type: "text" },
  { key: "logoutAt", label: "Logout", type: "text" },
  { key: "durationMinutes", label: "Duration (min)", type: "number" },
  { key: "device", label: "Device", type: "text" },
  { key: "operatingSystem", label: "OS", type: "text" },
  { key: "browser", label: "Browser", type: "text" },
  { key: "ipAddress", label: "IP Address", type: "text" },
  { key: "sessionStatus", label: "Session", type: "text" },
  { key: "outcome", label: "Outcome", type: "text" },
  { key: "endReason", label: "End Reason", type: "text" },
];

const ACTIVITY_COLUMNS: ExportColumn[] = [
  { key: "createdAt", label: "Time", type: "text" },
  { key: "employeeName", label: "Employee", type: "text" },
  { key: "employeeCode", label: "Employee ID", type: "text" },
  { key: "role", label: "Role", type: "text" },
  { key: "module", label: "Module", type: "text" },
  { key: "actionType", label: "Action", type: "text" },
  { key: "description", label: "Description", type: "text" },
  { key: "severity", label: "Severity", type: "text" },
  { key: "referenceType", label: "Record Type", type: "text" },
  { key: "referenceId", label: "Record", type: "text" },
];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Builds one of the four workforce reports.
 *
 * `query` is the SAME shape the list endpoints take, so the client passes its
 * current filters straight through and gets a file matching the screen.
 */
export async function exportWorkforceReport(
  report: WorkforceReport,
  format: ExportFormat,
  query: Record<string, unknown>,
  actor: AuthenticatedUser
): Promise<ExportPayload> {
  switch (report) {
    case "attendance":
      return exportAttendance(format, query as unknown as AttendanceQuery, actor);
    case "performance":
      return exportPerformance(format, query as unknown as PerformanceQuery, actor);
    case "login-history":
      return exportLoginHistory(format, query as unknown as LoginHistoryQuery, actor);
    case "activity":
    default:
      return exportActivity(format, query as unknown as ActivityQuery, actor);
  }
}

async function exportAttendance(
  format: ExportFormat,
  query: AttendanceQuery,
  actor: AuthenticatedUser
): Promise<ExportPayload> {
  const result = await getAttendance(
    { ...query, page: 1, limit: EXPORT_LIMIT } as AttendanceQuery,
    actor
  );

  const rows = result.data.map((r) => ({
    date: r.date,
    employeeName: r.employee?.fullName ?? "",
    employeeCode: r.employee?.employeeCode ?? "",
    role: r.employee?.role ?? "",
    shift: r.shift?.name ?? "",
    clockIn: formatDateTime(r.clockInAt),
    clockOut: formatDateTime(r.clockOutAt),
    breakMinutes: r.breakMinutes,
    workedMinutes: r.workedMinutes,
    lateMinutes: r.lateMinutes,
    overtimeMinutes: r.overtimeMinutes,
    status: r.status,
    source: r.source,
  }));

  return renderExport(format, ATTENDANCE_COLUMNS, rows, {
    base: `attendance-${fileStamp()}`,
    title: "Attendance Report",
    subtitle: `${rows.length} record${rows.length === 1 ? "" : "s"}`,
    sheet: "Attendance",
  });
}

async function exportPerformance(
  format: ExportFormat,
  query: PerformanceQuery,
  actor: AuthenticatedUser
): Promise<ExportPayload> {
  const result = await getPerformance(query, actor);

  const rows = result.data.map((r) => ({
    rank: r.rank,
    employeeName: r.fullName,
    employeeCode: r.employeeCode,
    role: r.role,
    revenue: r.revenue,
    transactions: r.transactions,
    averageBill: r.averageBill,
    unitsSold: r.unitsSold,
    returns: r.returns,
    refundValue: r.refundValue,
    returnPercentage: r.returnPercentage,
    exchanges: r.exchanges,
    discountGiven: r.discountGiven,
    discountPercentage: r.discountPercentage,
    attendancePercentage: r.attendancePercentage,
    // Null stays null so the cell is BLANK rather than 0 — an unset target must
    // not export as a zero that a spreadsheet would then average in.
    monthlyTarget: r.monthlyTarget,
    targetAchievement: r.targetAchievement,
    performanceScore: r.performanceScore,
  }));

  return renderExport(format, PERFORMANCE_COLUMNS, rows, {
    base: `performance-${fileStamp()}`,
    title: "Performance Report",
    subtitle: periodLabel(result.period.from, result.period.to),
    sheet: "Performance",
  });
}

async function exportLoginHistory(
  format: ExportFormat,
  query: LoginHistoryQuery,
  actor: AuthenticatedUser
): Promise<ExportPayload> {
  const result = await getLoginHistory(
    { ...query, page: 1, limit: EXPORT_LIMIT } as LoginHistoryQuery,
    actor
  );

  const rows = result.data.map((r) => ({
    loginAt: formatDateTime(r.loginAt),
    employeeName: r.employee?.fullName ?? "",
    employeeCode: r.employee?.employeeCode ?? "",
    role: r.employee?.role ?? "",
    logoutAt: formatDateTime(r.logoutAt),
    durationMinutes: r.durationMinutes,
    device: r.device ?? "",
    operatingSystem: r.operatingSystem ?? "",
    browser: r.browser ?? "",
    ipAddress: r.ipAddress ?? "",
    sessionStatus: r.sessionStatus,
    // Failed attempts are the reason this report exists — the outcome column
    // makes them filterable in the spreadsheet without reading every row.
    outcome: r.isSuccessful ? "Success" : `Failed: ${r.failureReason ?? "unknown"}`,
    endReason: r.endReason ?? "",
  }));

  return renderExport(format, LOGIN_HISTORY_COLUMNS, rows, {
    base: `login-history-${fileStamp()}`,
    title: "Login History",
    subtitle: `${rows.length} session${rows.length === 1 ? "" : "s"}`,
    sheet: "Login History",
  });
}

async function exportActivity(
  format: ExportFormat,
  query: ActivityQuery,
  actor: AuthenticatedUser
): Promise<ExportPayload> {
  const result = await getActivity(
    { ...query, page: 1, limit: EXPORT_LIMIT } as ActivityQuery,
    actor
  );

  const rows = result.data.map((r) => ({
    createdAt: formatDateTime(r.createdAt),
    employeeName: r.employee?.fullName ?? "",
    employeeCode: r.employee?.employeeCode ?? "",
    role: r.employee?.role ?? "",
    module: r.module,
    actionType: r.actionType,
    description: r.description,
    severity: r.severity,
    referenceType: r.referenceType ?? "",
    referenceId: r.referenceId ?? "",
  }));

  return renderExport(format, ACTIVITY_COLUMNS, rows, {
    base: `employee-activity-${fileStamp()}`,
    title: "Employee Activity",
    subtitle: `${rows.length} action${rows.length === 1 ? "" : "s"}`,
    sheet: "Activity",
  });
}
