/**
 * Owner-only password reset.
 *
 * The consequence is spelled out before the action, not after: a reset bumps
 * the token version and closes every open session, so the employee is signed
 * out of every device immediately. Someone doing this mid-shift needs to know
 * that before they click, not from a toast afterwards.
 *
 * The policy mirrored here (8+ chars, upper, lower, digit) is the server's, in
 * auth.validation. This check is convenience — the server rejects a weak
 * password independently.
 */

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Button, Input, Modal } from "@/components/ui";
import { useResetPassword } from "../hooks/useWorkforce";
import type { WorkforceEmployee } from "../types";

/** Same rule as the server. Kept beside the message that explains it. */
const POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export function ResetPasswordDialog({
  employee,
  open,
  onClose,
}: {
  employee: WorkforceEmployee | null;
  open: boolean;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const reset = useResetPassword();

  // Never carry a typed password across opens — including onto a different
  // employee, which is how the wrong account gets reset.
  useEffect(() => {
    setPassword("");
    setConfirm("");
  }, [employee, open]);

  if (!employee) return null;

  const tooWeak = password.length > 0 && !POLICY.test(password);
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = POLICY.test(password) && password === confirm && !reset.isPending;

  const submit = () => {
    if (!canSubmit) return;
    reset.mutate(
      { id: employee.id, newPassword: password },
      { onSuccess: onClose }
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reset password for ${employee.fullName}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={reset.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} loading={reset.isPending}>
            Reset password
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <p className="text-xs text-muted-foreground">
            This signs {employee.firstName} out of every device immediately. If they are
            mid-sale, that sale will be interrupted.
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">New password</span>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
          {tooWeak && (
            <span className="text-[11px] text-destructive">
              Needs 8+ characters with an uppercase letter, a lowercase letter and a number.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Confirm password</span>
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
          {mismatch && (
            <span className="text-[11px] text-destructive">Passwords do not match.</span>
          )}
        </label>

        {reset.isError && (
          <p className="text-sm text-destructive">
            Could not reset the password. Please try again.
          </p>
        )}
      </div>
    </Modal>
  );
}
