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

import { useRef } from "react";
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

// ─── Session resolution ───────────────────────────────────────────────────────
//
// A guard may only make an authorization decision when the session is SETTLED.
// 'idle' and 'loading' are not "denied" — they are "not known yet", and the two
// were previously conflated, which is what made navigation flicker and bounce.
//
// Two separate failures came out of that:
//
//   1. WHITE FLASH. These guards sit ABOVE MainLayout in the route tree, so
//      returning <FullScreenLoader /> unmounts the whole shell — sidebar, navbar
//      and page — and remounts it a tick later. That reads as a page reload, not
//      a navigation. Once the shell is up, a transient status change must never
//      tear it back down.
//
//   2. BOUNCE TO THE PREVIOUS SECTION. AuthBootstrapper calls /auth/me and
//      flips status to 'loading', then 'authenticated'. If a navigation to an
//      owner-only route resolved its lazy chunk inside that window, `role` read
//      null, canAccessAdmin(null) returned false, and the guard fired
//      <Navigate replace> — rewriting history and dropping the user back where
//      they came from. Intermittent, because it depended on request timing.
//
// `useSettledAccess` closes both: it never revokes access it has already
// granted for the lifetime of the mounted guard. A REAL logout or role change
// unmounts these guards via the top-level status flip to 'unauthenticated' /
// 'expired', so this cannot pin a stale grant open — see the explicit check.

export type Access = "pending" | "granted" | "denied";

/**
 * Resolves a guard's decision, latching 'granted' so an in-flight session
 * refresh cannot momentarily revoke it mid-navigation.
 *
 * Exported because MainLayout must reach the SAME decision as the guard above
 * it. When it read `sessionStatus` directly it could return null for a blink
 * that the latched ManagerRoute above had already decided to ignore — and since
 * the guard never re-rendered, nothing brought the shell back. That left a
 * permanently blank page on any navigation that overlapped a session refresh.
 *
 * @param settled  false while sessionStatus is 'idle' | 'loading'
 * @param allowed  the guard's own predicate, only meaningful once settled
 */
export function useSettledAccess(settled: boolean, allowed: boolean): Access {
  const grantedOnce = useRef(false);

  // A settled + allowed session is the only thing that opens the latch.
  if (settled && allowed) grantedOnce.current = true;

  // An explicit denial on a SETTLED session always wins over the latch: this is
  // a real logout, a real expiry, or a real role change, not a refresh blip.
  if (settled && !allowed) {
    grantedOnce.current = false;
    return "denied";
  }

  if (grantedOnce.current) return "granted";
  return settled ? "granted" : "pending";
}

// ─── Protected Route ──────────────────────────────────────────────────────────
// Blocks unauthenticated users. Used as wrapper for ALL authenticated routes.
// MainLayout already has this logic — this export is for composable use elsewhere.

export function ProtectedRoute() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const sessionStatus = useAuthStore(selectSessionStatus);

  const settled = sessionStatus !== "idle" && sessionStatus !== "loading";
  const access = useSettledAccess(settled, isAuthenticated);

  // Pre-hydration only: show loader to prevent the login page flashing.
  if (access === "pending") return <FullScreenLoader />;

  if (access === "denied") {
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

  const settled = sessionStatus !== "idle" && sessionStatus !== "loading";
  const access = useSettledAccess(settled, isAuthenticated && canAccessAdmin(role));

  // Nested INSIDE MainLayout, so the shell is already on screen. Rendering
  // nothing (rather than a FullScreenLoader) keeps the sidebar and navbar in
  // place during the blink; RouteProgress is what signals the pending state.
  if (access === "pending") return null;

  if (access === "denied") {
    return (
      <Navigate
        to={isAuthenticated ? AUTH_ROUTES.unauthorized : AUTH_ROUTES.login}
        replace
      />
    );
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

  const settled = sessionStatus !== "idle" && sessionStatus !== "loading";
  const access = useSettledAccess(
    settled,
    isAuthenticated && canAccessManagerPortal(role)
  );

  // Only on a genuine COLD boot (nothing granted yet) is the full-screen loader
  // correct. Once this guard has admitted the user, the shell below it stays
  // mounted through any later session refresh — swapping it for a loader is
  // what produced the white flash between sidebar sections.
  if (access === "pending") return <FullScreenLoader />;

  if (access === "denied") {
    if (!isAuthenticated) return <Navigate to={AUTH_ROUTES.login} replace />;
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

  const settled = sessionStatus !== "idle" && sessionStatus !== "loading";
  const access = useSettledAccess(
    settled,
    isAuthenticated && canAccessCashierPortal(role)
  );

  if (access === "pending") return <FullScreenLoader />;

  if (access === "denied") {
    if (!isAuthenticated) return <Navigate to={AUTH_ROUTES.login} replace />;
    return <Navigate to={AUTH_ROUTES.dashboard} replace />;
  }

  return <Outlet />;
}
