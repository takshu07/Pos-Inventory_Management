// =============================================================================
// MANAGER WORKFORCE ROUTES  —  /api/v1/manager/workforce
//
// The READ-ONLY workforce surface a manager may use to monitor the team.
//
// Two independent guarantees make this safe, and both are deliberate:
//
//   1. STRUCTURAL — only GET handlers are registered here (plus the manager's
//      own clock in/out, which acts on themselves). There is no route to
//      update, deactivate, reset a password or change a role, so a manager
//      cannot reach those operations through this tree at all. Omitting a route
//      is a stronger control than guarding one.
//
//   2. DATA SCOPING — the service narrows every result to the manager's
//      visible roles and strips compensation, so even the shared read handlers
//      return less here than they do for an owner. A manager requesting the
//      owner's employee id gets a 404, not a redacted record.
//
// Managers hitting /api/v1/owner/workforce/* are rejected by that tree's
// OWNER guard. The frontend hides those actions too, but the hiding is
// convenience — these two layers are the boundary.
// =============================================================================

import { Router } from "express";

import * as workforce from "../controllers/workforce.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// MANAGER or higher. An OWNER may also use this tree — they simply receive the
// wider, unnarrowed results, since the service scopes by the actor's role.
router.use(authenticate, requireRole("MANAGER"));

// ── Dashboard ───────────────────────────────────────────────────────────────
router.get("/summary", workforce.summary);
router.get("/shifts", workforce.shifts);

// ── Roster (read-only) ──────────────────────────────────────────────────────
router.get("/employees", workforce.listEmployees);
router.get("/managers", workforce.listManagers);
router.get("/managers/stats", workforce.managerStats);
router.get("/staff", workforce.listStaff);
router.get("/staff/stats", workforce.staffStats);

// ── Module-level pages ──────────────────────────────────────────────────────
// Registered before /employees/:id so these literals are never parsed as ids.
router.get("/activity", workforce.activity);
router.get("/attendance", workforce.attendance);
router.get("/attendance/summary", workforce.attendanceSummary);
router.get("/login-history", workforce.loginHistory);
// Performance is exposed to managers, but the service restricts it to their own
// team (managers + cashiers) — the owner's figures are never included.
router.get("/performance", workforce.performance);

// ── Employee detail + lazily-loaded drawer tabs ─────────────────────────────
router.get("/employees/:id", validateParam("id"), workforce.getEmployee);
router.get("/employees/:id/sales", validateParam("id"), workforce.employeeSales);
router.get("/employees/:id/attendance", validateParam("id"), workforce.employeeAttendance);
router.get("/employees/:id/activity", validateParam("id"), workforce.employeeActivity);
router.get("/employees/:id/login-history", validateParam("id"), workforce.employeeLoginHistory);
router.get("/employees/:id/permissions", validateParam("id"), workforce.employeePermissions);

// ── Self-service attendance ─────────────────────────────────────────────────
// A manager clocks THEMSELVES in and out. The service rejects an employeeId
// that is not the caller's own unless the actor is an OWNER, so this cannot be
// used to record attendance for someone else.
router.post("/attendance/clock-in", workforce.clockIn);
router.post("/attendance/clock-out", workforce.clockOut);

export default router;
