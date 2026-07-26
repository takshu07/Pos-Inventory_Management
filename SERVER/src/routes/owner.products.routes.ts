// =============================================================================
// OWNER PRODUCT ROUTES  —  /api/v1/owner/products
//
// Complete catalog administration. EVERY endpoint here is OWNER-only. A MANAGER
// or CASHIER who manually calls any of these — POST /owner/products,
// PATCH /owner/products/:id, DELETE /owner/products/:id — receives 403 Forbidden
// from requireRole("OWNER") before the controller runs. Nav hiding on the
// frontend is a convenience, NOT the security boundary; this is.
// =============================================================================

import { Router } from "express";

import * as ownerProductController from "../controllers/ownerProduct.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// Layer 1: must be authenticated. Layer 2: must be OWNER. Applied to the whole
// router so no endpoint can ever be added without both guards.
router.use(authenticate);
router.use(requireRole("OWNER"));

// ── Collection-level & static paths (declared before "/:id") ──────────────────
router.get("/", ownerProductController.list);
router.get("/stats", ownerProductController.stats);
router.post("/", ownerProductController.create);

router.post("/import", ownerProductController.importProducts);
router.post("/export", ownerProductController.exportProducts);

router.patch("/stock", ownerProductController.adjustStock);
router.patch("/pricing", ownerProductController.updatePricing);

// ── Item-level ────────────────────────────────────────────────────────────────
router.get("/:id", validateParam("id"), ownerProductController.getById);
router.patch("/:id", validateParam("id"), ownerProductController.update);
router.delete("/:id", validateParam("id"), ownerProductController.remove);

router.post("/:id/archive", validateParam("id"), ownerProductController.archive);
router.post("/:id/restore", validateParam("id"), ownerProductController.restore);
router.post("/:id/duplicate", validateParam("id"), ownerProductController.duplicate);

export default router;
