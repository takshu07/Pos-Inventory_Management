/**
 * @file features/auth/hooks/useCurrentUser.ts
 *
 * Purpose: TanStack Query hook for the current authenticated user's profile.
 *
 * Why it exists:
 *   1. Validates the persisted token on app boot (session rehydration).
 *   2. Provides fresh user data for the Profile screen and Navbar.
 *   3. Keeps the store in sync with the backend's source of truth.
 *
 * Architectural decision — why both store AND query:
 *   The Zustand store holds the session TOKEN for fast, synchronous access
 *   (no async wait needed for axios interceptors).
 *   The TanStack Query holds the USER PROFILE for cached, refetchable server state.
 *   These are distinct concerns: auth token lifecycle vs. user data freshness.
 *
 * Why `enabled: !!accessToken`:
 *   Never fires the query when unauthenticated. Prevents 401s on public routes.
 *   The query automatically activates once the token is set after login.
 */

import { useQuery } from "@tanstack/react-query";
import { useAuthStore, selectAccessToken } from "@/store/auth.store";
import { getCurrentUser } from "../api/authApi";
import { AUTH_QUERY_KEYS } from "../constants";

export function useCurrentUser() {
  const accessToken = useAuthStore(selectAccessToken);

  return useQuery({
    queryKey: AUTH_QUERY_KEYS.currentUser,
    queryFn: getCurrentUser,
    // Only run when we have a token
    enabled: !!accessToken,
    // User profile is relatively stable — 10 minute stale time
    staleTime: 1000 * 60 * 10,
    // On success: optionally update the store with fresh user data
    // This handles role changes made by admin that need to propagate
    select: (response) => response.data,
  });
}
