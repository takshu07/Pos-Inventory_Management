import { Router } from "express";

import * as supplierController from "../controllers/supplier.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

router.use(authenticate);

router.get("/", requireRole("OWNER"), supplierController.list);

// Picker projection (id + businessName only, no stats). Registered BEFORE
// "/:id" so Express does not read "options" as a supplier id. Only MANAGER is
// required: managers filter inventory by supplier, and this exposes no
// commercial data — unlike the OWNER-gated list, which carries payment rollups.
router.get("/options", requireRole("MANAGER"), supplierController.options);

router.get(
  "/:id",
  requireRole("OWNER"),
  validateParam("id"),
  supplierController.getById
);

router.post("/", requireRole("OWNER"), supplierController.create);
router.patch(
  "/:id",
  requireRole("OWNER"),
  validateParam("id"),
  supplierController.update
);
// Hard delete, permitted only for a supplier with no purchases, payments or
// supplied products. Anyone with history is deactivated via PATCH instead.
router.delete(
  "/:id",
  requireRole("OWNER"),
  validateParam("id"),
  supplierController.remove
);

export default router;
