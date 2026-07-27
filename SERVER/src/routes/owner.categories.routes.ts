// =============================================================================
// OWNER CATEGORY ROUTES  —  /api/v1/owner/categories
//
// Full category administration. EVERY endpoint here is OWNER-only: the guard is
// applied to the ROUTER, not to individual handlers, so a new endpoint cannot
// be added without inheriting it.
//
// A MANAGER or CASHIER calling any of these — POST /owner/categories,
// DELETE /owner/categories/:id, POST /owner/categories/bulk — receives 403 from
// requireRole("OWNER") before the controller runs. Hiding the nav item on the
// frontend is a convenience; THIS is the security boundary.
// =============================================================================

import { Router } from "express";

import * as categoryController from "../controllers/category.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// Layer 1: authenticated. Layer 2: OWNER. Both applied to the whole router.
router.use(authenticate);
router.use(requireRole("OWNER"));

// ── Collection-level & static paths (MUST precede "/:id") ────────────────────
// Express matches in declaration order; "/summary" registered after "/:id"
// would be swallowed by it and treated as a category id.
router.get("/", categoryController.list);
router.get("/summary", categoryController.summary);
router.get("/options", categoryController.options);
router.get("/export", categoryController.exportCategories);
router.get("/analytics", categoryController.analyticsDashboard);
router.get("/reports/:report", categoryController.report);

router.post("/", categoryController.create);
router.post("/bulk", categoryController.bulkAction);

// ── Item-level ───────────────────────────────────────────────────────────────
router.get("/:id", validateParam("id"), categoryController.getById);
router.patch("/:id", validateParam("id"), categoryController.update);
router.delete("/:id", validateParam("id"), categoryController.remove);

router.get("/:id/products", validateParam("id"), categoryController.listProducts);
router.get("/:id/activity", validateParam("id"), categoryController.listActivity);
router.get("/:id/analytics", validateParam("id"), categoryController.categoryAnalytics);

router.post("/:id/archive", validateParam("id"), categoryController.archive);
router.post("/:id/activate", validateParam("id"), categoryController.activate);

// Discounts delegate to the pricing engine — this module never prices anything
// itself, it only chooses the target.
router.get("/:id/discounts", validateParam("id"), categoryController.listDiscounts);
router.post("/:id/discounts", validateParam("id"), categoryController.assignDiscount);

router.patch("/:id/image", validateParam("id"), categoryController.setImage);
router.delete("/:id/image", validateParam("id"), categoryController.removeImage);

export default router;
