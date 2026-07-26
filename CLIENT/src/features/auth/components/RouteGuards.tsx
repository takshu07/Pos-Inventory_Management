/**
 * @file features/auth/components/RouteGuards.tsx
 *
 * Purpose: Reusable React Router route guard components.
 *
 * Why separate guard components (not inline logic in MainLayout):
 *   MainLayout already does a basic isAuthenticated check. But we need
 *   composable, explicit guards for:
 *   1. GuestRoute — redirect logged-in users AWAY from /login.
 *   2. AdminRoute — block non-managers from admin-only routes.
 *   
 *   Extracting these as named components makes the router config
 *   self-documenting: reading the route tree tells you exactly what
 *   permission level each route requires.
 *
 * Why NOT using React Router's loader functions:
 *   Loaders run before rendering, which is ideal for data fetching.
 *   But auth guards need Zustand state (synchronous, from localStorage).
 *   Loaders can't access Zustand outside React — they'd need a different
 *   pattern. Component guards are simpler and consistent with how
 *   MainLayout already works in this project.
 *
 * Route flicker prevention:
 *   All guards check sessionStatus !== 'idle' before rendering.
 *   During 'idle' (pre-hydration), they show the FullScreenLoader.
 *   This prevents the login page flashing before the guard realizes
 *   the user is actually authenticated.
 */

import { Navigate, Outlet } from "react-router";
import { useAuthStore, selectIsAuthenticated, selectSessionStatus, selectRole } from "@/store/auth.store";
import { FullScreenLoader } from "@/components/ui";
import {
  canAccessAdmin,
  canAccessManagerPortal,
  canAccessCashierPortal,
  portalHomeForRole,
} from "../utils/permissions";
import { AUTH_ROUTES } from "../constants";

// ─── Protected Route ──────────────────────────────────────────────────────────
// Blocks unauthenticated users. Used as wrapper for ALL authenticated routes.
// MainLayout already has this logic — this export is for composable use elsewhere.

export function ProtectedRoute() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const sessionStatus = useAuthStore(selectSessionStatus);

  // Pre-hydration: show loader to prevent flash
  if (sessionStatus === "idle" || sessionStatus === "loading") {
    return <FullScreenLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to={AUTH_ROUTES.login} replace />;
  }

  return <Outlet />;
}

// ─── Guest Route ──────────────────────────────────────────────────────────────
// Redirects authenticated users AWAY from public routes (e.g., /login).
// Prevents the back-button returning to the login page after a successful login.

export function GuestRoute() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const sessionStatus = useAuthStore(selectSessionStatus);
  const role = useAuthStore(selectRole);

  if (sessionStatus === "idle" || sessionStatus === "loading") {
    return <FullScreenLoader />;
  }

  if (isAuthenticated) {
    // Send each role to the portal it owns, never a fixed route — a CASHIER
    // landing on "/" would otherwise bounce through ManagerRoute.
    return <Navigate to={portalHomeForRole(role)} replace />;
  }

  return <Outlet />;
}

// ─── Owner Route ──────────────────────────────────────────────────────────────
// Gates business ADMINISTRATION routes (catalog CRUD, procurement, inventory,
// finance, reports, discounts, cash register, settings, audit logs) to OWNER.
// A MANAGER who manually types one of these URLs is sent to /unauthorized — nav
// hiding is not the boundary; this guard is. (`canAccessAdmin` resolves to
// OWNER-only under the operational-manager model.)

export function OwnerRoute() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const sessionStatus = useAuthStore(selectSessionStatus);
  const role = useAuthStore(selectRole);

  if (sessionStatus === "idle" || sessionStatus === "loading") {
    return <FullScreenLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to={AUTH_ROUTES.login} replace />;
  }

  if (!canAccessAdmin(role)) {
    return <Navigate to={AUTH_ROUTES.unauthorized} replace />;
  }

  return <Outlet />;
}

/**
 * @deprecated Use OwnerRoute. Kept as an alias so existing imports keep working;
 * semantics are now OWNER-only (the "admin" surface belongs to the owner).
 */
export const AdminRoute = OwnerRoute;

// ─── Manager Route ────────────────────────────────────────────────────────────
// Gate for the entire Manager/Owner portal shell (everything under "/").
// A CASHIER who manually types a management URL (/, /sales, /customers) is not
// merely nav-hidden — they are redirected into their own portal. This is the
// frontend half of RBAC; the backend independently rejects privileged calls.

export function ManagerRoute() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const sessionStatus = useAuthStore(selectSessionStatus);
  const role = useAuthStore(selectRole);

  if (sessionStatus === "idle" || sessionStatus === "loading") {
    return <FullScreenLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to={AUTH_ROUTES.login} replace />;
  }

  if (!canAccessManagerPortal(role)) {
    // Cashier trying to reach the management shell → back to their portal.
    return <Navigate to={AUTH_ROUTES.cashierHome} replace />;
  }

  return <Outlet />;
}

// ─── Cashier Route ────────────────────────────────────────────────────────────
// Gate for the Cashier portal shell (everything under "/cashier"). Only a
// CASHIER may enter. A MANAGER/OWNER who navigates here is sent to their own
// management shell — a manager should never see the cashier portal.

export function CashierRoute() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const sessionStatus = useAuthStore(selectSessionStatus);
  const role = useAuthStore(selectRole);

  if (sessionStatus === "idle" || sessionStatus === "loading") {
    return <FullScreenLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to={AUTH_ROUTES.login} replace />;
  }

  if (!canAccessCashierPortal(role)) {
    return <Navigate to={AUTH_ROUTES.dashboard} replace />;
  }

  return <Outlet />;
}
