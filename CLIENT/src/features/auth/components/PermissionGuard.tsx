/**
 * @file features/auth/components/PermissionGuard.tsx
 *
 * Purpose: Conditionally renders children based on a permission check.
 *
 * Why it exists:
 *   Prevents scattered inline role checks (e.g., `{role === 'OWNER' && <DeleteButton />}`)
 *   throughout component trees. PermissionGuard makes intent explicit and
 *   centralizes the fallback behavior (render nothing, or render a fallback).
 *
 * Usage:
 *   <PermissionGuard check={canAccessAdmin}>
 *     <AdminButton />
 *   </PermissionGuard>
 *
 *   <PermissionGuard check={canVoidSale} fallback={<span>No permission</span>}>
 *     <VoidButton />
 *   </PermissionGuard>
 *
 * Security note:
 *   This is a UI guard only — it hides elements but does NOT prevent API calls.
 *   The backend enforces real authorization. This exists for UX, not security.
 */

import type { ReactNode } from "react";
import { useAuthStore, selectRole } from "@/store/auth.store";
import type { PermissionCheck } from "../types";

interface PermissionGuardProps {
  check: PermissionCheck;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGuard({
  check,
  children,
  fallback = null,
}: PermissionGuardProps) {
  const role = useAuthStore(selectRole);

  if (!check(role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
