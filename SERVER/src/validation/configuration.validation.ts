import { z } from "zod";

/**
 * Optional free-text field.
 *
 * `z.string().optional()` alone rejects "", which is what an emptied form input
 * actually sends. Settings forms need a way to CLEAR a value, so "" is accepted
 * on the wire and normalised to `undefined` — the key then disappears from the
 * merged JSON rather than persisting as an empty string that every consumer has
 * to special-case. Without this, clearing the GST number is impossible through
 * the UI: the request 400s instead.
 */
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

/**
 * Optional URL/email that tolerates the emptied-input case the same way.
 *
 * The `.url()` / `.email()` check runs only when there is something to check,
 * so a cleared logo URL is a clear, not a validation error.
 */
const optionalUrl = optionalText.refine(
  (v) => v === undefined || z.string().url().safeParse(v).success,
  { message: "Must be a valid URL (including https://)" }
);

const optionalEmail = optionalText.refine(
  (v) => v === undefined || z.string().email().safeParse(v).success,
  { message: "Must be a valid email address" }
);

export const storeConfigSchema = z.object({
  logoUrl: optionalUrl,
  gstNumber: optionalText,
  address: optionalText,
  phone: optionalText,
  email: optionalEmail,
  website: optionalUrl,
  businessHours: optionalText,
  financialYearStart: z
    .string()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Must be MM-DD (e.g. 04-01)")
    .default("04-01"), // April 1st
  storeStatus: z.enum(["OPEN", "CLOSED", "MAINTENANCE"]).default("OPEN")
});

export const invoiceConfigSchema = z.object({
  invoicePrefix: z.string().min(1).default("INV"),
  exchangePrefix: z.string().min(1).default("EX"),
  purchasePrefix: z.string().min(1).default("PO"),
  receiptFooter: z.string().optional(),
  receiptHeader: z.string().optional(),
  invoiceNumberLength: z.number().int().min(4).max(10).default(6),
  financialYearReset: z.boolean().default(true),
  qrCodeEnabled: z.boolean().default(false),
  barcodeFormat: z.enum(["CODE128", "EAN13"]).default("CODE128")
});

export const pricingConfigSchema = z.object({
  decimalPrecision: z.number().int().min(0).max(4).default(2),
  taxInclusive: z.boolean().default(false),
  roundingStrategy: z.enum(["ROUND_HALF_UP", "ROUND_DOWN", "ROUND_UP"]).default("ROUND_HALF_UP"),
  maximumDiscountPercent: z.number().min(0).max(100).default(100),
  cashierDiscountLimit: z.number().min(0).max(100).default(5),
  managerDiscountLimit: z.number().min(0).max(100).default(15),
  ownerDiscountLimit: z.number().min(0).max(100).default(100),
  defaultTaxRate: z.number().min(0).max(100).default(0)
});

export const exchangeConfigSchema = z.object({
  exchangeWindowDays: z.number().int().min(0).default(3),
  billRequired: z.boolean().default(true),
  tagsRequired: z.boolean().default(true),
  managerOverrideRequired: z.boolean().default(false),
  defaultExchangeReasons: z.array(z.string()).default(["Size Issue", "Defective", "Customer Changed Mind"])
});

export const inventoryConfigSchema = z.object({
  allowNegativeStock: z.boolean().default(false),
  lowStockThreshold: z.number().int().min(0).default(5),
  autoSkuGeneration: z.boolean().default(true),
  inventoryReservationMins: z.number().int().min(0).default(15)
});

export const securityConfigSchema = z.object({
  sessionTimeoutMins: z.number().int().min(5).default(480), // 8 hours
  maxLoginAttempts: z.number().int().min(3).default(5),
  accountLockDurationMins: z.number().int().min(1).default(15),
  jwtExpirationHours: z.number().int().min(1).default(12),
  auditLogRetentionDays: z.number().int().min(30).default(365)
});

export const reportingConfigSchema = z.object({
  businessDayStartHour: z.number().int().min(0).max(23).default(9),
  businessDayEndHour: z.number().int().min(0).max(23).default(22),
  defaultDashboardPeriod: z.enum(["TODAY", "WEEK", "MONTH", "YEAR"]).default("TODAY")
});

