// =============================================================================
// MANAGER INVENTORY ROUTES  —  /api/v1/manager/inventory
//
// The operational inventory surface: read everything except cost, count stock,
// and REQUEST adjustments for an owner to approve.
//
// What is deliberately ABSENT, and why:
//
//   • /valuation, and every cost figure — a manager runs the floor; margins
//     and supplier pricing are the owner's business. The service strips cost
//     from every shared payload independently, so even the routes that ARE
//     here return less than they do for an owner.
//   • PATCH /adjustments/:id/review — a manager may request a correction but
//     not approve their own. That separation is the entire point of the
//     adjustment workflow.
//   • POST /damaged — writing off stock changes it, so it is owner-only.
//   • POST /cycle-counts/:id/complete with posting — a manager may count all
//     day, but turning findings into stock movements is an owner's decision.
//     The route IS here (a dry-run completion is legitimate) and the service
//     rejects the posting flag for non-owners.
//
// A manager hitting /api/v1/owner/inventory/* is rejected by that tree's guard.
// =============================================================================

import { Router } from "express";

import * as inventory from "../controllers/inventory.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// MANAGER or higher. An OWNER may also use this tree — they simply receive the
// wider, unnarrowed results, since the service scopes by the actor's role.
router.use(authenticate, requireRole("MANAGER"));

// ── Dashboard & operational reports (cost-free for a manager) ───────────────
router.get("/dashboard", inventory.dashboard);
router.get("/reorder", inventory.reorder);
router.get("/velocity", inventory.velocity);
router.get("/low-stock", inventory.lowStock);
router.get("/out-of-stock", inventory.outOfStock);
router.get("/aging", inventory.aging);

// ── Stock overview ──────────────────────────────────────────────────────────
router.get("/scan", inventory.scan);
router.get("/stock", inventory.listStock);
router.get("/stock/:id", validateParam("id"), inventory.getDetail);
router.get("/stock/:id/purchases", validateParam("id"), inventory.getVariantPurchases);
router.get("/stock/:id/sales", validateParam("id"), inventory.getVariantSales);

// ── Movement ledger — read-only ─────────────────────────────────────────────
router.get("/movements", inventory.listMovements);

// ── Reservations ────────────────────────────────────────────────────────────
// Holding stock for a customer is shop-floor work. It moves no stock — a
// reservation withholds goods from sale without them leaving the shelf.
router.get("/reservations", inventory.listReservations);
router.post("/reservations", inventory.createReservation);
router.post("/reservations/:id/release", validateParam("id"), inventory.releaseReservation);

// ── Adjustments — REQUEST ONLY ──────────────────────────────────────────────
// No review route here. The service also refuses a non-owner reviewer, so the
// omission is the first of two gates rather than the only one.
router.get("/adjustments", inventory.listAdjustments);
router.post("/adjustments", inventory.createAdjustment);

// ── Damaged stock — read only ───────────────────────────────────────────────
router.get("/damaged", inventory.listDamaged);

// ── Cycle counts — count freely; posting is gated in the service ────────────
router.get("/cycle-counts", inventory.listCycleCounts);
router.post("/cycle-counts", inventory.startCycleCount);
router.get("/cycle-counts/:id", validateParam("id"), inventory.getCycleCount);
router.post("/cycle-counts/:id/count", validateParam("id"), inventory.recordCount);
router.post("/cycle-counts/:id/scan", validateParam("id"), inventory.recordCountByCode);
router.post("/cycle-counts/:id/complete", validateParam("id"), inventory.completeCycleCount);

// ── Reports — READ ONLY ─────────────────────────────────────────────────────
// Exporting is reading. The export service calls the same scoped functions the
// screens use, so a manager's file carries operational columns with cost cells
// blank — never the valuation report, which the service refuses outright.
router.get("/export/:report", inventory.exportReport);

export default router;
