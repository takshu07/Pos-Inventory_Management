// =============================================================================
// SYNC ROUTES  —  /api/v1/sync
//
// Two authentication regimes on one tree, because the two halves of the
// protocol have genuinely different callers:
//
//   /download, /upload    A MACHINE. Authenticated by HMAC device signature,
//                         because an edge node drains its queue at 2am with
//                         nobody logged in. No JWT is involved and none should
//                         be — a staff token living on a shop-floor PC to make
//                         unattended sync work would be a worse credential than
//                         the device secret it replaced.
//
//   everything else       A PERSON, through the app. Normal JWT + RBAC.
//
// ── Who may do what, and why ─────────────────────────────────────────────────
//
//   status, history, health   ANY authenticated staff member, cashiers
//                             included. Requirement: "the cashier should always
//                             know the synchronization state". A guard that
//                             hid it from the person actually operating the
//                             till would defeat the feature.
//
//   run ("Sync Now")          ANY authenticated staff member. A cashier who can
//                             see the store is offline must be able to act on
//                             it. The action is safe by construction —
//                             idempotent, and it cannot destroy data.
//
//   retry, queue, conflicts   MANAGER and above. These expose per-record
//                             failure detail and the shape of the business
//                             data behind it; they are a diagnostic surface,
//                             not an operational one.
//
//   devices, cloud-conflicts  OWNER only, matching how the rest of this system
//                             treats cross-store business administration.
// =============================================================================

import express, { Router } from "express";

import { authenticate } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";
import { authenticateDevice, captureRawSyncBody } from "./deviceAuth.middleware";
import * as sync from "./sync.controller";

const router = Router();

// =============================================================================
// MACHINE-TO-MACHINE  (cloud node serves these)
// =============================================================================

/**
 * A body parser scoped to the device endpoints.
 *
 * Two things it does that the global parser does not:
 *
 *  1. `verify` keeps the RAW bytes. The signature covers exactly what the
 *     device serialized; re-serializing `req.body` would not reproduce it, and
 *     one reordered key breaks every signature.
 *  2. A larger limit. An upload batch of a thousand rows is legitimately a few
 *     megabytes — the global limit is tuned for interactive requests.
 *
 * Gzip is inflated by body-parser before `verify` runs, so a compressed upload
 * and an uncompressed one produce the same bytes to sign.
 */
const syncBodyParser = express.json({
  limit: "12mb",
  verify: captureRawSyncBody,
});

router.get("/download", syncBodyParser, authenticateDevice, sync.download);
router.post("/upload", syncBodyParser, authenticateDevice, sync.upload);

// =============================================================================
// OPERATOR SURFACE  (edge node serves these; cloud answers a degenerate status)
// =============================================================================

router.use(authenticate);

// ── Visible to everyone who works the till ──────────────────────────────────
router.get("/status", sync.status);
router.get("/history", sync.history);
router.get("/health", sync.health);
router.post("/run", sync.run);
router.post("/probe", sync.probe);

// ── Diagnostic surface ──────────────────────────────────────────────────────
router.get("/queue", requireRole("MANAGER"), sync.queue);
router.get("/conflicts", requireRole("MANAGER"), sync.conflicts);
router.get("/events", requireRole("MANAGER"), sync.events);
router.post("/retry", requireRole("MANAGER"), sync.retry);

// ── Business administration ─────────────────────────────────────────────────
router.get("/devices", requireRole("OWNER"), sync.listDevices);
router.get("/cloud-conflicts", requireRole("OWNER"), sync.listCloudConflicts);

export default router;
