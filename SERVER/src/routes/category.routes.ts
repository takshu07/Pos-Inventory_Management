import { Router } from "express";

import * as categoryController from "../controllers/category.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// All catalog endpoints require authentication
router.use(authenticate);

// List and View: Accessible by MANAGER and OWNER
router.get("/", requireRole("MANAGER"), categoryController.list);
router.get(
  "/:id",
  requireRole("MANAGER"),
  validateParam("id"),
  categoryController.getById
);

// Create and Update: Accessible by MANAGER and OWNER
router.post("/", requireRole("MANAGER"), categoryController.create);
router.patch(
  "/:id",
  requireRole("MANAGER"),
  validateParam("id"),
  categoryController.update
);

export default router;
