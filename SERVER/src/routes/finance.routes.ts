// =============================================================================
// FINANCE ROUTES  —  /api/v1/finance
//
// OWNER-ONLY at the router level. Revenue, margins, payroll and supplier
// balances are the business's private financials; a manager runs the floor, an
// owner runs the business. Applying the guard once to the whole tree makes that
// boundary structural — a guard you have to remember to repeat is a guard that
// will eventually be forgotten.
//
// Two consequences worth stating explicitly:
//   • A MANAGER hitting any path here gets a 403, not a narrowed result set.
//     Partial visibility into payroll is worse than none: it invites inferring
//     colleagues' salaries from a total.
//   • There is NO delete route for any financial record, for any role. The
//     absence is the control.
//
// The drawer-level surface a cashier needs (open, drop, payout, close) is a
// different module entirely — see register.routes.ts.
// =============================================================================

import { Router } from "express";

import * as finance from "../controllers/finance.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// Every endpoint below this line is OWNER-only. No exceptions.
router.use(authenticate, requireRole("OWNER"));

// ── Dashboard & analytics ───────────────────────────────────────────────────
router.get("/dashboard", finance.getDashboard);
router.get("/revenue", finance.getRevenue);
router.get("/profit-loss", finance.getProfitLoss);
router.get("/cash-flow", finance.getCashFlow);
router.get("/payment-analytics", finance.getPaymentAnalytics);

// ── Expenses ────────────────────────────────────────────────────────────────
// Literal paths first so "expense-categories" is never captured as an :id.
router.get("/expense-categories", finance.listExpenseCategories);
router.post("/expense-categories", finance.createExpenseCategory);

router.get("/expenses", finance.listExpenses);
router.post("/expenses", finance.createExpense);
router.get("/expenses/:id", validateParam("id"), finance.getExpense);
router.patch("/expenses/:id", validateParam("id"), finance.updateExpense);
router.post("/expenses/:id/review", validateParam("id"), finance.reviewExpense);

// ── Supplier payables ───────────────────────────────────────────────────────
router.get("/payables", finance.listPayables);
router.patch("/payables/:id/due-date", validateParam("id"), finance.setBillDueDate);

router.get("/supplier-payments", finance.listSupplierPayments);
router.post("/supplier-payments", finance.recordSupplierPayment);

router.get("/suppliers", finance.listSuppliers);
router.get("/suppliers/:id/open-bills", validateParam("id"), finance.listOpenBills);

// ── Payroll ─────────────────────────────────────────────────────────────────
router.post("/payroll/generate", finance.generatePayroll);
router.get("/salaries", finance.listSalaries);
router.get("/salaries/:id", validateParam("id"), finance.getSalary);
router.post("/salaries/:id/adjustments", validateParam("id"), finance.addSalaryAdjustment);
router.post("/salaries/:id/pay", validateParam("id"), finance.paySalary);

// ── Exports ─────────────────────────────────────────────────────────────────
// One endpoint, seven reports, three formats. The remaining query string is the
// report's own filters, so an export matches the screen it was launched from.
router.get("/export/:report", finance.exportReport);

export default router;
