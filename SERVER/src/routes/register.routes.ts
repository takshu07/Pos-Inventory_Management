// =============================================================================
// CASH REGISTER ROUTES  —  /api/v1/register
//
// This is the OPERATIONAL tree: opening a drawer, dropping cash, paying out,
// closing a shift. Every authenticated role reaches it, because a drawer is
// shop-floor work — a cashier who cannot open their own till cannot sell.
//
// Authorization is deliberately NOT expressed as route guards for most of this
// tree. A cashier and an owner hit the same endpoints; what differs is WHICH
// sessions they may touch, and that is a per-row decision the service makes
// (assertCanViewSession / assertCanOperateSession). A role guard here could
// only answer "may this role call this path at all", which is the wrong
// question for a resource scoped by ownership.
//
// The two exceptions are structural rather than row-scoped, and are guarded:
//   • /reconcile   — supervisor sign-off (MANAGER+), also re-checked in the
//                    service, which additionally forbids self-reconciliation.
//   • /adjustments — posting cash into a drawer without a sale (MANAGER+).
//
// Oversight endpoints that expose EVERY employee's drawer live in
// owner.finance.routes.ts instead, behind an OWNER guard.
// =============================================================================

import { Router } from "express";

import * as register from "../controllers/cashRegister.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

router.use(authenticate);

// ── Live drawer ─────────────────────────────────────────────────────────────
// Declared before the parameterised routes so "live", "history", "drops" and
// "payouts" can never be captured as a session id. Express resolves in
// declaration order, so a literal path must precede its parameterised sibling.
router.get("/live", register.getLive);
router.get("/registers", register.listRegisterNumbers);

// ── Lists (each scoped to the caller by the service) ─────────────────────────
router.get("/history", register.listHistory);
router.get("/history/export", register.exportHistory);
router.get("/drops", register.listDrops);
router.get("/drops/export", register.exportDrops);
router.get("/payouts", register.listPayouts);
router.get("/payouts/export", register.exportPayouts);

// ── Session lifecycle ───────────────────────────────────────────────────────
router.post("/open", register.openRegister);
router.get("/:id/close-preview", validateParam("id"), register.getClosePreview);
router.post("/:id/close", validateParam("id"), register.closeRegister);

// Supervisor sign-off. Guarded here AND in the service, which additionally
// refuses to let a manager reconcile a shift they themselves worked.
router.post(
  "/:id/reconcile",
  validateParam("id"),
  requireRole("MANAGER"),
  register.reconcileRegister
);

// ── Drawer movements ────────────────────────────────────────────────────────
router.post("/:id/drops", validateParam("id"), register.createDrop);
router.post("/:id/payouts", validateParam("id"), register.createPayout);
router.post("/:id/notes", validateParam("id"), register.addNote);

// A cashier who can add cash to their own expected balance can cover any
// shortage they like, so adjustments are a supervisor tool.
router.post(
  "/:id/adjustments",
  validateParam("id"),
  requireRole("MANAGER"),
  register.createAdjustment
);

// ── Session detail ──────────────────────────────────────────────────────────
router.get("/:id/summary", validateParam("id"), register.getSummary);
router.get("/:id/summary/export", validateParam("id"), register.exportSummary);
router.get("/:id/activity", validateParam("id"), register.listActivity);

export default router;
