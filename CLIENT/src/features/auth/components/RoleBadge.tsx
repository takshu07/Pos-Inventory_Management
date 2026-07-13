/**
 * @file features/auth/components/RoleBadge.tsx
 *
 * Purpose: Displays a user's role as a styled, color-coded badge.
 *
 * Why it exists:
 *   Role display appears in: Navbar user menu, Sidebar user footer,
 *   Employee Management list, and Profile screen. A single component
 *   ensures consistent visual treatment of roles across the entire app.
 *
 * Why it's in features/auth/components/:
 *   Role is an auth domain concept. The badge is consumed by shell
 *   components via the auth feature's public index.ts export — not
 *   by directly importing this file.
 */

import { Badge } from "@/components/ui";
import { ROLE_LABELS, ROLE_BADGE_VARIANTS } from "../utils/permissions";
import type { Role } from "@/types";

interface RoleBadgeProps {
  role: Role;
  className?: string;
}

export function RoleBadge({ role, className }: RoleBadgeProps) {
  return (
    <Badge variant={ROLE_BADGE_VARIANTS[role]} className={className}>
      {ROLE_LABELS[role]}
    </Badge>
  );
}
