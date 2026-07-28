// =============================================================================
// LABEL ROUTES  —  /api/v1/labels
//
// Operational printing surface, reachable by every authenticated role. The
// RBAC matrix from the spec is enforced in two layers:
//
//   Layer 1 (here)            authentication, and requireRole where a whole
//                             endpoint is off-limits to a role.
//   Layer 2 (labelService)    the conditional rules a route cannot express —
//                             a CASHIER may print and reprint but not batch
//                             print, and may only see their OWN jobs.
//
// Printer and template ADMINISTRATION is not in this file at all; it lives in
// owner.labels.routes.ts behind requireRole("OWNER").
// =============================================================================

import { Router } from "express";

import * as labelController from "../controllers/label.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// Every label endpoint requires an authenticated user.
router.use(authenticate);

// ─── Preview (ALL ROLES) ──────────────────────────────────────────────────────
// Cashiers must be able to check a label before consuming media.

router.get("/preview", labelController.preview);
router.post("/preview", labelController.preview);
/** Raw SVG — lets <img src> point at a label directly. */
router.get("/preview.svg", labelController.previewSvg);

// ─── PDF (ALL ROLES; batch sizes gated in the service) ────────────────────────

router.post("/pdf", labelController.generatePdf);

// ─── Printing ─────────────────────────────────────────────────────────────────
// Single-item print: ALL ROLES. Multi-item requests are rejected for cashiers
// inside labelService (assertCanBatchPrint), so a cashier cannot escalate by
// posting an array here.

router.post("/print", labelController.print);

// Batch printing: MANAGER + OWNER only.
router.post("/print/batch", requireRole("MANAGER"), labelController.printBatch);

// Reprint: ALL ROLES (a cashier may reprint a damaged single label).
router.post("/jobs/:id/reprint", validateParam("id"), labelController.reprint);

// ─── Module-scoped printing ───────────────────────────────────────────────────
// These are what the Product/Purchase/Inventory/Search screens call. They are
// thin: each resolves its own quantity semantics then enqueues one job.

router.post(
  "/print/product/:productId",
  validateParam("productId"),
  labelController.printProduct
);

// Purchase and inventory label runs are procurement/stock operations → MANAGER+.
router.post(
  "/print/purchase/:purchaseId",
  requireRole("MANAGER"),
  validateParam("purchaseId"),
  labelController.printPurchase
);

router.post("/print/inventory", requireRole("MANAGER"), labelController.printInventory);

router.post("/print/search", labelController.printFromSearch);

// ─── Queue ────────────────────────────────────────────────────────────────────
// Visible to all roles; labelService scopes a cashier to their own jobs.

router.get("/queue", labelController.getQueue);
router.get("/queue/stats", labelController.getQueueStats);

router.get("/jobs", labelController.listJobs);
router.get("/jobs/:id", validateParam("id"), labelController.getJob);
router.post("/jobs/:id/cancel", validateParam("id"), labelController.cancelJob);
router.post("/jobs/:id/retry", validateParam("id"), labelController.retryJob);

export default router;