/**
 * System Preferences — presentation-layer defaults for the admin UI.
 *
 * ADDITIVE (2026-08-03). Persisted in the `customerConfig` column, which the
 * schema has always declared but no engine getter ever read. Reusing a column
 * that is provably empty everywhere keeps this a zero-migration change: adding
 * a column to a singleton table would otherwise require a migration on a live
 * database for what is purely UI state.
 *
 * Nothing in the transaction path reads these. They are safe to change during
 * trading hours, which is why Store Settings saves them without confirmation.
 */
export const systemConfigSchema = z.object({
  dateFormat: z.enum(["DD-MM-YYYY", "MM-DD-YYYY", "YYYY-MM-DD"]).default("DD-MM-YYYY"),
  timeFormat: z.enum(["12H", "24H"]).default("12H"),
  numberLocale: z.string().min(2).default("en-IN"),
  defaultLandingPage: z.enum(["DASHBOARD", "POS", "SALES"]).default("DASHBOARD"),
  tableDensity: z.enum(["COMPACT", "COMFORTABLE"]).default("COMFORTABLE"),
  itemsPerPage: z.number().int().min(10).max(100).default(20)
});

/**
 * Integrations — outbound channel toggles.
 *
 * ADDITIVE (2026-08-03). Persisted in the `notificationConfig` column, which
 * notification.engine.ts already reserves for exactly this purpose (see its
 * commented-out `getNotificationSettings()` calls). Defining the shape here
 * gives that engine a typed contract to adopt without another migration.
 *
 * Credentials are deliberately NOT modelled. Only booleans and non-secret
 * addresses live in this row, because the settings row is returned in full to
 * any authenticated OWNER and is copied verbatim into the audit log. Secrets
 * belong in environment variables.
 */
export const integrationConfigSchema = z.object({
  emailEnabled: z.boolean().default(false),
  smsEnabled: z.boolean().default(false),
  whatsappEnabled: z.boolean().default(false),
  lowStockAlertsEnabled: z.boolean().default(true),
  dailySummaryEnabled: z.boolean().default(false),
  senderEmail: optionalEmail,
  supportPhone: optionalText
});

/**
 * Turns a config block into a true PATCH schema: every key optional, and every
 * `.default()` REMOVED.
 *
 * ⚠ `.partial()` alone is not enough, and the difference silently destroys data.
 * In Zod, `.partial()` makes a key optional but leaves its default in place, so
 * parsing `{ defaultTaxRate: 18 }` against a partialed pricing schema returns
 * the tax rate PLUS a default value for every other field — `cashierDiscountLimit: 5`,
 * `managerDiscountLimit: 15`, and so on. The service cannot distinguish those
 * from values the owner actually submitted, so it merges them over the stored
 * block and a store's configured discount ladder reverts to shipped defaults on
 * an unrelated save. Nothing throws; the settings simply change on their own.
 *
 * Unwrapping the default (`.def.innerType`) restores the intended meaning of
 * "absent": absent stays absent, and the stored value survives the merge.
 * Defaults still apply where they should — in the ENGINE, which parses each full
 * block with the undefaulted schemas when loading a row from the database.
 *
 * Locked down by "accepts a payload containing a single nested key" and
 * "accepts the additive system and integration blocks" in
 * utils/__tests__/configMerge.test.ts.
 */
function toPatchSchema<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, field] of Object.entries(schema.shape)) {
    let inner = field as z.ZodTypeAny;
    // Peel any number of default/optional wrappers to reach the real validator,
    // so the field's own rules (min/max/regex/email) still run on what is sent.
    while (
      inner instanceof z.ZodDefault ||
      inner instanceof z.ZodOptional
    ) {
      inner = (inner as unknown as { def: { innerType: z.ZodTypeAny } }).def.innerType;
    }
    shape[key] = inner.optional();
  }

  return z.object(shape);
}

/**
 * A master schema to validate the entire payload if updated collectively.
 *
 * Every block is a PATCH schema: the service merges each one over the stored
 * value, so a payload carrying a single key changes only that key. Sending a
 * whole block still works and behaves identically.
 *
 * The `superRefine` below enforces rules that span two keys. They are checked
 * here rather than on the individual block schemas because a `.partial()` object
 * cannot see a sibling key the caller did not send — the merged-value check that
 * catches those cases lives in configuration.service.ts and runs against the
 * post-merge state. These are the cheap early rejections for the common case
 * where both halves of a pair arrive together.
 */
