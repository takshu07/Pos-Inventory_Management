// =============================================================================
// PRICING ROUTES  —  /api/v1/pricing
//
// READ-ONLY effective pricing, shared by the Owner and Manager portals.
//
// This is the "why is this price what it is?" surface: MRP, default discount,
// the discount currently in effect, the resulting selling price, and which rule
// produced it. Managers may look but never edit — every write lives under
// /api/v1/owner/discounts behind requireRole("OWNER").
//
// Financial fields (cost, margin, profit) are stripped for managers inside the
// controller, matching how managerProduct.service already handles them.
// =============================================================================

import { Router } from "express";

import * as discountController from "../controllers/discountRule.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// MANAGER is the minimum role; requireRole enforces the hierarchy, so OWNER
// passes too. Cashiers are rejected — the POS gets effective prices through the
// catalog/checkout path, not from here.
router.use(authenticate);
router.use(requireRole("MANAGER"));

router.get("/product/:id", validateParam("id"), discountController.getProductPricing);

export default router;
