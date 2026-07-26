import { Router } from "express";
import * as analyticsController from "../controllers/analytics.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

// Reports/analytics are business administration — OWNER only. (Previously this
// was mistakenly open to CASHIER; managers are operational and no longer see
// reports either.)
router.use(authenticate);

// GET /api/v1/analytics/reports -> List available reports
router.get("/reports", requireRole("OWNER"), analyticsController.getAvailableReports);

// GET /api/v1/analytics/generate -> Generate a specific report
router.get("/generate", requireRole("OWNER"), analyticsController.generateReport);

export default router;
