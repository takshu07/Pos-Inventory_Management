// =============================================================================
// OWNER DISCOUNT ROUTES  —  /api/v1/owner/discounts
//
// Catalog discount administration. EVERY endpoint here is OWNER-only: the guard
// is applied to the whole router, so no endpoint can be added later without
// inheriting it. A MANAGER or CASHIER calling any of these gets 403 from
// requireRole("OWNER") before the controller runs. Hiding the nav entry on the
// frontend is a convenience, NOT the security boundary; this is.
//
// Managers read pricing (not rules) through /api/v1/pricing — see
// pricing.routes.ts. Cashiers have no discount access at all; the POS simply
// consumes effective prices.
// =============================================================================

import { Router } from "express";

import * as discountController from "../controllers/discountRule.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// Layer 1: authenticated. Layer 2: OWNER. Applied to the entire router.
router.use(authenticate);
router.use(requireRole("OWNER"));

// ── Collection-level & static paths (declared before "/:id") ──────────────────
router.get("/", discountController.list);
router.get("/dashboard", discountController.dashboard);
router.get("/history", discountController.history);
router.get("/impact", discountController.previewImpact);

router.post("/product", discountController.createProduct);
router.post("/category", discountController.createCategory);
router.post("/bulk", discountController.bulk);

// ── Item-level ────────────────────────────────────────────────────────────────
router.get("/:id", validateParam("id"), discountController.getById);
router.patch("/:id", validateParam("id"), discountController.update);
router.delete("/:id", validateParam("id"), discountController.remove);

export default router;
