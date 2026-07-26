import { Router } from "express";
import * as configurationController from "../controllers/configuration.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

// Settings are business administration — OWNER only for both read and write.
// (Operational server logic reads settings directly via ConfigurationEngine,
// not through this HTTP endpoint, so locking it does not affect POS/receipts.)
router.use(authenticate);

router.get("/", requireRole("OWNER"), configurationController.getSettings);
router.patch("/", requireRole("OWNER"), configurationController.updateSettings);

export default router;
