import { Router } from "express";

import * as brandController from "../controllers/brand.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

router.use(authenticate);

router.get("/", requireRole("MANAGER"), brandController.list);
router.get(
  "/:id",
  requireRole("MANAGER"),
  validateParam("id"),
  brandController.getById
);

router.post("/", requireRole("MANAGER"), brandController.create);
router.patch(
  "/:id",
  requireRole("MANAGER"),
  validateParam("id"),
  brandController.update
);

export default router;
