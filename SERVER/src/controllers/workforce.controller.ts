// =============================================================================
// WORKFORCE CONTROLLER
//
// Thin HTTP adapter: parse → call service → format. No business logic and no
// authorization decisions live here — `req.user` is passed through to the
// service, which is the single place that decides what this actor may see.
//
// One controller serves BOTH the owner and manager route trees. The routes
// differ in which handlers they expose and what role guard they sit behind;
// the handlers themselves are identical because the service already narrows
// results per actor. That is what stops the two surfaces from drifting.
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import * as workforceService from "../services/workforce.service";
import * as workforceExportService from "../services/workforceExport.service";
import { asyncHandler } from "../utils/asyncHandler";
import { workforceValidation } from "../validation/workforce.validation";
import type { EmployeeRole } from "../../generated/prisma";
import type { RosterQuery } from "../validation/workforce.validation";

// =============================================================================
// DASHBOARD
// =============================================================================

/** GET /workforce/summary — the dashboard cards. */
export const summary = asyncHandler(async (req: Request, res: Response) => {
  const data = await workforceService.getWorkforceSummary(req.user);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

// =============================================================================
// ROSTER
// =============================================================================

/** GET /workforce/employees — full roster (role filter optional). */
export const listEmployees = asyncHandler(async (req: Request, res: Response) => {
  const query = workforceValidation.rosterQuery.parse(req.query) as RosterQuery;
  const result = await workforceService.listRoster(query, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/**
 * GET /workforce/managers — the Managers tab.
 * A dedicated endpoint rather than `?role=MANAGER` so the tab's meaning is
 * fixed by the API, not by a caller-supplied filter that could be tampered with.
 */
export const listManagers = asyncHandler(async (req: Request, res: Response) => {
  const parsed = workforceValidation.rosterQuery.parse(req.query) as RosterQuery;
  const query: RosterQuery = { ...parsed, role: "MANAGER" };
  const result = await workforceService.listRoster(query, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/** GET /workforce/managers/stats */
export const managerStats = asyncHandler(async (req: Request, res: Response) => {
  const data = await workforceService.getRosterStats(["MANAGER"], req.user);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/**
 * GET /workforce/staff — the Employees tab (cashiers + managers, excluding
 * the owner, who is not "staff" in the operational sense).
 */
export const listStaff = asyncHandler(async (req: Request, res: Response) => {
  const parsed = workforceValidation.rosterQuery.parse(req.query) as RosterQuery;
  // An explicit role filter from the UI still wins, but never widens scope —
  // the service intersects it with what this actor may see.
  const result = await workforceService.listRoster(parsed, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/** GET /workforce/staff/stats */
export const staffStats = asyncHandler(async (req: Request, res: Response) => {
  const roles = (req.query["role"] ? [req.query["role"]] : ["MANAGER", "CASHIER"]) as EmployeeRole[];
  const data = await workforceService.getRosterStats(roles, req.user);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /workforce/employees/:id — drawer Overview tab. */
export const getEmployee = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const data = await workforceService.getEmployeeDetail(id, req.user);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

// =============================================================================
// DRAWER TABS (each lazily fetched by the client when its tab is opened)
// =============================================================================

/** GET /workforce/employees/:id/sales */
export const employeeSales = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const query = workforceValidation.performanceQuery.parse(req.query);
  const data = await workforceService.getEmployeeSales(id, query, req.user);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /workforce/employees/:id/attendance */
export const employeeAttendance = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const parsed = workforceValidation.attendanceQuery.parse(req.query);
  const query = { ...parsed, employeeId: id };

  const [list, summaryData] = await Promise.all([
    workforceService.getAttendance(query, req.user),
    workforceService.getAttendanceSummary(query, req.user),
  ]);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: { records: list.data, summary: summaryData },
    meta: list.meta,
  });
});

/** GET /workforce/employees/:id/activity */
export const employeeActivity = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const parsed = workforceValidation.activityQuery.parse(req.query);
  const result = await workforceService.getActivity(
    { ...parsed, employeeId: id } as Parameters<typeof workforceService.getActivity>[0],
    req.user
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/** GET /workforce/employees/:id/login-history */
export const employeeLoginHistory = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const parsed = workforceValidation.loginHistoryQuery.parse(req.query);
  const result = await workforceService.getLoginHistory({ ...parsed, employeeId: id }, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/** GET /workforce/employees/:id/permissions — read-only permission matrix. */
export const employeePermissions = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const data = await workforceService.getPermissions(id, req.user);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

// =============================================================================
// MODULE-LEVEL SURFACES
// =============================================================================

/** GET /workforce/activity — the org-wide Activity Timeline page. */
export const activity = asyncHandler(async (req: Request, res: Response) => {
  const query = workforceValidation.activityQuery.parse(req.query);
  const result = await workforceService.getActivity(
    query as Parameters<typeof workforceService.getActivity>[0],
    req.user
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/** GET /workforce/attendance — the Attendance page. */
export const attendance = asyncHandler(async (req: Request, res: Response) => {
  const query = workforceValidation.attendanceQuery.parse(req.query);
  const result = await workforceService.getAttendance(query, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/** GET /workforce/attendance/summary — cards + trend for the Attendance page. */
export const attendanceSummary = asyncHandler(async (req: Request, res: Response) => {
  const query = workforceValidation.attendanceQuery.parse(req.query);
  const data = await workforceService.getAttendanceSummary(query, req.user);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /workforce/login-history — the Login History page. */
export const loginHistory = asyncHandler(async (req: Request, res: Response) => {
  const query = workforceValidation.loginHistoryQuery.parse(req.query);
  const result = await workforceService.getLoginHistory(query, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

/** GET /workforce/performance — ranked performance. */
export const performance = asyncHandler(async (req: Request, res: Response) => {
  const query = workforceValidation.performanceQuery.parse(req.query);
  const data = await workforceService.getPerformance(query, req.user);
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** GET /workforce/shifts — shift catalogue for filters and assignment. */
export const shifts = asyncHandler(async (_req: Request, res: Response) => {
  const data = await workforceService.listShifts();
  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

// =============================================================================
// ATTENDANCE MUTATIONS
// =============================================================================

/** POST /workforce/attendance/clock-in */
export const clockIn = asyncHandler(async (req: Request, res: Response) => {
  const input = workforceValidation.clock.parse(req.body ?? {});
  const data = await workforceService.clockIn(input, req.user);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Clocked in successfully.",
    data,
  });
});

/** POST /workforce/attendance/clock-out */
export const clockOut = asyncHandler(async (req: Request, res: Response) => {
  const input = workforceValidation.clock.parse(req.body ?? {});
  const data = await workforceService.clockOut(input, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Clocked out successfully.",
    data,
  });
});

/** PUT /workforce/attendance — OWNER-only manual correction. */
export const upsertAttendance = asyncHandler(async (req: Request, res: Response) => {
  const input = workforceValidation.manualAttendance.parse(req.body);
  const data = await workforceService.upsertManualAttendance(
    input as Parameters<typeof workforceService.upsertManualAttendance>[0],
    req.user
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Attendance updated.",
    data,
  });
});

// =============================================================================
// OWNER MUTATIONS
// =============================================================================

/** PATCH /owner/workforce/employees/:id */
export const updateEmployee = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const input = workforceValidation.updateEmployee.parse(req.body);
  const data = await workforceService.updateWorkforceProfile(
    id,
    input as Parameters<typeof workforceService.updateWorkforceProfile>[1],
    req.user
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Employee updated successfully.",
    data,
  });
});

/** POST /owner/workforce/employees/:id/reset-password */
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const input = workforceValidation.resetPassword.parse(req.body);
  await workforceService.resetPassword(id, input, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Password reset. The employee has been signed out of all devices.",
  });
});

/** PATCH /owner/workforce/employees/:id/role */
export const changeRole = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const input = workforceValidation.changeRole.parse(req.body);
  const data = await workforceService.changeRole(id, input.role, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Role updated. The employee must sign in again.",
    data,
  });
});

// =============================================================================
// EMPLOYEE NOTES — OWNER-only (enforced in the service, not here)
// =============================================================================

/** GET /owner/workforce/employees/:id/notes */
export const listNotes = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const data = await workforceService.listNotes(id, req.user);

  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** POST /owner/workforce/employees/:id/notes */
export const createNote = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const input = workforceValidation.createNote.parse(req.body);
  const data = await workforceService.createNote(id, input, req.user);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Note added.",
    data,
  });
});

/** PATCH /owner/workforce/notes/:id */
export const updateNote = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const input = workforceValidation.updateNote.parse(req.body);
  const data = await workforceService.updateNote(id, input, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Note updated.",
    data,
  });
});

/** DELETE /owner/workforce/notes/:id */
export const deleteNote = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  await workforceService.deleteNote(id, req.user);

  return res.status(HTTP_STATUS.OK).json({ success: true, message: "Note deleted." });
});

// =============================================================================
// BREAKS
// =============================================================================

/** POST /workforce/attendance/break/start */
export const startBreak = asyncHandler(async (req: Request, res: Response) => {
  const input = workforceValidation.clock.parse(req.body ?? {});
  const data = await workforceService.startBreak(input, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Break started.",
    data,
  });
});

/** POST /workforce/attendance/break/end */
export const endBreak = asyncHandler(async (req: Request, res: Response) => {
  const input = workforceValidation.clock.parse(req.body ?? {});
  const data = await workforceService.endBreak(input, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Break ended.",
    data,
  });
});

// =============================================================================
// SECURITY (Login History dashboard)
// =============================================================================

/** GET /workforce/security/overview */
export const securityOverview = asyncHandler(async (req: Request, res: Response) => {
  const query = workforceValidation.securityQuery.parse(req.query);
  const data = await workforceService.getSecurityOverview(query, req.user);

  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

/** POST /owner/workforce/sessions/:id/terminate */
export const terminateSession = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const data = await workforceService.terminateSession(id, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Session terminated.",
    data,
  });
});

/** POST /owner/workforce/employees/:id/force-logout */
export const forceLogout = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const data = await workforceService.forceLogout(id, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "The employee has been signed out of all devices.",
    data,
  });
});

