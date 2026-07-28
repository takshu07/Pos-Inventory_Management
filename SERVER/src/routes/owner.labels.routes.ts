// =============================================================================
// OWNER LABEL ADMINISTRATION ROUTES  —  /api/v1/owner/labels
//
// Template management, printer management, label settings and full print
// history. EVERY endpoint here is OWNER-only.
//
// A MANAGER or CASHIER who manually calls any of these receives 403 from
// requireRole("OWNER") before the controller runs. Hiding the nav item on the
// frontend is a convenience; this is the security boundary — which is exactly
// what "never expose printer management to Managers or Cashiers" requires.
// =============================================================================

import { Router } from "express";

import * as labelController from "../controllers/label.controller";
import * as labelAdminController from "../controllers/labelAdmin.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// Layer 1: authenticated. Layer 2: OWNER. Applied to the whole router so no
// endpoint can ever be added here without both guards.
router.use(authenticate);
router.use(requireRole("OWNER"));

// ─── Templates ────────────────────────────────────────────────────────────────
// Static paths are declared before "/:id" so "builtins" is never captured as an id.

router.get("/templates", labelAdminController.listTemplates);
router.get("/templates/builtins", labelAdminController.listBuiltinTemplates);
router.post("/templates/validate", labelAdminController.validateTemplate);
router.post("/templates", labelAdminController.createTemplate);

router.get("/templates/:id", validateParam("id"), labelAdminController.getTemplate);
router.patch("/templates/:id", validateParam("id"), labelAdminController.updateTemplate);
router.delete("/templates/:id", validateParam("id"), labelAdminController.deleteTemplate);
router.post(
  "/templates/:id/duplicate",
  validateParam("id"),
  labelAdminController.duplicateTemplate
);

// ─── Printers ─────────────────────────────────────────────────────────────────

router.get("/printers", labelAdminController.listPrinters);
router.get("/printers/capabilities", labelAdminController.getCapabilities);
router.post("/printers/probe", labelAdminController.probeAllPrinters);
router.post("/printers", labelAdminController.createPrinter);

router.get("/printers/:id", validateParam("id"), labelAdminController.getPrinter);
router.patch("/printers/:id", validateParam("id"), labelAdminController.updatePrinter);
router.delete("/printers/:id", validateParam("id"), labelAdminController.deletePrinter);
router.post(
  "/printers/:id/default",
  validateParam("id"),
  labelAdminController.setDefaultPrinter
);
router.post("/printers/:id/test", validateParam("id"), labelAdminController.testPrinter);

// ─── Settings ─────────────────────────────────────────────────────────────────

router.get("/settings", labelAdminController.getSettings);
router.patch("/settings", labelAdminController.updateSettings);

// ─── History ──────────────────────────────────────────────────────────────────
// The unrestricted, cross-user print history. The operational /labels/jobs
// endpoint scopes cashiers to their own jobs; this one never filters by actor.

router.get("/history", labelController.getHistory);

export default router;
