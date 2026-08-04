/**
 * Notifications — transport layer.
 *
 * ⚠ ENVELOPE SHAPE. The axios interceptor already returns `response.data`, so
 * what arrives here is the server's `{ success, data, meta }` envelope — rows
 * at `res.data`, pagination at `res.meta`. Reading the wrong level does not
 * throw, it silently yields an empty list, which is why it is stated here and
 * pinned by a test.
 *
 * ⚠ ENDPOINTS. The screen reads `/notifications/feed`, NOT `/notifications`.
 * The bare path is the pre-existing unread-only, unpaginated endpoint that
 * backs the Navbar bell and the dashboard; pointing the screen at it would
 * silently drop every read notification and ignore paging. Both are kept, and
 * the routing is pinned by `__tests__/notificationsApi.test.ts` — the settings
 * module shipped a base path the server never mounted precisely because
 * nothing asserted its URLs.
 */

import { apiClient } from "@/lib/api";
import type { ApiEnvelope } from "@/lib/api";
import type {
  NotificationItem,
  NotificationListMeta,
  NotificationListParams,
  NotificationListResult,
  NotificationSummary,
} from "../types";

const BASE = "/notifications";

/**
 * Serialises params for the query string.
 *
 * Arrays are comma-joined (the server accepts both that and repeats, and a
 * comma list keeps the React Query key stable). Empty values are dropped
 * entirely — sending `?category=` would fail the server's enum rather than
 * read as "no filter".
 *
 * `isRead` is special: `false` is a MEANINGFUL value ("unread only"), so it
 * must survive a falsy check that would otherwise drop it.
 */
export function toQuery(
  params: NotificationListParams
): Record<string, string | number> {
  const out: Record<string, string | number> = {};

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;

    if (Array.isArray(value)) {
      if (value.length > 0) out[key] = value.join(",");
      continue;
    }

    if (typeof value === "boolean") {
      out[key] = String(value);
      continue;
    }

    out[key] = value as string | number;
  }

  return out;
}

export async function fetchNotifications(
  params: NotificationListParams
): Promise<NotificationListResult> {
  const res = (await apiClient.get(`${BASE}/feed`, {
    params: toQuery(params),
  })) as unknown as ApiEnvelope<NotificationItem[], NotificationListMeta>;

  return {
    data: res.data ?? [],
    meta: res.meta as NotificationListMeta,
  };
}

export async function fetchNotificationSummary(): Promise<NotificationSummary> {
  const res = (await apiClient.get(
    `${BASE}/summary`
  )) as unknown as ApiEnvelope<NotificationSummary>;
  return res.data;
}

/** Bulk mark-as-read. Returns how many rows actually changed. */
export async function markNotificationsRead(
  ids: string[]
): Promise<{ updated: number }> {
  const res = (await apiClient.post(`${BASE}/read`, {
    ids,
  })) as unknown as ApiEnvelope<{ updated: number }>;
  return res.data;
}

/** Marks every unread notification for this user read. */
export async function markAllNotificationsRead(): Promise<void> {
  await apiClient.post(`${BASE}/read-all`);
}
