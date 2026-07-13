/**
 * @file lib/api/axios.ts
 *
 * Purpose: Centralized Axios client with JWT injection and 401 handling.
 *
 * Upgrades from initial version:
 *  1. 401 handling no longer uses window.location.href (causes full page reload,
 *     loses React state). Instead it dispatches clearSession() and lets the
 *     React Router navigate declaratively via the auth guard in MainLayout.
 *  2. Distinguishes between token-expired 401 (logout) vs. other 401s
 *     (e.g., wrong password during login — do NOT logout on those).
 *  3. Logs errors in development only — never in production (security).
 *
 * Security decisions:
 *  - Authorization header is pulled fresh from store on every request
 *    (not cached at client creation time) so token updates propagate instantly.
 *  - No retry logic for mutations (never retry payments or sales).
 *  - Error messages never expose stack traces to the UI.
 *
 * Future extensibility:
 *  - Add token refresh interceptor here when backend exposes /auth/refresh.
 *  - The isRefreshing / queued requests pattern is the standard approach.
 */

import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { ENV } from "@/config/env";
import { useAuthStore } from "@/store/auth.store";

export const apiClient = axios.create({
  baseURL: ENV.VITE_API_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

// ─── Request Interceptor: Inject JWT ─────────────────────────────────────────

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Read token fresh from store state on every request — not stale closure.
    const token = useAuthStore.getState().accessToken;
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response Interceptor: Handle Errors ─────────────────────────────────────

apiClient.interceptors.response.use(
  // On success: the backend wraps all data in { success, message, data }.
  // We return the full response so hooks can access .data.data, .data.message, etc.
  (response) => response.data,

  async (error: AxiosError) => {
    const status = error.response?.status;

    // ── 401 Handling ─────────────────────────────────────────────────────────
    // Only trigger logout if:
    //   a) We got a 401 AND
    //   b) The request was NOT to the login endpoint itself
    //      (wrong password returns 401 — that should NOT log out an active session)
    const isLoginEndpoint = error.config?.url?.includes("/auth/login");

    if (status === 401 && !isLoginEndpoint) {
      const { sessionStatus, clearSession, setSessionStatus } =
        useAuthStore.getState();

      // Only act if we thought we were authenticated. Prevents double-logout loops.
      if (sessionStatus === "authenticated") {
        setSessionStatus("expired");
        clearSession();
        // Let React Router's declarative guard (MainLayout → <Navigate to="/login">)
        // handle the redirect. No window.location.href — preserves React state.
      }
    }

    // ── Normalize Error Shape ─────────────────────────────────────────────────
    // Extract the most useful message available. Never expose raw Axios internals.
    const serverMessage = (error.response?.data as { message?: string })?.message;
    const message = serverMessage ?? error.message ?? "An unexpected error occurred.";

    // Log in development only — never log auth errors in production (token leaks).
    if (ENV.VITE_ENVIRONMENT === "development") {
      console.error(`[API Error] ${status ?? "Network"}: ${message}`);
    }

    return Promise.reject(new Error(message));
  }
);
