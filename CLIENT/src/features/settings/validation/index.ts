/**
 * Settings — client-side validation.
 *
 * MIRRORS the server rules in SERVER/src/validation/configuration.validation.ts.
 * This is a UX layer, not a security control: every rule here is enforced again
 * server-side, and a tampered client gets a 400. The point is to fail in the
 * form, next to the field, before a round-trip — not to be the check that
 * matters.
 *
 * ⚠ When a rule changes on the server, change it here too. The cross-field rules
 * in particular exist in both places because the server validates the merged
 * document (the only place a partial patch can be judged) while the client
 * validates the draft (the only place it can point at an input).
 *
 * Keys are `"blockName.fieldName"` so `useSettingsForm.errorFor()` can hand each
 * message to the input that produced it.
 */

import type { FieldErrors } from "../hooks/useSettingsForm";
import type { FullConfiguration } from "../types";

const URL_RE = /^https?:\/\/.+/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MMDD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Validates the blocks Store Settings owns.
 *
 * Only rules that are cheap and unambiguous live here. Anything requiring server
 * knowledge (is this GST number real?) is deliberately not attempted — a
 * false rejection in the client is worse than a server round-trip.
 */
export function validateStoreSettings(draft: FullConfiguration): FieldErrors {
  const errors: FieldErrors = {};

  // ── Store Information ───────────────────────────────────────────────────
  if (!draft.storeName?.trim()) {
    errors.storeName = "Store name is required — it appears on every receipt.";
  } else if (draft.storeName.trim().length > 120) {
    errors.storeName = "Keep the store name under 120 characters.";
  }

  const store = draft.storeConfig;

  if (store.email && !EMAIL_RE.test(store.email)) {
    errors["storeConfig.email"] = "Enter a valid email address.";
  }
  if (store.website && !URL_RE.test(store.website)) {
    errors["storeConfig.website"] = "Include the full address, starting with https://";
  }
  if (store.logoUrl && !URL_RE.test(store.logoUrl)) {
    errors["storeConfig.logoUrl"] = "Include the full address, starting with https://";
  }
  if (store.financialYearStart && !MMDD_RE.test(store.financialYearStart)) {
    errors["storeConfig.financialYearStart"] = "Use MM-DD, for example 04-01.";
  }

  // ── Regional ────────────────────────────────────────────────────────────
  if (!draft.currency || draft.currency.trim().length !== 3) {
    errors.currency = "Use a 3-letter ISO code, for example INR.";
  }
  if (!draft.timeZone?.trim()) {
    errors.timeZone = "Time zone is required — reports and shifts depend on it.";
  }

  // ── Business Configuration: the discount ladder ─────────────────────────
  // Checked here as well as on the server because the server can only report
  // which RULE broke, while the form can point at the FIELD that broke it.
  const p = draft.pricingConfig;
  if (p.cashierDiscountLimit > p.managerDiscountLimit) {
    errors["pricingConfig.cashierDiscountLimit"] =
      `Cannot exceed the manager limit (${p.managerDiscountLimit}%).`;
  }
  if (p.managerDiscountLimit > p.ownerDiscountLimit) {
    errors["pricingConfig.managerDiscountLimit"] =
      `Cannot exceed the owner limit (${p.ownerDiscountLimit}%).`;
  }
  for (const [field, label] of [
    ["cashierDiscountLimit", "Cashier"],
    ["managerDiscountLimit", "Manager"],
    ["ownerDiscountLimit", "Owner"],
  ] as const) {
    if (p[field] > p.maximumDiscountPercent) {
      errors[`pricingConfig.${field}`] =
        `${label} limit cannot exceed the maximum discount (${p.maximumDiscountPercent}%).`;
    }
  }
  if (p.defaultTaxRate < 0 || p.defaultTaxRate > 100) {
    errors["pricingConfig.defaultTaxRate"] = "Tax rate must be between 0 and 100.";
  }

  // ── Business Configuration: exchange & inventory ────────────────────────
  if (draft.exchangeConfig.exchangeWindowDays < 0) {
    errors["exchangeConfig.exchangeWindowDays"] = "Cannot be negative.";
  }
  if (draft.inventoryConfig.lowStockThreshold < 0) {
    errors["inventoryConfig.lowStockThreshold"] = "Cannot be negative.";
  }

  // ── Reporting: the business day ─────────────────────────────────────────
  const r = draft.reportingConfig;
  if (r.businessDayStartHour >= r.businessDayEndHour) {
    errors["reportingConfig.businessDayEndHour"] =
      "The business day must end after it starts.";
  }

  // ── Security ────────────────────────────────────────────────────────────
  const s = draft.securityConfig;
  if (s.sessionTimeoutMins > s.jwtExpirationHours * 60) {
    errors["securityConfig.sessionTimeoutMins"] =
      `Cannot exceed the sign-in duration (${s.jwtExpirationHours * 60} minutes).`;
  }
  if (s.maxLoginAttempts < 3) {
    errors["securityConfig.maxLoginAttempts"] =
      "Must be at least 3 — fewer locks people out on ordinary typos.";
  }
  if (s.auditLogRetentionDays < 30) {
    errors["securityConfig.auditLogRetentionDays"] =
      "Must be at least 30 days.";
  }

  // ── Integrations ────────────────────────────────────────────────────────
  const i = draft.integrationConfig;
  if (i.senderEmail && !EMAIL_RE.test(i.senderEmail)) {
    errors["integrationConfig.senderEmail"] = "Enter a valid email address.";
  }
  if (i.emailEnabled && !i.senderEmail?.trim()) {
    errors["integrationConfig.senderEmail"] =
      "A sender address is required when email is enabled.";
  }

  return errors;
}

