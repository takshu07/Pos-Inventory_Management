/**
 * Owner-initiated password reset.
 *
 * Distinct from My Profile's change-password in a way that matters: this path
 * does NOT require the target's current password, so it is the account-recovery
 * tool for someone who is locked out. That also makes it the most dangerous
 * control on this screen, which is why `denyPasswordReset` refuses to let it
 * point at your own account — an unlocked session must not be convertible into
 * a permanent takeover of the owner account without knowing the password.
 *
 * The consequence is stated before the action: a reset bumps the token version
 * and closes every session, signing the employee out of every device.
 *
 * The policy mirrored here (8+, upper, lower, digit) is the server's, in
 * workforce.validation. This check is convenience — the server rejects a weak
 * password independently.
 */

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle } from "lucide-react";

import { Button, Modal } from "@/components/ui";
import { PasswordField } from "@/features/auth";
import { useResetUserPassword } from "../hooks/useUsers";
import { resetPasswordSchema, type ResetPasswordFormValues } from "../validation";
import type { User } from "../types";
import { denyPasswordReset, type Actor } from "../utils/accountRules";
import { fullName } from "../utils/format";

export function ResetPasswordDialog({
  user,
  actor,
  open,
  onClose,
}: {
  user: User | null;
  actor: Actor;
  open: boolean;
  onClose: () => void;
}) {
  const reset = useResetUserPassword();

  const {
    register,
    handleSubmit,
    reset: resetForm,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  // Never carry a typed password across opens — including onto a different
  // employee, which is how the wrong account gets reset.
  useEffect(() => {
    resetForm({ newPassword: "", confirmPassword: "" });
  }, [user, open, resetForm]);

  if (!user) return null;

  const denial = denyPasswordReset(actor, user);

  const onSubmit = (values: ResetPasswordFormValues) => {
    if (denial) return;
    reset.mutate(
      { id: user.id, newPassword: values.newPassword, name: user.firstName },
      {
        onSuccess: () => {
          resetForm({ newPassword: "", confirmPassword: "" });
          onClose();
        },
      }
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reset password for ${fullName(user)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={reset.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="reset-password-form"
            disabled={Boolean(denial)}
            loading={reset.isPending}
          >
            Reset password
          </Button>
        </>
      }
    >
      {denial ? (
        <p className="text-sm text-destructive">{denial}</p>
      ) : (
        <form
          id="reset-password-form"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-4"
        >
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <p className="text-xs text-muted-foreground">
              This signs {user.firstName} out of every device immediately. If they are
              mid-sale, that sale will be interrupted. Share the new password with them
              directly — it is not emailed.
            </p>
          </div>

          <PasswordField
            label="New password"
            required
            autoComplete="new-password"
            placeholder="At least 8 characters"
            hint="8+ characters with an uppercase letter, a lowercase letter and a number."
            error={errors.newPassword?.message}
            {...register("newPassword")}
          />

          <PasswordField
            label="Confirm password"
            required
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register("confirmPassword")}
          />

          {reset.isError && (
            <p className="text-sm text-destructive" role="alert">
              {reset.error?.message || "Could not reset the password. Please try again."}
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}
