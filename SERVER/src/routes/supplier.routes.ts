import { Router } from "express";

import * as supplierController from "../controllers/supplier.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

router.use(authenticate);

router.get("/", requireRole("OWNER"), supplierController.list);
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
