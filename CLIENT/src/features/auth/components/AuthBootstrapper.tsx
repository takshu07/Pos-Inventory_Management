/**
 * @file features/auth/components/AuthBootstrapper.tsx
 *
 * Purpose: Session rehydration on application boot.
 *
 * Problem it solves:
 *   On a browser refresh, Zustand rehydrates accessToken from localStorage.
 *   But we don't know if that token is still valid (it could be expired, or the
 *   user's account could have been deactivated by an admin).
 *   
 *   Without validation, the app would let the user navigate to authenticated
 *   routes with a stale/invalid token, which would then fail on the first real
 *   API call — a confusing experience.
 *
 * What it does:
 *   1. On mount, if a token exists in localStorage, it calls GET /auth/me.
 *   2. If the response is 200: updates the store with fresh user data,
 *      transitions sessionStatus to 'authenticated'.
 *   3. If the response is 401: axios interceptor sets status to 'expired',
 *      clearSession() is called, user is redirected to /login.
 *   4. If no token: immediately sets sessionStatus to 'unauthenticated'.
 *
 * Why a component (not a hook in AppProvider):
 *   Components can cleanly read from Zustand and TanStack Query together.
 *   The effect pattern here is a mount-once behavior — using it in a component
 *   mounted inside QueryProvider ensures the queryClient is available.
 *
 * Where it's mounted:
 *   Inside AppProvider, below QueryProvider. It renders no UI — returns null.
 */

import { useEffect } from "react";
import { useAuthStore, selectAccessToken } from "@/store/auth.store";
import { getCurrentUser } from "../api/authApi";

export function AuthBootstrapper() {
  const accessToken = useAuthStore(selectAccessToken);
  const { setSession, setSessionStatus, clearSession } = useAuthStore();

  useEffect(() => {
    // No token = definitively unauthenticated. Skip the API call.
    if (!accessToken) {
      setSessionStatus("unauthenticated");
      return;
    }

    // Token exists — validate it against the server.
    setSessionStatus("loading");

    getCurrentUser()
      .then((response) => {
        // Token is valid — hydrate with fresh user data.
        setSession(accessToken, response.data);
      })
      .catch(() => {
        // Token is invalid/expired — axios interceptor already set status to 'expired'.
        // clearSession() was also called by the interceptor.
        // We just ensure we're in a clean unauthenticated state.
        clearSession();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps: run ONCE on mount only. Intentional.

  return null; // Renders nothing — pure side-effect component
}
