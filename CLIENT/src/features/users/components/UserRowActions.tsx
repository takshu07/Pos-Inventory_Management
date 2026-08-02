/**
 * Per-row action menu.
 *
 * THE DESIGN DECISION HERE: an action the actor may not perform is rendered
 * DISABLED WITH ITS REASON, not hidden. Hiding it makes an administration
 * screen feel broken — the owner knows "change role" exists and cannot tell why
 * it disappeared from one row. Showing "You cannot change your own role" costs
 * one line and answers the question.
 *
 * Every reason comes from ../utils/accountRules, which mirrors the server's
 * guards. The disabled state is a courtesy, never the boundary: each of these
 * endpoints independently rejects the call.
 */

import { useEffect, useRef, useState } from "react";
import {
  KeyRound,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  UserCheck,
  UserX,
} from "lucide-react";

import { Button } from "@/components/ui";
import { cn } from "@/utils/cn";
import type { User } from "../types";
import {
  denyModify,
  denyPasswordReset,
  denyRoleChange,
  denyStatusChange,
  type Actor,
} from "../utils/accountRules";

export interface UserRowActionHandlers {
  actor: Actor;
  onEdit: (user: User) => void;
  onChangeRole: (user: User) => void;
  onToggleStatus: (user: User) => void;
  onResetPassword: (user: User) => void;
}

export function UserRowActions({
  user,
  actor,
  onEdit,
  onChangeRole,
  onToggleStatus,
  onResetPassword,
}: UserRowActionHandlers & { user: User }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape. A menu that survives either feels
  // stuck, and this one sits inside a clickable row where a stray click is likely.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const items: MenuItemSpec[] = [
    {
      label: "Edit details",
      icon: Pencil,
      denial: denyModify(actor, user),
      onSelect: run(() => onEdit(user)),
    },
    {
      label: "Change role",
      icon: ShieldCheck,
      denial: denyRoleChange(actor, user),
      onSelect: run(() => onChangeRole(user)),
    },
    {
      label: user.isActive ? "Deactivate account" : "Reactivate account",
      icon: user.isActive ? UserX : UserCheck,
      denial: denyStatusChange(actor, user),
      onSelect: run(() => onToggleStatus(user)),
      // Deactivation revokes access — styled as the destructive act it is.
      destructive: user.isActive,
    },
    {
      label: "Reset password",
      icon: KeyRound,
      denial: denyPasswordReset(actor, user),
      onSelect: run(() => onResetPassword(user)),
    },
  ];

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${user.firstName} ${user.lastName}`}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {items.map((item) => (
            <MenuItem key={item.label} {...item} />
          ))}
        </div>
      )}
    </div>
  );
}

interface MenuItemSpec {
  label: string;
  icon: typeof Pencil;
  /** Non-null renders the item disabled and shows this as the explanation. */
  denial: string | null;
  onSelect: () => void;
  destructive?: boolean;
}

function MenuItem({ label, icon: Icon, denial, onSelect, destructive }: MenuItemSpec) {
  const disabled = denial !== null;

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      // `title` gives the reason on hover; the inline text below gives it to
      // touch and screen-reader users, who never see a title attribute.
      title={denial ?? undefined}
      className={cn(
        "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors",
        disabled
          ? "cursor-not-allowed opacity-55"
          : destructive
            ? "text-destructive hover:bg-destructive/10"
            : "hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {label}
      </span>
      {denial && (
        <span className="pl-6 text-[11px] leading-tight text-muted-foreground">
          {denial}
        </span>
      )}
    </button>
  );
}
