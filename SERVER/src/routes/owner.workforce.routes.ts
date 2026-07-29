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

export default router;
