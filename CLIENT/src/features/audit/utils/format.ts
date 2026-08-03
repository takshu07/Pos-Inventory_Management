/**
 * Audit Logs — presentation helpers.
 *
 * Pure functions only, so the rules that decide how an entry READS are
 * unit-testable without mounting anything. The severity→variant map in
 * particular is a correctness concern, not a styling one: if CRITICAL ever
 * renders in the same colour as LOW, the screen stops doing its job.
 */

import type { BadgeProps } from "@/components/ui";
import type { AuditFieldChange, AuditSeverity } from "../types";

// =============================================================================
// SEVERITY
// =============================================================================

/**
 * Severity → Badge variant.
 *
 * The scale must stay visually monotonic: destructive → warning → info →
 * secondary. Two adjacent levels sharing a variant would make the badge
 * decorative rather than informative.
 */
const SEVERITY_VARIANTS: Record<AuditSeverity, BadgeProps["variant"]> = {
  CRITICAL: "destructive",
  HIGH: "warning",
  MEDIUM: "info",
  LOW: "secondary",
};

export function severityVariant(severity: AuditSeverity): BadgeProps["variant"] {
  return SEVERITY_VARIANTS[severity] ?? "secondary";
}

/**
 * Left border accent for a table row, so severity is legible while scanning a
 * dense list without reading each badge. Transparent for LOW — accenting
 * everything accents nothing.
 */
const SEVERITY_ACCENTS: Record<AuditSeverity, string> = {
  CRITICAL: "border-l-2 border-l-destructive",
  HIGH: "border-l-2 border-l-amber-500",
  MEDIUM: "border-l-2 border-l-transparent",
  LOW: "border-l-2 border-l-transparent",
};

export function severityAccent(severity: AuditSeverity): string {
  return SEVERITY_ACCENTS[severity] ?? "";
}

export function severityLabel(severity: AuditSeverity): string {
  return severity.charAt(0) + severity.slice(1).toLowerCase();
}

// =============================================================================
// TIME
// =============================================================================

/**
 * Absolute timestamp, to the second.
 *
 * An audit trail shows exact times, not "3 hours ago" — the whole point is
 * being able to line an entry up against something else that happened. The
 * relative form is offered separately as a secondary hint.
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Compact form for dense table rows. */
export function formatTimestampShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** "2 hours ago" — a hint beside the absolute time, never instead of it. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  return `${Math.floor(months / 12)}y ago`;
}

// =============================================================================
// VALUES
// =============================================================================

/**
 * Renders a snapshot value for the diff.
 *
 * The distinctions here are the ones that make a diff trustworthy:
 *   • `null` and `undefined` must be VISIBLY different from an empty string,
 *     because "cleared the field" and "set it to blank" are different events.
 *   • `false` must never render as empty — a falsy value is still a value, and
 *     showing nothing would make deactivating something look like a no-op.
 *   • Objects are pretty-printed rather than shown as [object Object].
 */
export function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value === "" ? '""' : value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Whether a value needs a block (pre) rather than an inline rendering. */
export function isComplexValue(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

/**
 * snake_case / camelCase field name → readable label.
 * "sellingPrice" → "Selling Price", "is_active" → "Is Active".
 */
export function formatFieldName(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    // Every word, not just the first: "is_active" must read "Is Active", not
    // "Is active" — the second looks like a typo in a column header.
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/**
 * One-line summary of what an entry changed, for the table's Changes column.
 *
 * Names the fields when there are few enough to be useful, and counts them
 * otherwise — "12 fields changed" is more informative than a truncated list
 * that hides the one the reader cares about.
 */
export function summariseChanges(changes: AuditFieldChange[]): string {
  if (changes.length === 0) return "No field changes";

  const names = changes.map((c) => formatFieldName(c.field));
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
}

/**
 * Truncates an id for display while keeping it recognisable.
 * cuids share a prefix, so the TAIL is what distinguishes them.
 */
export function shortId(id: string, keep = 8): string {
  if (id.length <= keep + 1) return id;
  return `…${id.slice(-keep)}`;
}

/** "10,000+" when the server capped the count. See the API's `totalIsExact`. */
export function formatTotal(total: number, isExact: boolean): string {
  return isExact ? total.toLocaleString() : `${total.toLocaleString()}+`;
}
