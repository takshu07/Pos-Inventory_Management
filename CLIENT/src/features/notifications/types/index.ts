/**
 * Notifications — shared type contract.
 *
 * Mirrors the server's `notificationFeed.service.ts` and
 * `constants/notificationTaxonomy.ts`. The server is the source of truth; if
 * the two drift the request 400s on the enum rather than silently ignoring a
 * filter.
 *
 * ⚠ `category` and `severity` are DERIVED server-side from `type` — there are
 * no such columns. That is why the client never sends a category to a write
 * endpoint and never tries to compute one itself: one derivation, on one side.
 */

export const NOTIFICATION_CATEGORIES = [
  "INVENTORY",
  "SALES",
  "EMPLOYEES",
  "SECURITY",
  "SYSTEM",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Ordered least → most urgent, matching the server's rank. */
export const NOTIFICATION_SEVERITIES = [
  "INFO",
  "SUCCESS",
  "WARNING",
  "CRITICAL",
] as const;

export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export interface NotificationItem {
  id: string;
  type: string;
  /** "Low stock", not "LOW_STOCK". Server-supplied so labels stay in one place. */
  typeLabel: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  message: string;
  isRead: boolean;
  referenceId: string | null;
  referenceType: string | null;
  createdAt: string;
}

export interface NotificationListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  /**
   * Unread count across EVERYTHING, not just the current filter — it drives the
   * badge, which answers "how many unread do I have", not "how many unread
   * match what I am looking at".
   */
  unreadTotal: number;
}

export interface NotificationListResult {
  data: NotificationItem[];
  meta: NotificationListMeta;
}

export interface NotificationListParams {
  page?: number;
  limit?: number;
  /** Tri-state: omitted = both, true = read only, false = unread only. */
  isRead?: boolean;
  category?: NotificationCategory[];
  severity?: NotificationSeverity[];
  search?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: "createdAt" | "severity";
  sortOrder?: "asc" | "desc";
}

export interface NotificationSummary {
  total: number;
  unreadTotal: number;
  byCategory: Array<{
    category: NotificationCategory;
    total: number;
    unread: number;
  }>;
  bySeverity: Array<{
    severity: NotificationSeverity;
    total: number;
    unread: number;
  }>;
}
