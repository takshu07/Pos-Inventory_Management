// =============================================================================
// DISCOUNT RULE VALIDATION
//
// Catalog discount rules (the shelf-price layer). Cart-level promotions are a
// different subsystem entirely — see the Promotion model.
//
// ── Timezone handling ────────────────────────────────────────────────────────
// The owner thinks in STORE time: "this sale ends 31 Dec" means 23:59:59 in
// Asia/Kolkata, not UTC. Storing that naively as UTC midnight would expire the
// sale at 05:30 on the 31st — mid-afternoon, five and a half hours early.
//
// So: dates are converted to UTC instants HERE, at the boundary, using
// Settings.timeZone. A date-only string is widened to cover the whole local day
// (start → 00:00:00.000 local, end → 23:59:59.999 local). The engine then
// compares UTC instants only and never does timezone maths.
// =============================================================================

import { z } from "zod";

import { ConfigurationEngine } from "../engines/configuration.engine";

// ── Timezone-aware date coercion ─────────────────────────────────────────────

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Offset (in minutes) of `timeZone` from UTC at the given instant. Uses the
 * Intl database, so DST is handled correctly for any zone the store picks.
 */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(instant).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  ) as Record<string, string>;

  // `hour` can come back as "24" for midnight in some environments.
  const hour = parts["hour"] === "24" ? 0 : Number(parts["hour"]);
  const asUTC = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    hour,
    Number(parts["minute"]),
    Number(parts["second"])
  );

  // Intl only formats down to whole seconds, so `asUTC` has lost the instant's
  // milliseconds. Comparing it directly against instant.getTime() would report
  // an offset that is wrong by up to 999ms (and the two-pass application below
  // would double that error). Zone offsets are always whole minutes, so strip
  // the sub-minute noise by rounding.
  return Math.round((asUTC - instant.getTime()) / 60_000);
}

/**
 * Interpret a wall-clock time as being in `timeZone` and return the UTC instant.
 * Applied twice to settle zones whose offset changes across the boundary (DST).
 */
function zonedWallClockToUtc(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  ss: number,
  ms: number,
  timeZone: string
): Date {
  const naive = Date.UTC(y, m - 1, d, hh, mm, ss, ms);
  let guess = new Date(naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000);
  guess = new Date(naive - zoneOffsetMinutes(guess, timeZone) * 60_000);
  return guess;
}

/**
 * Parse an owner-supplied date into a UTC instant.
 *
 * `boundary` decides how a bare date (no time component) is widened:
 *   "start" → 00:00:00.000 store-local
 *   "end"   → 23:59:59.999 store-local, so "ends 31 Dec" includes all of the 31st
 *
 * Values that already carry a time/zone are passed through untouched.
 */
function toStoreZonedInstant(value: string, boundary: "start" | "end"): Date {
  const timeZone = ConfigurationEngine.getTimeZone();

  if (DATE_ONLY.test(value)) {
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    return boundary === "start"
      ? zonedWallClockToUtc(y, m, d, 0, 0, 0, 0, timeZone)
      : zonedWallClockToUtc(y, m, d, 23, 59, 59, 999, timeZone);
  }

  return new Date(value);
}

const startDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(DATE_ONLY))
  .transform((v) => toStoreZonedInstant(v, "start"))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid start date.");

const endDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(DATE_ONLY))
  .transform((v) => toStoreZonedInstant(v, "end"))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid end date.");

// ── Shared field schemas ─────────────────────────────────────────────────────

// PERCENTAGE and FLAT only. BOGO/BUNDLE/TIERED exist in the database enum so
// they can be added without a migration, but the engine cannot evaluate them,
// so the API must not accept them yet.
const ruleType = z.enum(["PERCENTAGE", "FLAT"]);
const ruleScope = z.enum(["PRODUCT", "CATEGORY"]); // BRAND: schema-ready, not live

