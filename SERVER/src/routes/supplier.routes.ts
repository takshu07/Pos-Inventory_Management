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

export default router;
