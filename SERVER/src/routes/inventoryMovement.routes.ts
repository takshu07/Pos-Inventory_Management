import { Router } from "express";

import * as inventoryMovementController from "../controllers/inventoryMovement.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// All inventory movement endpoints require authentication
router.use(authenticate);

// List and View: Accessible by MANAGER and OWNER
// Cashiers do not need to view raw movement ledgers
router.get("/", requireRole("MANAGER"), inventoryMovementController.list);
router.get(
  "/:id",
  requireRole("MANAGER"),
  validateParam("id"),
  inventoryMovementController.getById
);

// Create Manual Adjustment: Restricted to MANAGER and OWNER
// Cashiers cannot manually alter stock, they can only do it via Sales.
router.post(
  "/",
  requireRole("MANAGER"),
  inventoryMovementController.createManualAdjustment
);

export default router;
