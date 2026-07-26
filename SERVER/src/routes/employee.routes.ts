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

// List and View: MANAGER + OWNER. This is the read-only "Employee Activity"
// monitor managers use to oversee staff — no mutation implied.
router.get("/", requireRole("MANAGER"), employeeController.list);
router.get(
  "/:id",
  requireRole("MANAGER"),
  validateParam("id"),
  employeeController.getById
);

// Create and Update: OWNER only. Hiring, editing, deactivating, and role
// changes are business administration reserved for the owner.
router.post("/", requireRole("OWNER"), employeeController.create);
router.patch(
  "/:id",
  requireRole("OWNER"),
  validateParam("id"),
  employeeController.update
);

export default router;
