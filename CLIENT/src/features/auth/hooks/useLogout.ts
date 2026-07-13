/**
 * @file features/auth/hooks/useLogout.ts
 *
 * Purpose: Encapsulates the complete logout flow including store clearing,
 * query cache purging, and navigation.
 *
 * Why it exists:
 *   Logout has side effects beyond just clearing the store:
 *   1. The TanStack Query cache must be cleared (stale data from previous
 *      user must not flash when the next user logs in on the same device).
 *   2. Navigation to /login must happen AFTER the store is cleared
 *      (otherwise the auth guard would see isAuthenticated=true briefly).
 *
 * Why NOT a TanStack mutation:
 *   Logout is a local operation — we do NOT call the backend on logout
 *   (the backend uses stateless JWTs; there is no server-side session to destroy).
 *   If a server-side logout endpoint is added in future, this hook is the
 *   single place to add that API call.
 *
 * Future extensibility:
 *   - Add apiClient.post("/auth/logout") call when backend adds it.
 *   - Clear any IndexedDB / service worker caches here.
 */

import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth.store";
import { AUTH_ROUTES } from "../constants";

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { clearSession } = useAuthStore();

  const logout = useCallback(() => {
    // 1. Clear auth store — triggers MainLayout guard to redirect
    clearSession();

    // 2. Purge ALL TanStack Query cache — prevents stale data flash
    //    if another employee logs in on the same device/browser tab.
    queryClient.clear();

    // 3. Navigate to login (replace: true — no back button returns to app)
    navigate(AUTH_ROUTES.login, { replace: true });
  }, [clearSession, queryClient, navigate]);

  return { logout };
}
