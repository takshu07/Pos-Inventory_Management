// =============================================================================
// OWNER AUDIT LOG ROUTES  —  /api/v1/owner/audit-logs
//
// The read surface over `audit_logs`. OWNER-ONLY, with no exceptions.
//
// WHY THE GUARD IS ON THE ROUTER, NOT EACH ROUTE
// ----------------------------------------------
// `requireRole("OWNER")` is applied once to the whole tree, the same way the
// owner workforce and label trees do it. A guard you have to remember to repeat
// is a guard that will eventually be forgotten on the one route that matters.
// Applying it structurally means a route added below this line is protected by
// default rather than by discipline.
//
// WHY OWNER AND NOT MANAGER
// -------------------------
// The trail records who did what across every module, including finance, cash
// handling, salaries, and role and password changes. It is simultaneously the
// record that would expose a manager's own actions and the one that reveals
// business data they are otherwise walled off from. MANAGER is an OPERATIONAL
// role in this system; reading the audit trail is business administration.
//
// This tree is READ-ONLY. There is no POST, PATCH or DELETE, and none may be
// added — entries are written by the acting module through
// `auditRepository.create`, and an audit trail with an edit endpoint is not
// evidence of anything.
// =============================================================================

import { Router } from "express";

import * as audit from "../controllers/audit.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// Every endpoint below is OWNER-only. No exceptions past this line.
router.use(authenticate, requireRole("OWNER"));

// ── Collection ──────────────────────────────────────────────────────────────
router.get("/", audit.list);

// ── Static paths BEFORE /:id ────────────────────────────────────────────────
// Declared first so "filters" and "summary" are never captured as an entry id
// by the parameterised route below.
router.get("/filters", audit.filters);
router.get("/summary", audit.summary);

// ── Single entry ────────────────────────────────────────────────────────────
router.get("/:id", validateParam("id"), audit.detail);
router.get("/:id/related", validateParam("id"), audit.related);

export default router;
