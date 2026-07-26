import { Router } from "express";
import * as financeController from "../controllers/finance.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

router.use(authenticate);

// --- EXPENSES ---
// Cashiers cannot view all expenses or create them (unless we want them to, but usually Manager/Owner)
router.post("/expenses", requireRole("OWNER"), financeController.createExpense);
router.get("/expenses", requireRole("OWNER"), financeController.getExpenses);

// --- CASH REGISTER ---
// Cashiers can interact with the drawer
router.get("/register", financeController.getActiveRegister);
router.post("/register/open", requireRole("OWNER"), financeController.openRegister);
router.post("/register/close", requireRole("OWNER"), financeController.closeRegister);
router.post("/register/transactions", financeController.addCashTransaction);

export default router;
