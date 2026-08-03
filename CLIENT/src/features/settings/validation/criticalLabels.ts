/**
 * Human-readable names for the fields that require confirmation.
 *
 * Kept in its own component-free module, next to CRITICAL_FIELDS, for two
 * reasons: the two maps must be edited together, and a unit test can import
 * this without pulling React and the whole UI kit into a node-environment run.
 *
 * ⚠ EVERY key in `CRITICAL_FIELDS` needs an entry here. Without one the
 * confirmation dialog falls back to the raw JSON path and asks somebody to
 * approve "invoiceConfig.invoicePrefix", which is not a sentence. Asserted by
 * "has a human-readable dialog label for every field it can flag" in
 * __tests__/validation.test.ts.
 */

export const CRITICAL_FIELD_LABELS: Record<string, string> = {
  currency: "Currency",
  "pricingConfig.taxInclusive": "Tax mode",
  "pricingConfig.defaultTaxRate": "Default tax rate",
  "pricingConfig.maximumDiscountPercent": "Maximum discount",
  "pricingConfig.cashierDiscountLimit": "Cashier discount limit",
  "pricingConfig.managerDiscountLimit": "Manager discount limit",
  "inventoryConfig.allowNegativeStock": "Allow negative stock",
  "securityConfig.sessionTimeoutMins": "Session timeout",
  "securityConfig.jwtExpirationHours": "Sign-in duration",
  "securityConfig.auditLogRetentionDays": "Audit log retention",
  "storeConfig.storeStatus": "Store status",
  "invoiceConfig.invoicePrefix": "Invoice prefix",
  "invoiceConfig.invoiceNumberLength": "Invoice sequence length",
};
