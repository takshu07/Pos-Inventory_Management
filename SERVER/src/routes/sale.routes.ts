import { Router } from "express";

import * as saleController from "../controllers/sale.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// ============================================================================
// GLOBAL MIDDLEWARE
// ============================================================================
// All sales endpoints require a valid authenticated employee
router.use(authenticate);

// ============================================================================
// ROUTES
// ============================================================================

/**
 * @route   POST /sales
 * @desc    Create a new sale (Checkout)
 * @access  CASHIER, MANAGER, OWNER
 * @note    Payload validation (saleValidation.checkout) occurs inside the controller
 *          Idempotency-Key header is strictly enforced inside the controller
 */
router.post(
  "/",
  requireRole("CASHIER"),
  saleController.checkout
);

/**
 * @route   GET /sales
 * @desc    Fetch paginated sales listing with filters and fuzzy search
 * @access  CASHIER, MANAGER, OWNER
 * @note    Query validation (saleValidation.listQuery) occurs inside the controller
 */
router.get(
  "/",
  requireRole("CASHIER"),
  saleController.listSales
);

/**
 * @route   GET /sales/:id
 * @desc    Fetch deep sale details for receipt rendering
 * @access  CASHIER, MANAGER, OWNER
 */
router.get(
  "/:id",
  requireRole("CASHIER"),
  saleController.getSaleById
);

/**
 * @route   POST /sales/:id/void
 * @desc    Void an existing sale instantly (Restores inventory)
 * @access  MANAGER, OWNER (Cashiers CANNOT void sales)
 * @note    Payload validation (saleValidation.voidSale) occurs inside the controller
 */
router.post(
  "/:id/void",
  requireRole("MANAGER"), // Strict hierarchical authorization
  saleController.voidSale
);

export default router;
