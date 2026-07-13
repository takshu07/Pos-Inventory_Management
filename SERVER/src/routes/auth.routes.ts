// =============================================================================
// AUTH ROUTES
// Only routing. No business logic. No middleware logic.
//
// Route design:
//   POST   /auth/setup           → One-time owner setup (public, no rate limit)
//   POST   /auth/login           → Login (public, strict rate limit: 10/15min)
//   GET    /auth/me              → Current user profile (protected)
//   PATCH  /auth/change-password → Change own password (protected)
//
// Route prefix (/auth) is applied in app.ts, not here.
// This file only handles sub-paths.
// =============================================================================

import { Router } from "express";

import * as authController from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth.middleware";
import { authLimiter } from "../middleware/rateLimit.middleware";

const router = Router();

// Public routes — no authentication required
// /setup has no rate limiter; it only works once (guarded in service)
router.post("/setup", authController.setup);
router.post("/login", authLimiter, authController.login);

// Protected routes — JWT required
router.get("/me", authenticate, authController.me);
router.patch("/change-password", authenticate, authController.changePassword);

export default router;