const baseFields = {
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  description: z.string().trim().max(500).optional().nullable(),
  type: ruleType,
  value: z.number().min(0, "Discount cannot be negative"),
  priority: z.number().int().min(0).max(1000).default(0),
  startDate: startDate.optional().nullable(),
  endDate: endDate.optional().nullable(),
  isEnabled: z.boolean().default(true),
};

/** Percentages cap at 100; flat amounts are unbounded (clamped to MRP at price time). */
const percentageCap = <T extends { type: "PERCENTAGE" | "FLAT"; value: number }>(d: T) =>
  d.type !== "PERCENTAGE" || d.value <= 100;

/**
 * An end date may not precede its start date.
 * The `| undefined` in the constraint is required under
 * `exactOptionalPropertyTypes`, which distinguishes "absent" from "undefined".
 */
const dateOrder = <T extends { startDate?: Date | null | undefined; endDate?: Date | null | undefined }>(
  d: T
) => !d.startDate || !d.endDate || d.endDate.getTime() >= d.startDate.getTime();

export const discountRuleValidation = {
  // POST /owner/discounts/product
  createProduct: z
    .object({ ...baseFields, productId: z.string().cuid() })
    .refine(percentageCap, { message: "A percentage discount cannot exceed 100%.", path: ["value"] })
    .refine(dateOrder, { message: "End date must be on or after the start date.", path: ["endDate"] }),

  // POST /owner/discounts/category
  createCategory: z
    .object({ ...baseFields, categoryId: z.string().cuid() })
    .refine(percentageCap, { message: "A percentage discount cannot exceed 100%.", path: ["value"] })
    .refine(dateOrder, { message: "End date must be on or after the start date.", path: ["endDate"] }),

  // PATCH /owner/discounts/:id — scope and target are immutable; delete and
  // recreate to retarget a rule (keeps the history trail honest).
  update: z
    .object({
      name: baseFields.name.optional(),
      description: baseFields.description,
      type: ruleType.optional(),
      value: z.number().min(0).optional(),
      priority: z.number().int().min(0).max(1000).optional(),
      startDate: startDate.optional().nullable(),
      endDate: endDate.optional().nullable(),
      isEnabled: z.boolean().optional(),
    })
    .refine((d) => Object.keys(d).length > 0, "No fields to update.")
    .refine((d) => d.type !== "PERCENTAGE" || (d.value ?? 0) <= 100, {
      message: "A percentage discount cannot exceed 100%.",
      path: ["value"],
    })
    .refine(dateOrder, { message: "End date must be on or after the start date.", path: ["endDate"] }),

  // GET /owner/discounts
  listQuery: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(120).optional(),
    scope: ruleScope.optional(),
    // Status is DERIVED, never stored — filtering happens in the service after
    // each rule's status is computed. See catalogPricing.engine#deriveStatus.
    status: z.enum(["DRAFT", "SCHEDULED", "ACTIVE", "EXPIRED", "DISABLED"]).optional(),
    productId: z.string().cuid().optional(),
    categoryId: z.string().cuid().optional(),
    sortBy: z.enum(["createdAt", "updatedAt", "name", "value", "priority", "startDate", "endDate"]).default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  }),

  // POST /owner/discounts/bulk — enable / disable / delete many at once.
  bulk: z.object({
    ids: z.array(z.string().cuid()).min(1, "Select at least one discount.").max(200),
    action: z.enum(["ENABLE", "DISABLE", "DELETE"]),
  }),

  // GET /owner/discounts/history
  historyQuery: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    ruleId: z.string().cuid().optional(),
  }),
} as const;

export type CreateProductDiscountInput = z.infer<typeof discountRuleValidation.createProduct>;
export type CreateCategoryDiscountInput = z.infer<typeof discountRuleValidation.createCategory>;
export type UpdateDiscountInput = z.infer<typeof discountRuleValidation.update>;
export type ListDiscountsQuery = z.infer<typeof discountRuleValidation.listQuery>;
export type BulkDiscountInput = z.infer<typeof discountRuleValidation.bulk>;
export type DiscountHistoryQuery = z.infer<typeof discountRuleValidation.historyQuery>;
