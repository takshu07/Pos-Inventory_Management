import { Router } from "express";
import * as configurationController from "../controllers/configuration.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

// Configuration is extremely sensitive. Only Owner can mutate. Manager can read.
router.use(authenticate);

router.get("/", requireRole("MANAGER"), configurationController.getSettings);
router.patch("/", requireRole("OWNER"), configurationController.updateSettings);

export default router;
