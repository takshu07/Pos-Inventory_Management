// =============================================================================
// OWNER WORKFORCE ROUTES  —  /api/v1/owner/workforce
//
// The FULL workforce surface: everything the manager tree exposes, plus every
// mutation (edit, deactivate, reset password, change role, adjust attendance)
// and the owner-only analytics.
//
// `requireRole("OWNER")` is applied once at the router level rather than per
// route. A guard you have to remember to repeat is a guard that will eventually
// be forgotten; applying it to the whole tree makes the boundary structural.
// =============================================================================

import { Router } from "express";

import * as workforce from "../controllers/workforce.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// Every endpoint in this tree is OWNER-only. No exceptions below this line.
router.use(authenticate, requireRole("OWNER"));

// ── Dashboard ───────────────────────────────────────────────────────────────
router.get("/summary", workforce.summary);
router.get("/shifts", workforce.shifts);

// ── Roster ──────────────────────────────────────────────────────────────────
router.get("/employees", workforce.listEmployees);
router.get("/managers", workforce.listManagers);
router.get("/managers/stats", workforce.managerStats);
router.get("/staff", workforce.listStaff);
router.get("/staff/stats", workforce.staffStats);

// ── Module-level pages ──────────────────────────────────────────────────────
// Declared BEFORE the /employees/:id routes so "activity" is never captured as
// an employee id by the parameterised routes below.
router.get("/activity", workforce.activity);
router.get("/attendance", workforce.attendance);
router.get("/attendance/summary", workforce.attendanceSummary);
router.get("/login-history", workforce.loginHistory);
router.get("/performance", workforce.performance);

// ── Employee detail + lazily-loaded drawer tabs ─────────────────────────────
router.get("/employees/:id", validateParam("id"), workforce.getEmployee);
router.get("/employees/:id/sales", validateParam("id"), workforce.employeeSales);
router.get("/employees/:id/attendance", validateParam("id"), workforce.employeeAttendance);
router.get("/employees/:id/activity", validateParam("id"), workforce.employeeActivity);
router.get("/employees/:id/login-history", validateParam("id"), workforce.employeeLoginHistory);
router.get("/employees/:id/permissions", validateParam("id"), workforce.employeePermissions);

// ── Attendance mutations ────────────────────────────────────────────────────
router.post("/attendance/clock-in", workforce.clockIn);
router.post("/attendance/clock-out", workforce.clockOut);
router.put("/attendance", workforce.upsertAttendance);

// ── Roster mutations ────────────────────────────────────────────────────────
router.patch("/employees/:id", validateParam("id"), workforce.updateEmployee);
router.patch("/employees/:id/role", validateParam("id"), workforce.changeRole);
router.post("/employees/:id/reset-password", validateParam("id"), workforce.resetPassword);

// ── Breaks ──────────────────────────────────────────────────────────────────
// Two explicit endpoints rather than one toggle: a retried request must not be
// able to invert the state the caller intended.
router.post("/attendance/break/start", workforce.startBreak);
router.post("/attendance/break/end", workforce.endBreak);

// ── Employee notes — OWNER ONLY ─────────────────────────────────────────────
// These are deliberately absent from the manager route tree. The service
// refuses non-OWNER actors independently, so the omission here is the first of
// two gates, not the only one.
router.get("/employees/:id/notes", validateParam("id"), workforce.listNotes);
router.post("/employees/:id/notes", validateParam("id"), workforce.createNote);
router.patch("/notes/:id", validateParam("id"), workforce.updateNote);
router.delete("/notes/:id", validateParam("id"), workforce.deleteNote);

// ── Security dashboard ──────────────────────────────────────────────────────
router.get("/security/overview", workforce.securityOverview);
router.post("/sessions/:id/terminate", validateParam("id"), workforce.terminateSession);
router.post("/employees/:id/force-logout", validateParam("id"), workforce.forceLogout);

// ── Employee comparison ─────────────────────────────────────────────────────
router.get("/compare", workforce.compare);

// ── Shift management ────────────────────────────────────────────────────────
// `/shifts/assign` is declared BEFORE `/shifts/:id` would match it; Express
// resolves in declaration order, so a literal path must precede its parameterised
// sibling or "assign" would be read as an id.
router.post("/shifts", workforce.createShift);
router.post("/shifts/assign", workforce.assignShift);
router.patch("/shifts/:id", validateParam("id"), workforce.updateShift);

// ── Reports ─────────────────────────────────────────────────────────────────
// One endpoint, four reports, three formats. The remaining query string is the
// report's own filters, so an export matches the screen it was launched from.
router.get("/export/:report", workforce.exportReport);

export default router;
