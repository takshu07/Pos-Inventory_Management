import { Router } from "express";

import * as productController from "../controllers/product.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// All product endpoints require authentication
router.use(authenticate);

// List and View: Accessible by ALL staff (CASHIER, MANAGER, OWNER)
// Cashiers need to fetch products for the POS screen.
router.get("/", productController.list);
router.get(
  "/:id",
  validateParam("id"),
  productController.getById
);
router.get(
  "/:id/variants",
  validateParam("id"),
  productController.getVariantsByProductId
);

// Create and Update: OWNER only. Managers have read-only catalog visibility;
// only the owner may mutate the catalog.
router.post("/", requireRole("OWNER"), productController.create);
router.patch(
  "/:id",
  requireRole("OWNER"),
  validateParam("id"),
  productController.update
);

export default router;
