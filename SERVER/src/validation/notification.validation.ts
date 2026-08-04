// =============================================================================
// NOTIFICATION VALIDATION SCHEMAS
//
// Query strings are strings until coerced, so numbers and booleans are parsed
// here rather than defensively re-parsed downstream.
//
// The enums are load-bearing: `category` and `severity` are expanded into a
// `type IN (...)` filter and `sortBy`/`sortOrder` reach an ORDER BY, so
// enumerating accepted values is what stops a caller-supplied string from
// becoming part of a query. Anything outside the enum is a 400, not a silently
// ignored filter.
// =============================================================================

import { z } from "zod";

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SEVERITIES,
} from "../constants/notificationTaxonomy";

/**
 * Accepts `?category=INVENTORY,SALES` or a repeated `?category=` param.
 *
 * The comma form is what the client sends (it keeps URLs short and matches the
 * audit filters); the array form is what Express produces for repeats. Handling
 * both here means no caller has to know which shape it produced.
 */
function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((raw) => {
      if (raw === undefined) return undefined;
      const parts = (Array.isArray(raw) ? raw : raw.split(","))
        .flatMap((v) => String(v).split(","))
        .map((v) => v.trim())
        .filter(Boolean);
      return parts.length > 0 ? parts : undefined;
    })
    .superRefine((parts, ctx) => {
      if (!parts) return;
      for (const part of parts) {
        if (!(values as readonly string[]).includes(part)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid value "${part}". Expected one of: ${values.join(", ")}.`,
          });
        }
      }
    })
    .transform((parts) => parts as unknown as T[number][] | undefined);
}

/**
 * `limit` is capped at 100.
 *
 * The UI offers at most 50. The cap exists so an uncapped page size cannot be
 * used to pull the whole table in one request.
 */
export const notificationListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),

  /**
   * Tri-state on purpose.
   *
   * Absent = every notification. `true`/`false` = that read state only.
   * A plain boolean with a default could not express "both", which is the
   * view the screen opens on.
   */
  isRead: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),

  category: csvEnum(NOTIFICATION_CATEGORIES),
  severity: csvEnum(NOTIFICATION_SEVERITIES),

  /** Free-text over title and message. Trimmed; empty means no filter. */
  search: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined)),

  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),

  sortBy: z.enum(["createdAt", "severity"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type NotificationListQuery = z.infer<typeof notificationListQuery>;

/**
 * Bulk mark-as-read.
 *
 * Capped at 200 ids — the UI can only select one page (max 100), so anything
 * larger is not a real user action. Rejecting an empty array is deliberate: an
 * empty bulk request is a client bug, and silently succeeding would hide it.
 */
export const notificationBulkReadBody = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1, "Select at least one notification.")
    .max(200, "Cannot update more than 200 notifications at once."),
});

/** Counts for the unread badge and category chips. Same filters, no paging. */
export const notificationSummaryQuery = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export const notificationValidation = {
  listQuery: notificationListQuery,
  bulkReadBody: notificationBulkReadBody,
  summaryQuery: notificationSummaryQuery,
};
