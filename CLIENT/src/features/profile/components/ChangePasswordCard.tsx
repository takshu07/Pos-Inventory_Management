/**
 * Change-your-own-password card.
 *
 * Distinct from the owner's reset in Users & Roles in the way that matters:
 * this REQUIRES the current password. That is what stops an unattended,
 * unlocked session from being converted into a permanent account takeover —
 * the owner-reset path deliberately does not point at your own account for the
 * same reason.
 *
 * On success the server increments `refreshTokenVersion`, invalidating every
 * token including the one this tab is holding. `useChangePassword` therefore
 * logs the user out after a short delay; the copy below says so before they
 * commit, so being bounced to the sign-in screen is an expected outcome rather
 * than a bug they report.
 *
 * The rules mirror `features/auth`'s changePasswordSchema, which mirrors the
 * server's auth.validation — stricter than the employee endpoints' (it also
 * requires a special character), because /auth/change-password is stricter.
 */

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Info } from "lucide-react";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { PasswordField, useChangePassword } from "@/features/auth";
import { changePasswordSchema, type ChangePasswordFormValues } from "@/features/auth/validation";

export function ChangePasswordCard() {
  const changePassword = useChangePassword();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    },
  });

  // Deliberately no form reset on success: the hook signs the user out ~1.5s
  // later, so clearing the fields would just flash an empty form on the way to
  // the login screen.
  const onSubmit = (values: ChangePasswordFormValues) => {
    changePassword.mutate(values);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>
          Choose a password you do not use anywhere else.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">
              Changing your password signs you out of every device, including this one.
              You will need to sign in again with the new password.
            </p>
          </div>

          <PasswordField
            label="Current password"
            required
            autoComplete="current-password"
            disabled={changePassword.isPending}
            error={errors.currentPassword?.message}
            {...register("currentPassword")}
          />

          <PasswordField
            label="New password"
            required
            autoComplete="new-password"
            disabled={changePassword.isPending}
            hint="8+ characters with an uppercase letter, a number and a special character."
            error={errors.newPassword?.message}
            {...register("newPassword")}
          />

          <PasswordField
            label="Confirm new password"
            required
            autoComplete="new-password"
            disabled={changePassword.isPending}
            error={errors.confirmNewPassword?.message}
            {...register("confirmNewPassword")}
          />

          {changePassword.isError && (
            <p className="text-sm text-destructive" role="alert">
              {changePassword.error?.message ||
                "Could not change your password. Please try again."}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" loading={changePassword.isPending}>
              Change password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
