// =============================================================================
// OWNER INVENTORY ROUTES  —  /api/v1/owner/inventory
//
// The full inventory surface: every read, plus every operation that CHANGES
// stock — approving adjustments, writing off damage, posting cycle counts.
//
// Two independent guarantees, both deliberate:
//
//   1. STRUCTURAL — the mutating routes exist ONLY in this tree. A manager
//      cannot reach approve/damage/post through the manager tree at all,
//      because those routes are not registered there. Omitting a route is a
//      stronger control than guarding one.
//
//   2. SERVICE ENFORCEMENT — inventory.service checks `scopeFor(actor)` on
//      every mutation independently. Even if this file were misconfigured, a
//      non-owner is refused by the service.
//
// Stock itself is never written here or in the service: every quantity change
// goes through executeMovement(), which is the single writer of
// ProductVariant.currentStock and the reason inventory is a ledger.
// =============================================================================

import { Router } from "express";

import * as inventory from "../controllers/inventory.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

router.use(authenticate, requireRole("OWNER"));

// ── Dashboard & analytics ───────────────────────────────────────────────────
router.get("/dashboard", inventory.dashboard);
router.get("/valuation", inventory.valuation);
router.get("/reorder", inventory.reorder);
router.get("/velocity", inventory.velocity);
router.get("/low-stock", inventory.lowStock);
router.get("/out-of-stock", inventory.outOfStock);
router.get("/aging", inventory.aging);

// ── Stock overview ──────────────────────────────────────────────────────────
// `/stock/scan` is declared BEFORE `/stock/:id` would match it; Express
// resolves in declaration order, so a literal path must precede its
// parameterised sibling or "scan" would be read as an id.
router.get("/scan", inventory.scan);
router.get("/stock", inventory.listStock);
router.get("/stock/:id", validateParam("id"), inventory.getDetail);
router.get("/stock/:id/purchases", validateParam("id"), inventory.getVariantPurchases);
router.get("/stock/:id/sales", validateParam("id"), inventory.getVariantSales);

// ── Movement ledger ─────────────────────────────────────────────────────────
router.get("/movements", inventory.listMovements);

// ── Reservations ────────────────────────────────────────────────────────────
router.get("/reservations", inventory.listReservations);
router.post("/reservations", inventory.createReservation);
router.post("/reservations/:id/release", validateParam("id"), inventory.releaseReservation);

// ── Adjustments (owner requests are auto-approved) ──────────────────────────
router.get("/adjustments", inventory.listAdjustments);
router.post("/adjustments", inventory.createAdjustment);
router.patch("/adjustments/:id/review", validateParam("id"), inventory.reviewAdjustment);

// ── Damaged stock ───────────────────────────────────────────────────────────
router.get("/damaged", inventory.listDamaged);
router.post("/damaged", inventory.reportDamage);

// ── Cycle counts ────────────────────────────────────────────────────────────
router.get("/cycle-counts", inventory.listCycleCounts);
router.post("/cycle-counts", inventory.startCycleCount);
router.get("/cycle-counts/:id", validateParam("id"), inventory.getCycleCount);
router.post("/cycle-counts/:id/count", validateParam("id"), inventory.recordCount);
router.post("/cycle-counts/:id/scan", validateParam("id"), inventory.recordCountByCode);
router.post("/cycle-counts/:id/complete", validateParam("id"), inventory.completeCycleCount);

// ── Reports ─────────────────────────────────────────────────────────────────
// Ten reports, three formats, one endpoint. The remaining query string is the
// report's own filters, so an export matches the screen it launched from.
router.get("/export/:report", inventory.exportReport);

export default router;
