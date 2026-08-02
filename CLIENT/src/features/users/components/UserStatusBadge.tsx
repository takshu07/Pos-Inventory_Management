/**
 * Account status and role badges.
 *
 * Status is deliberately binary — Active / Deactivated — because that is what
 * `isActive` actually stores. The richer `employmentStatus` ladder (Probation,
 * On Leave, Suspended, Terminated) belongs to Workforce and describes the
 * EMPLOYMENT; this screen administers the LOGIN. Someone on leave still has a
 * working account, and conflating the two would mean an owner revoking access
 * by marking somebody "on leave", which revokes nothing.
 */

import { Badge } from "@/components/ui";
import { ROLE_BADGE_VARIANTS, ROLE_LABELS } from "@/features/auth";
import type { Role } from "@/types";

export function UserStatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <Badge variant={isActive ? "success" : "secondary"}>
      {isActive ? "Active" : "Deactivated"}
    </Badge>
  );
}

/**
 * Role badge. Colours come from the shared auth map rather than a local one, so
 * a role reads identically here, in the navbar and in the workforce roster.
 */
export function UserRoleBadge({ role }: { role: Role }) {
  return <Badge variant={ROLE_BADGE_VARIANTS[role]}>{ROLE_LABELS[role]}</Badge>;
}
