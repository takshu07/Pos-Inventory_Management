/**
 * @file features/auth/index.ts
 *
 * Purpose: The public API contract for the auth feature.
 *
 * STRICT RULE: Other features and shell components may ONLY import
 * from this file. Never from internal feature paths like:
 *   ❌ import { useLogin } from "@/features/auth/hooks/useLogin"
 *   ✅ import { useLogin } from "@/features/auth"
 *
 * This file defines what the auth feature EXPOSES vs. what it ENCAPSULATES.
 * If something is not listed here, it is a private internal implementation detail.
 *
 * What is exported and why:
 *   - Views: consumed by the router (only the router imports views)
 *   - Hooks: consumed by shell components (Navbar logout, profile refresh)
 *   - Components: consumed by shell and other features (PermissionGuard, RoleBadge)
 *   - Utils: consumed by navigation config and admin screens (permission checks)
 *   - Types: consumed by global types file and other features needing AuthUser
 *
 * What is NOT exported (intentionally private):
 *   - authApi.ts: Internal transport layer. Only hooks call it.
 *   - constants/: Internal configuration. Only auth-internal files use it.
 *   - validation/: Form schemas are consumed only by form components.
 *   - AuthBootstrapper: Mounted once by AppProvider — not reused elsewhere.
 */

// ── Views (consumed by router only) ──────────────────────────────────────────
// Views are intentionally NOT exported from this barrel file to ensure
// they can be correctly lazy-loaded via dynamic imports without being
// pulled into the main chunk by static imports elsewhere.

// ── Hooks (consumed by shell components and other features) ───────────────────
export { useLogin } from "./hooks/useLogin";
export { useLogout } from "./hooks/useLogout";
export { useCurrentUser } from "./hooks/useCurrentUser";
export { useChangePassword } from "./hooks/useChangePassword";

// ── Route Guards (consumed by router) ────────────────────────────────────────
export { GuestRoute, ProtectedRoute, AdminRoute } from "./components/RouteGuards";

// ── Reusable Components (consumed by shell and other features) ────────────────
export { PermissionGuard } from "./components/PermissionGuard";
export { RoleBadge } from "./components/RoleBadge";
export { PasswordField } from "./components/PasswordField";
export { SessionExpiredModal } from "./components/SessionExpiredModal";
export { AuthBootstrapper } from "./components/AuthBootstrapper";

// ── Permission Utilities (consumed by navigation config, admin screens) ───────
export {
  hasAtLeastRole,
  canAccessAdmin,
  canAccessOwnerOnly,
  canVoidSale,
  canAdjustInventory,
  canApplyDiscount,
  canViewReports,
  canManageEmployees,
  canAssignRole,
  ROLE_LABELS,
  ROLE_BADGE_VARIANTS,
} from "./utils/permissions";

// ── Types (consumed by other features needing AuthUser) ───────────────────────
export type {
  AuthUser,
  AuthTokenResponse,
  LoginRequest,
  SessionStatus,
  PermissionCheck,
} from "./types";
