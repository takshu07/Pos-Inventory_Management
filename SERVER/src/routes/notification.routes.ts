import { Router } from "express";
import * as notificationController from "../controllers/notification.controller";
import { authenticate } from "../middleware/auth.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

// Notifications are available to all authenticated employees.
//
// ⚠ There is deliberately NO `requireRole` here. Every employee has
// notifications, so the access boundary is the AUDIENCE, not the role: the
// repository AND-s an audience predicate (addressed to me / my role / everyone)
// into every query and mutation. A cashier hitting these endpoints sees their
// own rows and nobody else's. Adding a role guard would hide notifications from
// the people they were written for.
router.use(authenticate);

// ── Existing endpoints (unchanged) ──────────────────────────────────────────
// `GET /` returns UNREAD ONLY and is unpaginated — it backs the Navbar bell and
// the dashboard. The screen uses `/feed` instead. Left exactly as it was so
// those callers cannot regress.
router.get("/", notificationController.getMyNotifications);
router.post("/read-all", notificationController.markAllAsRead);

// ── Additive (2026-08-03) — the Notifications screen ────────────────────────
// Declared BEFORE `/:id/read` so "feed" and "summary" are never captured as an
// id by the param route below.
router.get("/feed", notificationController.listFeed);
router.get("/summary", notificationController.summary);
router.post("/read", notificationController.markManyAsRead);

router.patch("/:id/read", validateParam("id"), notificationController.markAsRead);

export default router;
