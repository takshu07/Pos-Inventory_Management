/**
 * Notifications — public surface.
 *
 * The screen every authenticated employee can reach at `/notifications`.
 *
 * ⚠ TWO ENDPOINT FAMILIES, ON PURPOSE:
 *   • `/notifications`        — unread-only, unpaginated. Pre-existing; backs
 *                               the Navbar bell and the dashboard. Untouched.
 *   • `/notifications/feed`   — paginated, filtered, searchable. This module.
 * Pointing the screen at the bare path would silently drop every read
 * notification and ignore paging. The routing is pinned by a test.
 *
 * ⚠ CATEGORY AND SEVERITY ARE DERIVED SERVER-SIDE from `Notification.type`
 * (SERVER/src/constants/notificationTaxonomy.ts). There are no such columns.
 * Adding a new alert type means adding it to that taxonomy in the same change,
 * or it lands in the SYSTEM/INFO fallback bucket and cannot be filtered for.
 * Do NOT re-derive categories on the client — one derivation, on one side.
 */

export { default as NotificationsPage } from "./pages/NotificationsPage";

export {
  notificationKeys,
  useMarkAllNotificationsRead,
  useMarkNotificationsRead,
  useNotificationSummary,
  useNotifications,
} from "./hooks/useNotifications";

export type {
  NotificationCategory,
  NotificationItem,
  NotificationListParams,
  NotificationListResult,
  NotificationSeverity,
  NotificationSummary,
} from "./types";

export {
  categoryLabel,
  formatNotificationTime,
  severityLabel,
  severityVariant,
} from "./utils/format";
