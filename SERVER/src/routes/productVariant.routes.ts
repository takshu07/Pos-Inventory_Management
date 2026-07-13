import { Router } from "express";

import * as productVariantController from "../controllers/productVariant.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// All variant endpoints require authentication
router.use(authenticate);

// List and View: Accessible by ALL staff (CASHIER, MANAGER, OWNER)
// Cashiers MUST access these to scan barcodes and view inventory
router.get("/", productVariantController.list);
router.get(
  "/barcode/:barcode",
  productVariantController.getByBarcode
);
router.get(
  "/:id",
  validateParam("id"),
  productVariantController.getById
);

// Create and Update: Restricted to MANAGER and OWNER
// Changing pricing or SKUs is a management function
router.post("/", requireRole("MANAGER"), productVariantController.create);
router.patch(
  "/:id",
  requireRole("MANAGER"),
  validateParam("id"),
  productVariantController.update
);

export default router;
