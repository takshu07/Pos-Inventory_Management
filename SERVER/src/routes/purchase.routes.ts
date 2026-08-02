import { Router } from "express";

import * as purchaseController from "../controllers/purchase.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// Procurement is business administration — OWNER only. Managers are operational
// and have no access to purchases.
router.use(authenticate);
router.use(requireRole("OWNER"));

router.get("/", purchaseController.list);
router.get("/:id", validateParam("id"), purchaseController.getById);

router.post("/", purchaseController.create);
router.patch("/:id", validateParam("id"), purchaseController.update);
// Goods receipt — full when the body omits `items`, partial when it names
// lines and quantities.
router.post("/:id/receive", validateParam("id"), purchaseController.receive);
router.post("/:id/cancel", validateParam("id"), purchaseController.cancel);

export default router;
