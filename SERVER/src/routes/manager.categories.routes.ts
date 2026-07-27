// =============================================================================
// MANAGER CATEGORY ROUTES  —  /api/v1/manager/categories
//
// READ-ONLY by construction. Only GET verbs are declared, so there is no write
// path to authorize in the first place — a manager POSTing here gets 404 from
// the router (no such route), and a manager calling the owner router gets 403.
// Two independent reasons a manager cannot mutate a category.
//
// requireRole("MANAGER") enforces the MINIMUM role, so an OWNER also passes —
// consistent with every other manager router in the codebase.
//
// CASHIER has no category access at all: the role check rejects them here, and
// the frontend never routes them to this module.
//
// Handlers are shared with the owner router rather than duplicated. Unlike
// products — where managerProduct.service strips cost/margin — a category
// carries no financial fields, so the read payload is identical for both roles
// and there is nothing to redact. The analytics endpoints, which DO expose
// revenue and profit, are deliberately absent from this router.
// =============================================================================

import { Router } from "express";

import * as categoryController from "../controllers/category.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

router.use(authenticate);
router.use(requireRole("MANAGER"));

// View, search and filter the catalog's categories.
router.get("/", categoryController.list);
router.get("/summary", categoryController.summary);
router.get("/options", categoryController.options);

router.get("/:id", validateParam("id"), categoryController.getById);
router.get("/:id/products", validateParam("id"), categoryController.listProducts);

export default router;
