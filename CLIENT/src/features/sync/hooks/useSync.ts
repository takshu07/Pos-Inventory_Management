/**
 * Offline synchronization — React Query hooks.
 *
 * ── Why this one DOES poll, when the rest of the client deliberately does not ─
 * Everywhere else in this client, background polling was judged not worth the
 * cost. Here it is, and the reason is specific: the sync indicator is the only
 * thing telling a cashier whether the last hour of sales exists anywhere other
 * than under the counter. A stale indicator does not merely look wrong, it
 * actively misleads — a green tick that has not refreshed since the router died
 * is worse than no indicator at all.
 *
 * The poll is cheap (one indexed GROUP BY against a local SQLite file, no
 * network) and slows down when nobody is looking at the tab.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { syncApi } from "../api/syncApi";
import type { SyncHealth, SyncStatus } from "../types";

// =============================================================================
// QUERY KEYS
// =============================================================================

export const syncKeys = {
  all: ["sync"] as const,
  status: () => [...syncKeys.all, "status"] as const,
  history: (limit: number) => [...syncKeys.all, "history", limit] as const,
  queue: (params: unknown) => [...syncKeys.all, "queue", params] as const,
  conflicts: (limit: number) => [...syncKeys.all, "conflicts", limit] as const,
  health: () => [...syncKeys.all, "health"] as const,
};

/** Frequent enough that the indicator is never meaningfully behind. */
const STATUS_POLL_MS = 10_000;

// =============================================================================
// STATUS
// =============================================================================

export function useSyncStatus(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: syncKeys.status(),
    queryFn: () => syncApi.getStatus(),
    enabled: options.enabled ?? true,
    refetchInterval: STATUS_POLL_MS,
    // Stops the poll in a background tab. A till often has several windows
    // open; polling from all of them adds nothing.
    refetchIntervalInBackground: false,
    // A failed status read is itself informative (the local server is down),
    // so the last known value is kept on screen rather than blanked.
    placeholderData: (prev) => prev,
    // The indicator must degrade to "unknown", not to a thrown boundary.
    retry: 1,
  });
}

// =============================================================================
// DERIVED HEALTH
// =============================================================================

/**
 * How long queued work may sit before it stops being "normal offline
 * operation" and starts being a problem someone must act on.
 *
 * Four hours, not twenty-four: the design target is surviving one business day
 * offline, and half a trading day of un-backed-up sales is the point at which
 * an owner would want to have been told, rather than the point at which it is
 * already too late.
 */
const STALE_QUEUE_SECONDS = 4 * 60 * 60;

/**
 * Reduces the full status to the one thing a cashier needs.
 *
 * Ordered by severity, most severe first — the checks are NOT independent and
 * the order is the point:
 *
 *   BROKEN    Capture is off. The till is still selling and no longer recording
 *             anything that survives. Beats every other signal, including a
 *             perfectly healthy network.
 *   DEGRADED  Something needs a human: items gave up retrying, or work has been
 *             queued so long that sync is evidently not happening.
 *   OFFLINE   No connection. Normal, expected, not an error — the whole feature
 *             exists for this state.
 *   PENDING   Online with work still to send. Transient.
 *   SYNCED    Nothing outstanding.
 */
export function deriveSyncHealth(status: SyncStatus | undefined): SyncHealth {
  if (status === undefined) return "OFFLINE";

  if (!status.captureHealthy) return "BROKEN";

  if (status.queue.failed > 0 || status.queue.conflicted > 0) return "DEGRADED";

  const age = status.queue.oldestPendingAgeSeconds;
  if (age !== null && age > STALE_QUEUE_SECONDS) return "DEGRADED";

  if (status.connectivity.state !== "online") return "OFFLINE";

  if (status.queue.pending > 0 || status.queue.inFlight > 0) return "PENDING";

  return "SYNCED";
}

export function useSyncHealthState() {
  const query = useSyncStatus();
  return { ...query, health: deriveSyncHealth(query.data) };
}

// =============================================================================
// LISTS
// =============================================================================

export function useSyncHistory(limit = 50) {
  return useQuery({
    queryKey: syncKeys.history(limit),
    queryFn: () => syncApi.getHistory(limit),
    staleTime: 15_000,
  });
}

export function useSyncQueue(params: { status?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: syncKeys.queue(params),
    queryFn: () => syncApi.getQueue(params),
    staleTime: 15_000,
  });
}

export function useSyncConflicts(limit = 50) {
  return useQuery({
    queryKey: syncKeys.conflicts(limit),
    queryFn: () => syncApi.getConflicts(limit),
    staleTime: 30_000,
  });
}

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * "Sync Now".
 *
 * A SKIPPED result is NOT a failure — it means "already running" or "no
 * connection", and both are shown as information. Reporting them as errors
 * would train the operator to ignore the toast that eventually matters.
 */
export function useRunSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (direction: "UPLOAD" | "DOWNLOAD" | "FULL" = "FULL") =>
      syncApi.run(direction),

    onSuccess: (result) => {
      if (result.status === "SKIPPED") {
        toast.info(result.skippedBecause ?? "Sync skipped");
      } else if (result.status === "SUCCESS") {
        toast.success("Synchronization complete");
      } else if (result.status === "PARTIAL") {
        toast.warning("Synchronization finished with some items outstanding");
      } else {
        toast.error("Synchronization failed. The queue is intact and will retry.");
      }

      // A run changes the queue, the history and the conflict list at once.
      void queryClient.invalidateQueries({ queryKey: syncKeys.all });
    },

    onError: () => {
      // Deliberately reassuring: a failed sync never loses data — that is the
      // guarantee the queue exists to provide, and the operator should not be
      // left wondering whether to write the sales down on paper.
      toast.error("Could not reach the server. Nothing was lost; it will retry.");
    },
  });
}

export function useRetryFailedSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids?: number[]) => syncApi.retry(ids),

    onSuccess: (result) => {
      toast.success(
        result.requeued === 0
          ? "Nothing to retry"
          : `${result.requeued} item${result.requeued === 1 ? "" : "s"} requeued`
      );
      void queryClient.invalidateQueries({ queryKey: syncKeys.all });
    },

    onError: () => {
      toast.error("Could not requeue those items");
    },
  });
}
