import { Router } from "express";
import * as configurationController from "../controllers/configuration.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

// Settings are business administration — OWNER only for both read and write.
// (Operational server logic reads settings directly via ConfigurationEngine,
// not through this HTTP endpoint, so locking it does not affect POS/receipts.)
router.use(authenticate);

// TODO(settings): additive `GET /public` — non-sensitive display configuration
// for every authenticated role.
//
// The routes below are OWNER-only and must stay that way: this document carries
// security policy, discount ceilings, audit retention and integration wiring.
// But currency, timeZone, storeName and the systemConfig display formats are
// pure presentation, and because a CASHIER cannot read them the client falls
// back to defaults — a store configured to AED shows ₹ on every cashier screen.
// (Display only; all amounts are computed server-side and arrive correct.)
//
// ⚠ Build it as a POSITIVE ALLOWLIST — name the fields to include. Do NOT take
// the full configuration and delete keys, or the next field added to
// securityConfig silently joins the public payload. `authenticate` yes,
// `requireRole` no. Read-only; no PATCH counterpart.
//
// Full spec: docs/STORE_SETTINGS.md §8.

router.get("/", requireRole("OWNER"), configurationController.getSettings);
router.patch("/", requireRole("OWNER"), configurationController.updateSettings);

export default router;
