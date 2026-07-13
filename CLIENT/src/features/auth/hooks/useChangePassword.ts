/**
 * @file features/auth/hooks/useChangePassword.ts
 *
 * Purpose: TanStack mutation hook for changing the authenticated user's password.
 *
 * Why it exists:
 *   Change-password is auth-scoped. After success, the backend invalidates
 *   all tokens — we must logout the user to prevent confusing 401s on next request.
 *   This business rule must live in the hook, not the component.
 */

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { changePasswordRequest } from "../api/authApi";
import { useLogout } from "./useLogout";
import type { ChangePasswordFormValues } from "../validation";

export function useChangePassword() {
  const { logout } = useLogout();

  return useMutation({
    mutationFn: (values: ChangePasswordFormValues) =>
      changePasswordRequest({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        confirmNewPassword: values.confirmNewPassword,
      }),

    onSuccess: () => {
      toast.success(
        "Password changed successfully. Please sign in again with your new password.",
        { duration: 6000 }
      );
      // Backend invalidates all tokens on password change.
      // We must log out to force re-authentication.
      setTimeout(() => logout(), 1500); // Small delay so user can read the toast
    },

    onError: (error: Error) => {
      toast.error(error.message ?? "Failed to change password. Please try again.");
    },
  });
}
