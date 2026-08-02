/**
 * Role change confirmation.
 *
 * A role change is not a form field — it redraws what someone can see and do,
 * and the server force-closes every one of their sessions to make the new role
 * take effect immediately. That consequence is stated BEFORE the button, not
 * discovered from a toast afterwards: someone doing this mid-shift needs to
 * know they are about to interrupt a sale.
 *
 * The dropdown is built from `assignableRolesFor`, so a role the actor may not
 * assign is never offered. The guard is restated on submit and enforced again
 * by the server — three layers, because privilege escalation is the one thing
 * on this screen that must not be possible.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";

import { Button, Modal, Select } from "@/components/ui";
import { ROLE_LABELS } from "@/features/auth";
import { useChangeUserRole } from "../hooks/useUsers";
import { ASSIGNABLE_ROLES, type AssignableRole, type User } from "../types";
import { assignableRolesFor, denyRoleAssignment, type Actor } from "../utils/accountRules";
import { fullName } from "../utils/format";
import { UserRoleBadge } from "./UserStatusBadge";

const ROLE_EXPLANATIONS: Record<AssignableRole, string> = {
  MANAGER:
    "Runs the shop floor: dashboard, checkout, sales, customers, read-only products and staff monitoring.",
  CASHIER: "Checkout and their own register only — no management screens.",
};

export function ChangeRoleDialog({
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
  const changeRole = useChangeUserRole();
  const [nextRole, setNextRole] = useState<AssignableRole | "">("");

  // Never carry a selection across opens — including onto a different person,
  // which is how the wrong account gets re-roled.
  useEffect(() => {
    setNextRole("");
  }, [user, open]);

  if (!user) return null;

  const options = assignableRolesFor(actor, user, ASSIGNABLE_ROLES);
  const denial = nextRole ? denyRoleAssignment(actor, user, nextRole) : null;
  const canSubmit = nextRole !== "" && !denial && !changeRole.isPending;

  const submit = () => {
    if (!canSubmit) return;
    changeRole.mutate(
      { id: user.id, role: nextRole as AssignableRole, name: user.firstName },
      { onSuccess: onClose }
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Change role for ${fullName(user)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={changeRole.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} loading={changeRole.isPending}>
            Change role
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {denyRoleAssignment(actor, user, "CASHIER") ??
              "There is no other role you can assign to this account."}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3 text-sm">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Current</span>
                <UserRoleBadge role={user.role} />
              </div>
              <ArrowRight className="mt-4 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">New</span>
                {nextRole ? (
                  <UserRoleBadge role={nextRole} />
                ) : (
                  <span className="text-sm text-muted-foreground">Not chosen</span>
                )}
              </div>
            </div>

            <Select
              label="New role"
              placeholder="Choose a role"
              value={nextRole}
              onChange={(e) => setNextRole(e.target.value as AssignableRole)}
              options={options.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
              {...(nextRole ? { hint: ROLE_EXPLANATIONS[nextRole] } : {})}
            />

            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden="true"
              />
              <p className="text-xs text-muted-foreground">
                This signs {user.firstName} out of every device immediately so the new
                permissions take effect. If they are mid-sale, that sale will be
                interrupted.
              </p>
            </div>

            {denial && <p className="text-sm text-destructive">{denial}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
