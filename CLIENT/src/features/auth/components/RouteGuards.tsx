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
import { canAccessAdmin } from "../utils/permissions";
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

  if (sessionStatus === "idle" || sessionStatus === "loading") {
    return <FullScreenLoader />;
  }

  if (isAuthenticated) {
    return <Navigate to={AUTH_ROUTES.dashboard} replace />;
  }

  return <Outlet />;
}

// ─── Admin Route ──────────────────────────────────────────────────────────────
// Only permits MANAGER and OWNER roles. Cashiers get sent to /unauthorized.

export function AdminRoute() {
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
