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
 *   The local teardown must happen unconditionally and synchronously. A
 *   mutation's pending/error states would put the user's ability to sign out at
 *   the mercy of the network, which is the wrong trade for this action.
 *
 * The server call:
 *   POST /auth/logout closes the SESSION ROW that the Workforce module reads
 *   for presence and login history — without it, a signed-out employee keeps
 *   showing as "online" until their heartbeat goes stale. The JWT is stateless
 *   and is simply dropped client-side, so the call is fire-and-forget: it is
 *   dispatched before the local teardown (the token is still in the store at
 *   that point) and its failure is swallowed. Logging out must always succeed
 *   locally, even offline.
 *
 * Future extensibility:
 *   - Clear any IndexedDB / service worker caches here.
 */

import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth.store";
import { logoutRequest } from "../api/authApi";
import { AUTH_ROUTES } from "../constants";

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { clearSession } = useAuthStore();

  const logout = useCallback(() => {
    // 1. Tell the server to close the session. Fired BEFORE clearSession so the
    //    request still carries the token. Not awaited, and never allowed to
    //    throw — a failed request must not keep the user signed in.
    void logoutRequest().catch(() => {});

    // 2. Clear auth store — triggers MainLayout guard to redirect
    clearSession();

    // 3. Purge ALL TanStack Query cache — prevents stale data flash
    //    if another employee logs in on the same device/browser tab.
    queryClient.clear();

    // 4. Navigate to login (replace: true — no back button returns to app)
    navigate(AUTH_ROUTES.login, { replace: true });
  }, [clearSession, queryClient, navigate]);

  return { logout };
}
