import { Router } from "express";
import * as analyticsController from "../controllers/analytics.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

// Only Managers and Owners can access analytics
router.use(authenticate);

// GET /api/v1/analytics/reports -> List available reports
router.get("/reports", requireRole("CASHIER"), analyticsController.getAvailableReports);

// GET /api/v1/analytics/generate -> Generate a specific report
router.get("/generate", requireRole("CASHIER"), analyticsController.generateReport);

export default router;
