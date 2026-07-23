/**
 * @file features/auth/hooks/useLogin.ts
 *
 * Purpose: TanStack Query mutation hook for the login flow.
 *
 * Why it exists:
 *   Components must not call the API directly. This hook encapsulates:
 *   1. The API call (via authApi.loginRequest)
 *   2. Auth store update on success (setSession)
 *   3. TanStack Query cache invalidation
 *   4. Success navigation
 *   5. Error normalization
 *
 * Why TanStack useMutation (not useState + useEffect):
 *   useMutation provides isPending, isError, error, and data states for free.
 *   It prevents duplicate submissions automatically when `isPending` is true.
 *   It handles the loading/success/error lifecycle without manual state machines.
 *
 * Future extensibility:
 *   - Add onSuccess callback parameter for post-login redirects from deep links.
 *   - Add MFA challenge handling: on 202 response, redirect to /mfa-challenge.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useAuthStore } from "@/store/auth.store";
import { loginRequest } from "../api/authApi";
import { AUTH_QUERY_KEYS, AUTH_ROUTES } from "../constants";
import type { LoginFormValues } from "../validation";

export function useLogin() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { setSession } = useAuthStore();

  return useMutation({
    mutationFn: (values: LoginFormValues) => {
      // Determine if the identifier is an email or phone number.
      // The identifier is already trimmed by the form's zod resolver; the
      // password is not, so strip surrounding whitespace here. Browser autofill,
      // paste, and mobile keyboards frequently append a trailing space, which
      // otherwise causes a valid password to be rejected as "Invalid credentials".
      // Only leading/trailing whitespace is removed — never interior characters.
      const identifier = values.identifier.trim();
      const isEmail = identifier.includes("@");
      return loginRequest({
        ...(isEmail ? { email: identifier } : { phone: identifier }),
        password: values.password.trim(),
      });
    },

    onSuccess: (response) => {
      // The backend returns 'token', not 'accessToken'
      const { token, employee } = response.data;

      // 1. Hydrate the global auth store
      setSession(token, employee);

      // 2. Invalidate currentUser query so fresh data is fetched after login.
      //    Ensures /auth/me is called on the next consumption.
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEYS.currentUser });

      // 3. Show personalized welcome message (per design-principles.md: every
      //    action gets feedback; use entity name in the toast message).
      toast.success(`Welcome back, ${employee.firstName} 👋`);

      // 4. Navigate to dashboard. 'replace' prevents "back" returning to login.
      navigate(AUTH_ROUTES.dashboard, { replace: true });
    },

    onError: (_error: Error) => {
      // Error is normalized by axios interceptor to a plain Error object.
      // The hook surface returns `error` and `isError` — the form component renders them.
    },
  });
}
