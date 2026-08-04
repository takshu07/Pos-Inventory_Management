/**
 * Offline synchronization — transport layer.
 *
 * ⚠ ENVELOPE SHAPE. The axios interceptor already unwraps to `response.data`,
 * so what arrives here is the server's `{ success, data }` envelope and the
 * payload is at `res.data`. Reading the wrong level yields `undefined` rather
 * than throwing, which is why every call below is explicit about it and the
 * URLs are pinned by a test.
 *
 * ⚠ These endpoints are served by the node the client is TALKING TO. On an edge
 * node they report that node's own queue; on a cloud node they answer with a
 * degenerate "cloud, nothing pending" status so one client build works against
 * both without branching.
 */

import { apiClient } from "@/lib/api";
import type { ApiEnvelope } from "@/lib/api";

import type {
  SyncConflict,
  SyncHealthReport,
  SyncQueueItem,
  SyncRunResult,
  SyncRunSummary,
  SyncStatus,
} from "../types";

const BASE = "/sync";

export const syncApi = {
  /** The indicator's data source. Cheap enough to poll. */
  async getStatus(): Promise<SyncStatus> {
    const res = await apiClient.get<ApiEnvelope<SyncStatus>>(`${BASE}/status`);
    return res.data;
  },

  /**
   * The "Sync Now" button.
   *
   * Defaults to FULL, which uploads before downloading — the un-uploaded sales
   * are the only copy of that data anywhere, so they go first.
   */
  async run(direction: "UPLOAD" | "DOWNLOAD" | "FULL" = "FULL"): Promise<SyncRunResult> {
    const res = await apiClient.post<ApiEnvelope<SyncRunResult>>(`${BASE}/run`, {
      direction,
    });
    return res.data;
  },

  async retry(ids?: number[]): Promise<{ requeued: number }> {
    const res = await apiClient.post<ApiEnvelope<{ requeued: number }>>(
      `${BASE}/retry`,
      ids === undefined ? {} : { ids }
    );
    return res.data;
  },

  async getHistory(limit = 50): Promise<SyncRunSummary[]> {
    const res = await apiClient.get<ApiEnvelope<SyncRunSummary[]>>(`${BASE}/history`, {
      params: { limit },
    });
    return res.data;
  },

  async getQueue(params: { status?: string; limit?: number } = {}): Promise<{
    items: SyncQueueItem[];
    total: number;
  }> {
    const res = await apiClient.get<
      ApiEnvelope<SyncQueueItem[]> & { meta?: { total: number } }
    >(`${BASE}/queue`, { params });

    return { items: res.data, total: res.meta?.total ?? res.data.length };
  },

  async getConflicts(limit = 50): Promise<SyncConflict[]> {
    const res = await apiClient.get<ApiEnvelope<SyncConflict[]>>(`${BASE}/conflicts`, {
      params: { limit },
    });
    return res.data;
  },

  /**
   * The integrity self-check.
   *
   * ⚠ Returns HTTP 503 when unhealthy, so the axios error interceptor will
   * reject. Callers that want to DISPLAY an unhealthy report must catch it —
   * see `useSyncHealth`.
   */
  async getHealth(): Promise<SyncHealthReport> {
    const res = await apiClient.get<ApiEnvelope<SyncHealthReport>>(`${BASE}/health`);
    return res.data;
  },

  /** Forces an immediate connectivity probe rather than waiting for the tick. */
  async probe(): Promise<{ state: string }> {
    const res = await apiClient.post<ApiEnvelope<{ state: string }>>(`${BASE}/probe`);
    return res.data;
  },
};
