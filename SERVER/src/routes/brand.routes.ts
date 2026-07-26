import { Router } from "express";

import * as brandController from "../controllers/brand.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

router.use(authenticate);

router.get("/", requireRole("OWNER"), brandController.list);
router.get(
  "/:id",
  requireRole("OWNER"),
  validateParam("id"),
  brandController.getById
);

router.post("/", requireRole("OWNER"), brandController.create);
router.patch(
  "/:id",
  requireRole("OWNER"),
  validateParam("id"),
  brandController.update
);

export default router;
