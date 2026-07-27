// =============================================================================
// LEGACY CATEGORY ROUTES  —  /api/v1/categories
//
// SUPERSEDED by the role-scoped routers:
//   • /api/v1/owner/categories    full administration (OWNER)
//   • /api/v1/manager/categories  read-only catalog   (MANAGER + OWNER)
//
// Kept alive because existing screens still call it as a lookup source — the
// discount rule editor's category picker and the product wizard's category
// dropdown both GET /categories. Those callers need a plain list, not the
// enterprise module, so this router is now READ-ONLY and delegates to the same
// service as the new routers.
//
// The old write endpoints (POST /, PATCH /:id) have been REMOVED rather than
// left in place: two independent write paths to the same table would mean
// audit, status/isActive lockstep and safe-delete rules could be bypassed by
// calling the older URL. All writes now go through /owner/categories.
//
// requireRole("MANAGER") enforces a minimum, so OWNER passes too.
// =============================================================================

import { Router } from "express";

import * as categoryController from "../controllers/category.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

router.use(authenticate);
router.use(requireRole("MANAGER"));

router.get("/", categoryController.list);
router.get("/options", categoryController.options);
router.get("/:id", validateParam("id"), categoryController.getById);

export default router;
