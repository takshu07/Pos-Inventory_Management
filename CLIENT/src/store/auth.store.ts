/**
 * @file store/auth.store.ts
 *
 * Purpose: Global Zustand store for client-side authentication state.
 *
 * Why it lives in src/store/ and NOT in features/auth/:
 *   The auth store is global infrastructure — the axios client (src/lib/api/axios.ts),
 *   the MainLayout guard, the Sidebar RBAC filter, and the Navbar all read from it.
 *   These are NOT features — they are application shell components. If this store
 *   lived inside features/auth/, those shell components would depend on a feature,
 *   creating an illegal downward dependency violation.
 *
 *   Rule: features/auth/ WRITES to this store. Shell components READ from it.
 *
 * Why Zustand (not React Context):
 *   1. Non-React files (axios.ts) can read state synchronously via getState().
 *   2. Granular subscriptions — components subscribe to only the slice they need,
 *      preventing re-renders from unrelated state changes.
 *   3. Built-in persistence middleware for session restoration.
 *
 * Security decisions:
 *   - Only accessToken and user are persisted to localStorage (partialize).
 *   - sessionStatus is never persisted — it is always re-derived on mount.
 *   - isAuthenticated is a computed helper, not stored state, preventing stale
 *     boolean values after token invalidation.
 *
 * Future extensibility:
 *   - Add refreshToken field when backend exposes refresh endpoint.
 *   - Add activeStore for multi-store support.
 *   - Add mfaRequired flag for MFA challenge flow.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthStoreState, AuthUser, SessionStatus } from "@/features/auth/types";

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set) => ({
      // ── Persisted State ───────────────────────────────────────────────────
      accessToken: null,
      user: null,

      // ── Non-persisted State ───────────────────────────────────────────────
      // 'idle' means we haven't checked yet (first render before hydration).
      // The AuthBootstrapper in AppProvider will transition this to
      // 'authenticated' or 'unauthenticated' on mount.
      sessionStatus: "idle" as SessionStatus,

      // ── Actions ───────────────────────────────────────────────────────────

      /**
       * setSession — Called after successful login or session rehydration.
       * Sets token, user, and marks session as authenticated.
       */
      setSession: (token: string, user: AuthUser) => {
        set({
          accessToken: token,
          user,
          sessionStatus: "authenticated",
        });
      },

      /**
       * clearSession — Called on logout or 401 rejection.
       * Wipes all auth state and marks session as unauthenticated.
       * Does NOT navigate — navigation is handled by the caller
       * (hook or axios interceptor) to keep this store framework-agnostic.
       */
      clearSession: () => {
        set({
          accessToken: null,
          user: null,
          sessionStatus: "unauthenticated",
        });
      },

      /**
       * setSessionStatus — Allows setting transient states like 'loading', 'expired'.
       * Used by AuthBootstrapper during session validation.
       */
      setSessionStatus: (status: SessionStatus) => {
        set({ sessionStatus: status });
      },

      /**
       * updateUser — Called when /auth/me returns fresh profile data.
       * Updates user without clearing the token (used for profile refresh).
       */
      updateUser: (user: AuthUser) => {
        set({ user });
      },
    }),
    {
      name: "cex-auth-storage",
      // Only persist what MUST survive a browser refresh.
      // sessionStatus is deliberately excluded — it must be re-validated on boot.
      partialize: (state) => ({
        accessToken: state.accessToken,
        user: state.user,
      }),
    }
  )
);

// ─── Store Selectors ──────────────────────────────────────────────────────────
// Pre-built selectors prevent inline arrow functions in components,
// which would create new function references on every render.

export const selectAccessToken = (s: AuthStoreState) => s.accessToken;
export const selectUser = (s: AuthStoreState) => s.user;
export const selectIsAuthenticated = (s: AuthStoreState) => s.sessionStatus === "authenticated";
export const selectRole = (s: AuthStoreState) => s.user?.role ?? null;
export const selectSessionStatus = (s: AuthStoreState) => s.sessionStatus;
