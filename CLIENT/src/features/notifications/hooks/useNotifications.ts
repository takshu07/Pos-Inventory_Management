/**
 * Notifications — React Query hooks.
 *
 * Caching: unlike audit entries, notifications DO change — `isRead` flips. So
 * every mutation invalidates both the list and the summary, because marking one
 * read changes the badge count as well as the row.
 *
 * Nothing polls on an interval. The screen is a destination the user navigates
 * to, and a background poll on every mounted tab is a cost the badge does not
 * justify; `refetchOnWindowFocus` covers the "I left this open" case.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import * as api from "../api/notificationsApi";
import type { NotificationListParams } from "../types";

// =============================================================================
// QUERY KEYS
// One factory so an invalidation can never miss a key by mistyping it.
// =============================================================================

export const notificationKeys = {
  all: ["notifications"] as const,
  lists: () => [...notificationKeys.all, "list"] as const,
  list: (p: NotificationListParams) => [...notificationKeys.lists(), p] as const,
  summary: () => [...notificationKeys.all, "summary"] as const,
};

/** A list can only be missing new arrivals or stale read-state; 30s is plenty. */
const LIST_STALE_MS = 30_000;

export function useNotifications(params: NotificationListParams) {
  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: () => api.fetchNotifications(params),
    // Paging and filtering update the table in place rather than flashing a
    // skeleton over content about to be replaced by similar content.
    placeholderData: (prev) => prev,
    staleTime: LIST_STALE_MS,
  });
}

/**
 * Counts for the badge and the category/severity chips.
 *
 * Shared by the Notifications screen and the Navbar bell under ONE query key,
 * so the two can never show different unread totals and the shell does not pay
 * for a second request. That sharing is also why the screen's mutations
 * invalidate `notificationKeys.all` rather than just the list — the bell is a
 * subscriber to the same cache entry.
 *
 * `enabled` exists for the shell: the Navbar renders inside an auth guard, but
 * gating on the user keeps a logged-out frame from firing a request that 401s.
 */
export function useNotificationSummary(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: notificationKeys.summary(),
    queryFn: api.fetchNotificationSummary,
    staleTime: LIST_STALE_MS,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Marks selected notifications read.
 *
 * Optimistic: the rows grey out immediately. Read-state is low-stakes and
 * reversible, and a spinner on a checkbox action feels broken — but the
 * previous cache is snapshotted so a failure restores exactly what was there
 * rather than guessing.
 */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => api.markNotificationsRead(ids),

    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.lists() });
      const previous = queryClient.getQueriesData({
        queryKey: notificationKeys.lists(),
      });

      const idSet = new Set(ids);
      queryClient.setQueriesData<{ data: unknown[]; meta: unknown }>(
        { queryKey: notificationKeys.lists() },
        (old: any) => {
          if (!old?.data) return old;
          let flipped = 0;
          const data = old.data.map((row: any) => {
            if (idSet.has(row.id) && !row.isRead) {
              flipped++;
              return { ...row, isRead: true };
            }
            return row;
          });
          // Keep the badge consistent with the rows in the same tick, or the
          // count visibly lags the list it describes.
          const meta = old.meta
            ? { ...old.meta, unreadTotal: Math.max(0, old.meta.unreadTotal - flipped) }
            : old.meta;
          return { ...old, data, meta };
        }
      );

      return { previous };
    },

    onError: (_err, _ids, context) => {
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
      toast.error("Could not mark notifications as read");
    },

    // Always resync: the optimistic count is an estimate (some ids may have
    // been read already, or not visible), and the server's number is truth.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/** Marks every unread notification read. */
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.markAllNotificationsRead,
    onSuccess: () => {
      toast.success("All notifications marked as read");
    },
    onError: () => {
      toast.error("Could not mark all notifications as read");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}
