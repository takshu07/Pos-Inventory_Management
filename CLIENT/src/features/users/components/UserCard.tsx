/**
 * The card fallback below `lg`, where UserTable's seven columns stop fitting.
 *
 * Carries the same facts as a table row — identity, contact, role, status,
 * recency — and the same action menu, so nothing is unreachable on a phone.
 */

import { Card } from "@/components/ui";
import { cn } from "@/utils/cn";
import type { User } from "../types";
import { formatLastLogin, fullName, initials } from "../utils/format";
import { UserRoleBadge, UserStatusBadge } from "./UserStatusBadge";
import { UserRowActions, type UserRowActionHandlers } from "./UserRowActions";

export function UserCard({
  user,
  onClick,
  currentUserId,
  ...actions
}: UserRowActionHandlers & {
  user: User;
  onClick: (user: User) => void;
  currentUserId: string | null;
}) {
  return (
    <Card
      onClick={() => onClick(user)}
      className={cn(
        "cursor-pointer p-4 transition-colors hover:bg-muted/30",
        !user.isActive && "opacity-60"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
          aria-hidden="true"
        >
          {initials(user)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">{fullName(user)}</span>
            {user.id === currentUserId && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                You
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {user.employeeCode} · {user.phone}
          </p>
          {user.email && (
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <UserRoleBadge role={user.role} />
            <UserStatusBadge isActive={user.isActive} />
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            Last sign-in: {formatLastLogin(user.lastLogin)}
          </p>
        </div>

        {/* Same stop-propagation reason as the table: the menu sits inside a
            clickable card. */}
        <div onClick={(e) => e.stopPropagation()}>
          <UserRowActions user={user} {...actions} />
        </div>
      </div>
    </Card>
  );
}
