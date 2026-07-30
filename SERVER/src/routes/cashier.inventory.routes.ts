// =============================================================================
// CASHIER INVENTORY ROUTES  —  /api/v1/inventory
//
// The minimum a cashier needs at the till: "is this in stock?" and "what is
// this barcode?". Nothing else.
//
// Mounted at the unprefixed path because it is the BASELINE surface — every
// authenticated role can reach it, and the service narrows what each one sees.
// A cashier calling these gets stock levels with no cost, no margin and no
// valuation, because `scopeFor()` omits those keys entirely rather than
// nulling them: there is no field for a client bug to reveal.
//
// Deliberately absent: adjustments, counts, reservations, valuation, reorder,
// the movement ledger. Per the spec a cashier performs no stock operations,
// and the strongest way to guarantee that is to register no route for them.
// =============================================================================

import { Router } from "express";

import * as inventory from "../controllers/inventory.controller";
import { authenticate } from "../middleware/auth.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// Authenticated, but no minimum role — this is the shared read surface.
router.use(authenticate);

// ── Barcode scan ────────────────────────────────────────────────────────────
// Declared before "/stock/:id" so "scan" is never parsed as an id.
router.get("/scan", inventory.scan);

// ── Stock lookup ────────────────────────────────────────────────────────────
router.get("/stock", inventory.listStock);
router.get("/stock/:id", validateParam("id"), inventory.getDetail);

export default router;