// =============================================================================
// COMPARISON (OWNER-only)
// =============================================================================

/** GET /owner/workforce/compare */
export const compare = asyncHandler(async (req: Request, res: Response) => {
  const query = workforceValidation.compareQuery.parse(req.query);
  const data = await workforceService.compareEmployees(query, req.user);

  return res.status(HTTP_STATUS.OK).json({ success: true, data });
});

// =============================================================================
// SHIFT MANAGEMENT (OWNER-only)
// =============================================================================

/** POST /owner/workforce/shifts */
export const createShift = asyncHandler(async (req: Request, res: Response) => {
  const input = workforceValidation.shift.parse(req.body);
  const data = await workforceService.createShift(input, req.user);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Shift created.",
    data,
  });
});

/** PATCH /owner/workforce/shifts/:id */
export const updateShift = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const input = workforceValidation.updateShift.parse(req.body);
  const data = await workforceService.updateShift(id, input, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Shift updated.",
    data,
  });
});

/** POST /owner/workforce/shifts/assign */
export const assignShift = asyncHandler(async (req: Request, res: Response) => {
  const input = workforceValidation.assignShift.parse(req.body);
  const data = await workforceService.assignShift(input, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: `Shift assigned to ${data.assigned} employee(s).`,
    data,
  });
});

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * GET /workforce/export/:report?format=csv|excel|pdf
 *
 * The remaining query string is passed through as the report's filters, so an
 * export reflects exactly the screen the user was looking at. Scoping is the
 * service's job — a manager's export contains what a manager's screen does.
 */
export const exportReport = asyncHandler(async (req: Request, res: Response) => {
  const { report, format } = workforceValidation.exportQuery.parse({
    report: req.params["report"],
    format: req.query["format"],
  });

  // `format` is consumed above; everything else is the report's own filters.
  const { format: _format, ...filters } = req.query;

  const file = await workforceExportService.exportWorkforceReport(
    report,
    format,
    filters as Record<string, unknown>,
    req.user
  );

  // Quotes and newlines stripped so a value inside the filename can never break
  // out of the header (response splitting).
  const safeName = file.filename.replace(/["\r\n]/g, "");

  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  // The payload reflects live data — never let a proxy serve a stale export.
  res.setHeader("Cache-Control", "no-store");

  return res.status(HTTP_STATUS.OK).send(file.body);
});
