import { Router } from "express";
import { customerController } from "../controllers/customer.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// All customer routes require authentication
router.use(authenticate);

// =============================================================================
// READ OPERATIONS (CASHIER AND ABOVE)
// Cashiers need to read customers to attach them to sales.
// =============================================================================
router.get("/", requireRole("CASHIER"), customerController.getCustomers);
router.get("/walk-in", requireRole("CASHIER"), customerController.getWalkInCustomer);
router.get("/:id", validateParam("id"), requireRole("CASHIER"), customerController.getCustomerById);
router.get("/:id/purchases", validateParam("id"), requireRole("CASHIER"), customerController.getCustomerPurchases);

// =============================================================================
// WRITE OPERATIONS (MANAGER AND ABOVE)
// Only Managers and Owners can create or modify customer records.
// =============================================================================
router.post("/", requireRole("MANAGER"), customerController.createCustomer);
router.patch("/:id", validateParam("id"), requireRole("MANAGER"), customerController.updateCustomer);

export default router;