export const configurationUpdateSchema = z.object({
  body: z.object({
    storeName: z.string().trim().min(1).max(120).optional(),
    currency: z.string().trim().length(3, "Use a 3-letter ISO code, e.g. INR").toUpperCase().optional(),
    timeZone: z.string().min(1).optional(),
    storeConfig: toPatchSchema(storeConfigSchema).optional(),
    invoiceConfig: toPatchSchema(invoiceConfigSchema).optional(),
    pricingConfig: toPatchSchema(pricingConfigSchema).optional(),
    exchangeConfig: toPatchSchema(exchangeConfigSchema).optional(),
    inventoryConfig: toPatchSchema(inventoryConfigSchema).optional(),
    securityConfig: toPatchSchema(securityConfigSchema).optional(),
    reportingConfig: toPatchSchema(reportingConfigSchema).optional(),
    systemConfig: toPatchSchema(systemConfigSchema).optional(),
    integrationConfig: toPatchSchema(integrationConfigSchema).optional()
  })
});

// ============================================================================
// CROSS-FIELD INVARIANTS
// ============================================================================

/**
 * Rules that involve more than one key, checked against the FULLY MERGED
 * configuration rather than the incoming patch.
 *
 * This has to run post-merge. A PATCH that lowers only `managerDiscountLimit`
 * carries no `cashierDiscountLimit`, so a schema-level check on the request body
 * sees one half of the pair and cannot tell whether the ladder is still ordered.
 * Validating the merged result is the only way a partial update can be held to a
 * whole-object invariant.
 *
 * Returns a list of human-readable problems; empty means valid. The service
 * turns a non-empty list into a 400 before anything is written, so an invalid
 * combination never reaches the database or the engine cache.
 */
export function findConfigurationConflicts(merged: {
  pricingConfig?: { cashierDiscountLimit?: number; managerDiscountLimit?: number; ownerDiscountLimit?: number; maximumDiscountPercent?: number };
  reportingConfig?: { businessDayStartHour?: number; businessDayEndHour?: number };
  securityConfig?: { sessionTimeoutMins?: number; jwtExpirationHours?: number };
}): string[] {
  const problems: string[] = [];

  const p = merged.pricingConfig;
  if (p) {
    const cashier = p.cashierDiscountLimit;
    const manager = p.managerDiscountLimit;
    const owner = p.ownerDiscountLimit;
    const ceiling = p.maximumDiscountPercent;

    // The ladder must not invert. A cashier who can discount more deeply than a
    // manager makes the approval escalation in the POS meaningless.
    if (cashier !== undefined && manager !== undefined && cashier > manager) {
      problems.push(
        `Cashier discount limit (${cashier}%) cannot exceed the manager limit (${manager}%).`
      );
    }
    if (manager !== undefined && owner !== undefined && manager > owner) {
      problems.push(
        `Manager discount limit (${manager}%) cannot exceed the owner limit (${owner}%).`
      );
    }
    // Every per-role limit is bounded by the store-wide ceiling, which the
    // pricing engine applies last. A role limit above it is silently unreachable
    // and would mislead whoever configured it.
    if (ceiling !== undefined) {
      for (const [label, value] of [
        ["Cashier", cashier],
        ["Manager", manager],
        ["Owner", owner],
      ] as const) {
        if (value !== undefined && value > ceiling) {
          problems.push(
            `${label} discount limit (${value}%) cannot exceed the maximum discount (${ceiling}%).`
          );
        }
      }
    }
  }

  const r = merged.reportingConfig;
  if (r?.businessDayStartHour !== undefined && r?.businessDayEndHour !== undefined) {
    // Equal is also rejected: a zero-length business day makes every
    // business-day-scoped report return nothing, with no obvious cause.
    if (r.businessDayStartHour >= r.businessDayEndHour) {
      problems.push(
        `Business day start (${r.businessDayStartHour}:00) must be before the end (${r.businessDayEndHour}:00).`
      );
    }
  }

  const s = merged.securityConfig;
  if (s?.sessionTimeoutMins !== undefined && s?.jwtExpirationHours !== undefined) {
    // A session that outlives its own token strands the user at a random
    // moment mid-shift instead of at the timeout they configured.
    if (s.sessionTimeoutMins > s.jwtExpirationHours * 60) {
      problems.push(
        `Session timeout (${s.sessionTimeoutMins} min) cannot exceed JWT expiry (${s.jwtExpirationHours} h = ${s.jwtExpirationHours * 60} min).`
      );
    }
  }

  return problems;
}
