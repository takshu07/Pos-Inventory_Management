/**
 * Read-only account detail, opened by clicking a row.
 *
 * Deliberately NOT an edit surface. Clicking a row to inspect an account is a
 * far more common intent than clicking it to change one, and a panel where
 * every field is live is a panel where a stray keystroke edits a colleague's
 * phone number. Editing is an explicit choice from the footer or the row menu.
 *
 * It re-fetches the single account rather than rendering the list row it was
 * given: the list row can be up to 30s stale, and this is the surface someone
 * opens to answer "what is this account's state right now?". The list row is
 * used as immediate placeholder content so the panel is never blank.
 */

import { KeyRound, Pencil, ShieldCheck, UserCheck, UserX } from "lucide-react";

import { Button, Drawer } from "@/components/ui";
import { useUser } from "../hooks/useUsers";
import type { User } from "../types";
import {
  denyModify,
  denyPasswordReset,
  denyRoleChange,
  denyStatusChange,
  type Actor,
} from "../utils/accountRules";
import {
  formatDate,
  formatDateTime,
  formatGender,
  formatLastLogin,
  formatSalary,
  fullName,
  initials,
} from "../utils/format";
import { UserRoleBadge, UserStatusBadge } from "./UserStatusBadge";

export function UserDetailDrawer({
  user,
  actor,
  open,
  onClose,
  onEdit,
  onChangeRole,
  onToggleStatus,
  onResetPassword,
}: {
  user: User | null;
  actor: Actor;
  open: boolean;
  onClose: () => void;
  onEdit: (user: User) => void;
  onChangeRole: (user: User) => void;
  onToggleStatus: (user: User) => void;
  onResetPassword: (user: User) => void;
}) {
  // Gated on the drawer being open so closing it does not keep a query alive.
  const detail = useUser(open && user ? user.id : undefined);

  if (!user) return null;

  // Fresh data when it lands, the list row until then — never a blank panel.
  const shown: User = detail.data ?? user;
  const isSelf = shown.id === actor.id;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={fullName(shown)}
      description={`${shown.employeeCode} · ${shown.role.toLowerCase()}`}
      width="w-full max-w-md"
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          <ActionButton
            label="Edit"
            icon={Pencil}
            denial={denyModify(actor, shown)}
            onClick={() => onEdit(shown)}
          />
          <ActionButton
            label="Change role"
            icon={ShieldCheck}
            denial={denyRoleChange(actor, shown)}
            onClick={() => onChangeRole(shown)}
          />
          <ActionButton
            label="Reset password"
            icon={KeyRound}
            denial={denyPasswordReset(actor, shown)}
            onClick={() => onResetPassword(shown)}
          />
          <ActionButton
            label={shown.isActive ? "Deactivate" : "Reactivate"}
            icon={shown.isActive ? UserX : UserCheck}
            denial={denyStatusChange(actor, shown)}
            onClick={() => onToggleStatus(shown)}
            variant={shown.isActive ? "destructive" : "default"}
          />
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {/* ── Identity header ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground"
            aria-hidden="true"
          >
            {initials(shown)}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{fullName(shown)}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <UserRoleBadge role={shown.role} />
              <UserStatusBadge isActive={shown.isActive} />
              {isSelf && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  This is you
                </span>
              )}
            </div>
          </div>
        </div>

        {/* A deactivated account looks identical to an active one apart from a
            badge, so the state is spelled out where an owner will read it. */}
        {!shown.isActive && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            This account cannot sign in. Its sales, attendance and activity history are
            unaffected.
          </p>
        )}

        <Section title="Account">
          <Row label="Employee code" value={shown.employeeCode} />
          <Row label="Phone" value={shown.phone} />
          <Row label="Email" value={shown.email ?? "Not set"} />
          <Row label="Last sign-in" value={formatLastLogin(shown.lastLogin)} />
        </Section>

        <Section title="Employment">
          <Row label="Joined" value={formatDate(shown.joiningDate)} />
          <Row label="Salary" value={formatSalary(shown.salary)} />
          <Row label="Gender" value={formatGender(shown.gender)} />
          <Row label="Date of birth" value={formatDate(shown.dateOfBirth)} />
          <Row label="Address" value={shown.address || "—"} />
        </Section>

        <Section title="Record">
          <Row label="Created" value={formatDateTime(shown.createdAt)} />
          <Row label="Last updated" value={formatDateTime(shown.updatedAt)} />
        </Section>
      </div>
    </Drawer>
  );
}

/**
 * A footer action that disables itself with a reason rather than disappearing.
 * Same principle as the row menu — see UserRowActions.
 */
function ActionButton({
  label,
  icon: Icon,
  denial,
  onClick,
  variant = "outline",
}: {
  label: string;
  icon: typeof Pencil;
  denial: string | null;
  onClick: () => void;
  variant?: "outline" | "destructive" | "default";
}) {
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={denial !== null}
      title={denial ?? undefined}
      onClick={onClick}
    >
      <Icon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </Button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <dl className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {children}
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm">{value}</dd>
    </div>
  );
}
