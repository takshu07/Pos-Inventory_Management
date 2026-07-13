import { Router } from "express";

import * as purchaseController from "../controllers/purchase.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// Purchases can only be accessed by MANAGER and OWNER
router.use(authenticate);
router.use(requireRole("MANAGER"));

router.get("/", purchaseController.list);
router.get("/:id", validateParam("id"), purchaseController.getById);

router.post("/", purchaseController.create);
router.patch("/:id", validateParam("id"), purchaseController.update);
router.post("/:id/receive", validateParam("id"), purchaseController.receive);

export default router;
