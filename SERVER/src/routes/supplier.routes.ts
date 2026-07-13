import { Router } from "express";

import * as supplierController from "../controllers/supplier.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

router.use(authenticate);

router.get("/", requireRole("MANAGER"), supplierController.list);
router.get(
  "/:id",
  requireRole("MANAGER"),
  validateParam("id"),
  supplierController.getById
);

router.post("/", requireRole("MANAGER"), supplierController.create);
router.patch(
  "/:id",
  requireRole("MANAGER"),
  validateParam("id"),
  supplierController.update
);

export default router;
