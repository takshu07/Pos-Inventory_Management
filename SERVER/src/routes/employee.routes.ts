// =============================================================================
// EMPLOYEE ROUTES
// =============================================================================

import { Router } from "express";

import * as employeeController from "../controllers/employee.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// All employee endpoints require authentication
router.use(authenticate);

// List and View: Accessible by MANAGER and OWNER
router.get("/", requireRole("MANAGER"), employeeController.list);
router.get(
  "/:id",
  requireRole("MANAGER"),
  validateParam("id"),
  employeeController.getById
);

// Create and Update: Accessible by MANAGER and OWNER
// (The service layer further restricts managers from creating/updating owners)
router.post("/", requireRole("MANAGER"), employeeController.create);
router.patch(
  "/:id",
  requireRole("MANAGER"),
  validateParam("id"),
  employeeController.update
);

export default router;