/**
 * Fields whose change carries consequences beyond this screen and therefore
 * require explicit confirmation before saving.
 *
 * The test is not "is this important" but "would a mistake here be silent and
 * costly". Each of these alters money handling, access, or document identity for
 * every future transaction — and none of them announce themselves at the till.
 */
export const CRITICAL_FIELDS: Record<string, string> = {
  currency:
    "Changing the currency does NOT convert existing prices or historical sales. Every stored amount will simply be displayed in the new currency.",
  "pricingConfig.taxInclusive":
    "Switching tax mode changes how every product price is interpreted at checkout, including existing catalog prices.",
  "pricingConfig.defaultTaxRate":
    "This rate applies to every product without its own tax setting, on all future sales.",
  "pricingConfig.maximumDiscountPercent":
    "This is the ceiling every role's discount limit is capped by.",
  "pricingConfig.cashierDiscountLimit":
    "Cashiers will be able to discount up to this amount without approval.",
  "pricingConfig.managerDiscountLimit":
    "Managers will be able to discount up to this amount without approval.",
  "inventoryConfig.allowNegativeStock":
    "Allowing negative stock lets the POS sell items the system believes are not there, which will make stock counts disagree with the ledger.",
  "securityConfig.sessionTimeoutMins":
    "Everyone signed in will be affected the next time their session is evaluated.",
  "securityConfig.jwtExpirationHours":
    "Shortening this signs people out sooner, including mid-shift.",
  "securityConfig.auditLogRetentionDays":
    "Reducing retention means older audit entries become eligible for deletion.",
  "storeConfig.storeStatus":
    "Closing or putting the store into maintenance affects whether staff can transact.",
};

/**
 * Which of the pending changes are critical.
 *
 * Returns `"block.field"` paths present in the patch that appear in
 * CRITICAL_FIELDS, so the confirmation dialog can name exactly what is about to
 * change rather than warning generically.
 */
export function findCriticalChanges(patch: Record<string, unknown>): string[] {
  const paths: string[] = [];

  for (const [key, value] of Object.entries(patch)) {
    if (key === "expectedVersion") continue;

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const field of Object.keys(value as Record<string, unknown>)) {
        const path = `${key}.${field}`;
        if (CRITICAL_FIELDS[path]) paths.push(path);
      }
    } else if (CRITICAL_FIELDS[key]) {
      paths.push(key);
    }
  }

  return paths;
}
