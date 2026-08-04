/**
 * Notifications — presentation helpers.
 *
 * Pure functions only, so they are testable without React. The rule they all
 * follow: a missing or unexpected value renders as something honest, never as
 * a crash and never as a confident-looking wrong value.
 */

import type { NotificationCategory, NotificationSeverity } from "../types";

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "outline";

/**
 * Severity → badge variant.
 *
 * CRITICAL and WARNING must stay visually distinct: they are the two that
 * demand action, and collapsing them into one colour is how an out-of-stock
 * alert reads as routine.
 */
export function severityVariant(severity: NotificationSeverity): BadgeVariant {
  switch (severity) {
    case "CRITICAL":
      return "error";
    case "WARNING":
      return "warning";
    case "SUCCESS":
      return "success";
    case "INFO":
    default:
      return "info";
  }
}

/** Human label for a severity. */
export function severityLabel(severity: NotificationSeverity): string {
  switch (severity) {
    case "CRITICAL":
      return "Critical";
    case "WARNING":
      return "Warning";
    case "SUCCESS":
      return "Success";
    case "INFO":
    default:
      return "Info";
  }
}

/** Human label for a category. */
export function categoryLabel(category: NotificationCategory): string {
  switch (category) {
    case "INVENTORY":
      return "Inventory";
    case "SALES":
      return "Sales";
    case "EMPLOYEES":
      return "Employees";
    case "SECURITY":
      return "Security";
    case "SYSTEM":
    default:
      return "System";
  }
}

/**
 * Relative time for a notification's timestamp.
 *
 * Returns "—" rather than "Invalid Date" for a missing or unparseable value:
 * a dash reads as "not recorded", which is true, where "Invalid Date" reads as
 * a bug in the row itself.
 */
export function formatNotificationTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  // "just now" beats "3s ago" for something that arrived while you were looking
  // at it, and avoids a counter that visibly ticks on every render.
  if (seconds < 45) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  // Past a week, a date is more useful than "31d ago".
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

/**
 * Absolute timestamp for the row's `title` attribute.
 *
 * The relative label is scannable; the tooltip is what someone reads when they
 * need to know exactly when something happened.
 */
export function formatNotificationTimestamp(
  iso: string | null | undefined
): string {
  if (!iso) return "Time not recorded";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Time not recorded";
  return date.toLocaleString();
}

/**
 * Summarises the current selection for the bulk action bar.
 *
 * Pluralisation is handled here rather than inline so "1 notifications" cannot
 * reach the screen.
 */
export function selectionLabel(count: number): string {
  if (count <= 0) return "None selected";
  return `${count} selected`;
}

/** Pluralises the unread badge, capping the display at 99+. */
export function unreadBadgeLabel(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}
