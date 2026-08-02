// =============================================================================
// REPORTS ROUTES  —  /api/v1/reports
//
// OWNER-ONLY at the router level, for the same reason as the finance tree:
// margins, employee-by-employee revenue and customer lifetime value are the
// business's private view of itself. Applying the guard once to the whole tree
// makes the boundary structural rather than something to remember per route.
//
// The one deliberate exception is GLOBAL SEARCH. Looking up an invoice number
// or a customer is operational work a manager does constantly, and the search
// endpoint returns only identifying fields plus a bill total — nothing a
// manager cannot already see on the sales-history screen. It therefore sits
// above the OWNER guard with its own MANAGER-minimum one.
// =============================================================================

import { Router } from "express";

import * as reports from "../controllers/reports.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

router.use(authenticate);

// ── Global search — MANAGER + OWNER ─────────────────────────────────────────
// Declared BEFORE the OWNER guard below, which is what makes it reachable by a
// manager. Anything added after that guard is owner-only by construction.
router.get("/search", requireRole("MANAGER"), reports.search);
router.get("/filter-options", requireRole("MANAGER"), reports.getFilterOptions);

// ── Everything below is OWNER-only ──────────────────────────────────────────
router.use(requireRole("OWNER"));

router.get("/dashboard", reports.getDashboard);

router.get("/sales", reports.getSales);
router.get("/products", reports.getProducts);
router.get("/categories", reports.getCategories);
router.get("/brands", reports.getBrands);
router.get("/customers", reports.getCustomers);
router.get("/employees", reports.getEmployees);
router.get("/inventory", reports.getInventory);
router.get("/purchases", reports.getPurchases);
router.get("/payments", reports.getPayments);
router.get("/returns", reports.getReturns);
router.get("/profit", reports.getProfit);

// One endpoint, eleven reports, three formats. The remaining query string is
// the report's own filters, so an export matches the screen it came from.
router.get("/export/:report", reports.exportReport);

export default router;
