// =============================================================================
// NOTIFICATION TAXONOMY
//
// Category and severity are DERIVED from `Notification.type`, never stored.
//
// WHY DERIVED RATHER THAN TWO NEW COLUMNS
// ---------------------------------------
// `notifications.type` is already written by 18 call sites across the inventory,
// workforce and sales alert services. Adding `category` and `severity` columns
// would mean a migration, a backfill for every historical row, and touching
// every writer — and any writer that forgot to set them would silently produce
// uncategorised notifications.
//
// Deriving instead means:
//   • every existing row is categorised the moment this file ships;
//   • the event writers keep working untouched (the brief's "reuse the existing
//     event writers without changing business logic");
//   • a new alert type is one entry here, not a schema change.
//
// This mirrors how Audit Logs derives severity from `action` — same problem,
// same answer, and the same trade-off: filtering by category becomes a `type IN
// (...)` over an indexed column rather than a column comparison.
// =============================================================================

/** The buckets the UI groups by. */
export const NOTIFICATION_CATEGORIES = [
  "INVENTORY",
  "SALES",
  "EMPLOYEES",
  "SECURITY",
  "SYSTEM",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Ordered least → most urgent. `severityRank` depends on this order. */
export const NOTIFICATION_SEVERITIES = [
  "INFO",
  "SUCCESS",
  "WARNING",
  "CRITICAL",
] as const;

export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

interface TypeMeta {
  category: NotificationCategory;
  severity: NotificationSeverity;
  /** Human label for the UI; falls back to a prettified type when unmapped. */
  label: string;
}

/**
 * Every type currently dispatched anywhere in the server.
 *
 * Sources (grep `NotificationEngine.dispatch`):
 *   • services/inventoryAlerts.service.ts  — 8 types
 *   • services/workforceAlerts.service.ts  — 8 types
 *   • events/subscribers/notification.subscriber.ts — LOW_STOCK, LARGE_SALE
 *   • services/workforce.service.ts        — PASSWORD_RESET
 *
 * Adding an alert type? Add it here in the same change, or it lands in the
 * SYSTEM/INFO fallback and cannot be filtered for.
 */
export const NOTIFICATION_TYPE_META: Record<string, TypeMeta> = {
  // ── Inventory ────────────────────────────────────────────────────────────
  LOW_STOCK: { category: "INVENTORY", severity: "WARNING", label: "Low stock" },
  OUT_OF_STOCK: { category: "INVENTORY", severity: "CRITICAL", label: "Out of stock" },
  NEGATIVE_STOCK: { category: "INVENTORY", severity: "CRITICAL", label: "Negative stock" },
  ADJUSTMENT_REQUESTED: { category: "INVENTORY", severity: "INFO", label: "Adjustment requested" },
  LARGE_ADJUSTMENT: { category: "INVENTORY", severity: "WARNING", label: "Large adjustment" },
  DAMAGED_INVENTORY: { category: "INVENTORY", severity: "WARNING", label: "Damaged inventory" },
  CYCLE_COUNT_COMPLETED: { category: "INVENTORY", severity: "SUCCESS", label: "Cycle count completed" },
  PURCHASE_RECEIVED: { category: "INVENTORY", severity: "SUCCESS", label: "Purchase received" },
  INVENTORY_EDITED: { category: "INVENTORY", severity: "WARNING", label: "Inventory edited" },

  // ── Sales ────────────────────────────────────────────────────────────────
  LARGE_SALE: { category: "SALES", severity: "SUCCESS", label: "High-value sale" },
  HIGH_REFUND_RATE: { category: "SALES", severity: "WARNING", label: "High refund rate" },
  LARGE_DISCOUNT: { category: "SALES", severity: "WARNING", label: "Large discount" },

  // ── Employees ────────────────────────────────────────────────────────────
  ATTENDANCE_LATE: { category: "EMPLOYEES", severity: "WARNING", label: "Late arrival" },
  ATTENDANCE_ABSENT: { category: "EMPLOYEES", severity: "WARNING", label: "Absent" },
  EMPLOYEE_IDLE: { category: "EMPLOYEES", severity: "INFO", label: "Idle employee" },
  TOP_PERFORMER: { category: "EMPLOYEES", severity: "SUCCESS", label: "Top performer" },

  // ── Security ─────────────────────────────────────────────────────────────
  FAILED_LOGIN_ATTEMPTS: { category: "SECURITY", severity: "CRITICAL", label: "Failed login attempts" },
  PASSWORD_RESET: { category: "SECURITY", severity: "WARNING", label: "Password reset" },
};

/**
 * Unmapped types land here rather than being dropped.
 *
 * A notification whose type nobody registered is still a real event someone
 * needs to see — hiding it would be worse than filing it under System.
 */
const FALLBACK: TypeMeta = {
  category: "SYSTEM",
  severity: "INFO",
  label: "System",
};

export function metaForType(type: string): TypeMeta {
  return NOTIFICATION_TYPE_META[type] ?? { ...FALLBACK, label: prettify(type) };
}

export function categoryForType(type: string): NotificationCategory {
  return metaForType(type).category;
}

export function severityForType(type: string): NotificationSeverity {
  return metaForType(type).severity;
}

/**
 * The type strings belonging to a category.
 *
 * This is what makes category filtering an indexed `type IN (...)` instead of a
 * scan: the category never reaches SQL, only the types it expands to.
 *
 * SYSTEM is special — it is the fallback bucket, so it means "every type that
 * is not explicitly mapped elsewhere". That cannot be expressed as an IN list,
 * so the caller must translate it to `NOT IN (all mapped types)`; see
 * `typeFilterForCategories`.
 */
export function typesForCategory(category: NotificationCategory): string[] {
  return Object.entries(NOTIFICATION_TYPE_META)
    .filter(([, meta]) => meta.category === category)
    .map(([type]) => type);
}

/** Every type that has an explicit mapping — the complement defines SYSTEM. */
export function allMappedTypes(): string[] {
  return Object.keys(NOTIFICATION_TYPE_META);
}

/**
 * Builds the Prisma `type` filter for a set of categories.
 *
 * Returns `null` when no filter is needed (empty selection = everything).
 *
 * The SYSTEM asymmetry is the whole reason this helper exists: selecting
 * INVENTORY yields `{ in: [...] }`, but selecting SYSTEM yields
 * `{ notIn: [...] }`, and selecting both has to be an OR of the two rather than
 * a single list.
 */
export function typeFilterForCategories(
  categories: NotificationCategory[]
): { in: string[] } | { notIn: string[] } | { OR: unknown[] } | null {
  if (categories.length === 0) return null;

  const wantsSystem = categories.includes("SYSTEM");
  const explicit = categories.filter((c) => c !== "SYSTEM");
  const explicitTypes = explicit.flatMap(typesForCategory);

  if (!wantsSystem) return { in: explicitTypes };
  if (explicit.length === 0) return { notIn: allMappedTypes() };

  // Both: mapped types from the chosen categories, OR anything unmapped.
  return {
    OR: [{ type: { in: explicitTypes } }, { type: { notIn: allMappedTypes() } }],
  };
}

/** Severity ordering for sorting. Higher = more urgent. */
export function severityRank(severity: NotificationSeverity): number {
  return NOTIFICATION_SEVERITIES.indexOf(severity);
}

/** `LOW_STOCK` → `Low stock`. Only used for types with no registered label. */
function prettify(type: string): string {
  const spaced = type.replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
