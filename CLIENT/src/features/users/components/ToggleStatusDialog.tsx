/**
 * Activate / deactivate confirmation.
 *
 * DEACTIVATION IS THIS SYSTEM'S "DELETE". There is no delete endpoint for an
 * employee and there should not be: sales, attendance, register sessions and
 * audit entries all reference the row, and those FKs are `onDelete: Restrict`.
 * So the dialog explains what deactivation actually does — revokes access,
 * keeps history — because someone looking for a Delete button needs to know
 * this is it, and that the person's sales records survive.
 *
 * Reactivation is the same endpoint in the other direction and is deliberately
 * low-friction: it restores access and nothing else.
 */

import { AlertTriangle, UserCheck } from "lucide-react";

import { Button, Modal } from "@/components/ui";
import { useSetUserActive } from "../hooks/useUsers";
import type { User } from "../types";
import { denyStatusChange, type Actor } from "../utils/accountRules";
import { fullName } from "../utils/format";

export function ToggleStatusDialog({
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
  const setActive = useSetUserActive();

  if (!user) return null;

  const denial = denyStatusChange(actor, user);
  const deactivating = user.isActive;
  const canSubmit = !denial && !setActive.isPending;

  const submit = () => {
    if (!canSubmit) return;
    setActive.mutate(
      { id: user.id, isActive: !user.isActive, name: user.firstName },
      { onSuccess: onClose }
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        deactivating
          ? `Deactivate ${fullName(user)}?`
          : `Reactivate ${fullName(user)}?`
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={setActive.isPending}>
            Cancel
          </Button>
          <Button
            variant={deactivating ? "destructive" : "default"}
            onClick={submit}
            disabled={!canSubmit}
            loading={setActive.isPending}
          >
            {deactivating ? "Deactivate account" : "Reactivate account"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {denial ? (
          <p className="text-sm text-destructive">{denial}</p>
        ) : deactivating ? (
          <>
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/[0.06] p-3">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <p className="text-xs text-muted-foreground">
                {user.firstName} will be signed out immediately and will not be able to
                sign in again until the account is reactivated. If they are mid-sale,
                that sale will be interrupted.
              </p>
            </div>

            <p className="text-sm text-muted-foreground">
              Their sales, attendance and activity history are kept — this revokes
              access, it does not erase the record. Accounts are never deleted, so this
              can be undone at any time.
            </p>
          </>
        ) : (
          <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/[0.06] p-3">
            <UserCheck
              className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            <p className="text-xs text-muted-foreground">
              {user.firstName} will be able to sign in again with their existing
              password and their previous role ({user.role.toLowerCase()}).
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
