/**
 * Users & Roles — React Query hooks.
 *
 * Caching: account records are not presence-bearing, so nothing here polls.
 * A user list that is thirty seconds stale is fine; the workforce roster polls
 * because an "online" dot that is stale is actively misleading, which is not a
 * property this screen has.
 *
 * Every mutation invalidates BOTH this feature's keys and the workforce
 * subtree. That second invalidation is not incidental: creating, deactivating
 * or re-roling an account changes the roster rows, the headcount stat cards and
 * the permission matrix that the Workforce module renders from its own cache.
 * Without it, an owner who deactivates someone here and switches to
 * /admin/staff sees them listed as active until that cache expires on its own.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { workforceKeys } from "@/features/workforce";
import * as api from "../api/usersApi";
import type {
  AssignableRole,
  CreateUserPayload,
  UpdateUserPayload,
  UserListParams,
} from "../types";

// =============================================================================
// QUERY KEYS
// A single factory so an invalidation can never miss a key by mistyping it.
// =============================================================================

export const userKeys = {
  all: ["users"] as const,
  lists: () => [...userKeys.all, "list"] as const,
  list: (p: UserListParams) => [...userKeys.lists(), p] as const,
  detail: (id: string) => [...userKeys.all, "detail", id] as const,
};

/** Account data changes rarely and never retroactively. */
const USERS_STALE_MS = 30_000;

// =============================================================================
// QUERIES
// =============================================================================

export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: () => api.fetchUsers(params),
    // Paging and filtering update the table in place rather than flashing a
    // skeleton over content that is about to be replaced by similar content.
    placeholderData: (prev) => prev,
    staleTime: USERS_STALE_MS,
  });
}

/** Single account. Enabled-gated so it only runs when a drawer is actually open. */
export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: userKeys.detail(id ?? ""),
    queryFn: () => api.fetchUser(id as string),
    enabled: Boolean(id),
    staleTime: USERS_STALE_MS,
  });
}

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Invalidates every cache an account change can be visible in.
 *
 * Shared by all five mutations rather than repeated, so a future cache that
 * needs busting is added in one place. See the file header for why the
 * workforce subtree is included.
 */
function useAccountInvalidation() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: userKeys.all });
    qc.invalidateQueries({ queryKey: workforceKeys.all });
  };
}

/**
 * Surfaces the server's own message.
 *
 * These endpoints return specific, actionable errors — "An employee with this
 * phone number already exists", "You do not have permission to modify a
 * MANAGER", "The owner account cannot be deactivated". Replacing those with a
 * generic string would discard the only information that tells the owner what
 * to do differently.
 */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useCreateUser() {
  const invalidate = useAccountInvalidation();

  return useMutation({
    mutationFn: (payload: CreateUserPayload) => api.createUser(payload),
    onSuccess: (user) => {
      invalidate();
      toast.success(`${user.firstName} ${user.lastName} can now sign in.`);
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Could not create the account."));
    },
  });
}

export function useUpdateUser() {
  const invalidate = useAccountInvalidation();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateUserPayload }) =>
      api.updateUser(id, payload),
    onSuccess: () => {
      invalidate();
      toast.success("Account updated.");
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Could not save the changes."));
    },
  });
}

/**
 * Activate / deactivate.
 *
 * Kept separate from useUpdateUser despite sharing its endpoint, because the
 * toast has to name which direction happened — "Account updated" after
 * revoking someone's access is not a useful confirmation.
 */
export function useSetUserActive() {
  const invalidate = useAccountInvalidation();

  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean; name?: string }) =>
      api.setUserActive(id, isActive),
    onSuccess: (_data, variables) => {
      invalidate();
      const who = variables.name ?? "The account";
      toast.success(
        variables.isActive
          ? `${who} can sign in again.`
          : `${who} has been deactivated and signed out.`
      );
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Could not change the account status."));
    },
  });
}

export function useChangeUserRole() {
  const invalidate = useAccountInvalidation();

  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: AssignableRole; name?: string }) =>
      api.changeUserRole(id, role),
    onSuccess: (_data, variables) => {
      invalidate();
      // The consequence matters more than the confirmation: the server closes
      // their sessions, so they are signed out whether or not anyone says so.
      toast.success(
        `Role updated. ${variables.name ?? "The employee"} has been signed out and must sign in again.`
      );
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Could not change the role."));
    },
  });
}

export function useResetUserPassword() {
  const invalidate = useAccountInvalidation();

  return useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string; name?: string }) =>
      api.resetUserPassword(id, newPassword),
    onSuccess: (_data, variables) => {
      // Sessions closed → presence and login history both change.
      invalidate();
      toast.success(
        `Password reset. ${variables.name ?? "The employee"} has been signed out of every device.`
      );
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Could not reset the password."));
    },
  });
}
