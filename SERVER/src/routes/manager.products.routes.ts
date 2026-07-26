// =============================================================================
// MANAGER PRODUCT ROUTES  —  /api/v1/manager/products
//
// Operational, READ-ONLY catalog for managers. There are ONLY GET endpoints.
// The router is gated at requireRole("MANAGER") (OWNER inherits, MANAGER passes,
// CASHIER is rejected with 403). There is deliberately no POST/PATCH/DELETE:
// managers cannot mutate the catalog by construction — the write surface simply
// does not exist on this router, and the financial fields are stripped in the
// service before any row leaves the server.
// =============================================================================

import { Router } from "express";

import * as managerProductController from "../controllers/managerProduct.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

router.use(authenticate);
router.use(requireRole("MANAGER"));

// Static paths first, then the id param.
router.get("/", managerProductController.list);
router.get("/search", managerProductController.search);
router.get("/categories", managerProductController.listCategories);
router.get("/brands", managerProductController.listBrands);
router.get("/:id", validateParam("id"), managerProductController.getById);

export default router;
