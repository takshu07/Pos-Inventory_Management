/**
 * Settings — select option lists.
 *
 * Kept out of the page so the three settings screens share one vocabulary: a
 * currency added here appears everywhere it is offered, rather than in whichever
 * screen happened to be edited.
 *
 * These lists are intentionally SHORT. A settings dropdown is a decision aid,
 * not a reference table — offering all ~300 IANA zones would make the common
 * choice harder to find. The server accepts any valid value, so a deployment
 * needing another entry adds one line here.
 */

import type { SelectOption } from "@/components/ui";

export const STORE_STATUS_OPTIONS: SelectOption[] = [
  { value: "OPEN", label: "Open — trading normally" },
  { value: "CLOSED", label: "Closed" },
  { value: "MAINTENANCE", label: "Maintenance" },
];

/**
 * ISO 4217 codes. The label carries the symbol because the code alone ("INR")
 * is not what an owner recognises at a glance.
 */
export const CURRENCY_OPTIONS: SelectOption[] = [
  { value: "INR", label: "INR — Indian Rupee (₹)" },
  { value: "USD", label: "USD — US Dollar ($)" },
  { value: "EUR", label: "EUR — Euro (€)" },
  { value: "GBP", label: "GBP — British Pound (£)" },
  { value: "AED", label: "AED — UAE Dirham" },
  { value: "SGD", label: "SGD — Singapore Dollar" },
  { value: "AUD", label: "AUD — Australian Dollar" },
  { value: "CAD", label: "CAD — Canadian Dollar" },
];

/** IANA identifiers — never fixed offsets, which break across DST. */
export const TIMEZONE_OPTIONS: SelectOption[] = [
  { value: "Asia/Kolkata", label: "Asia/Kolkata (IST)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (GST)" },
  { value: "Asia/Singapore", label: "Asia/Singapore" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "Europe/Berlin", label: "Europe/Berlin" },
  { value: "America/New_York", label: "America/New York (ET)" },
  { value: "America/Chicago", label: "America/Chicago (CT)" },
  { value: "America/Los_Angeles", label: "America/Los Angeles (PT)" },
  { value: "Australia/Sydney", label: "Australia/Sydney" },
  { value: "UTC", label: "UTC" },
];

export const ROUNDING_OPTIONS: SelectOption[] = [
  { value: "ROUND_HALF_UP", label: "Round half up (standard)" },
  { value: "ROUND_DOWN", label: "Always round down" },
  { value: "ROUND_UP", label: "Always round up" },
];

export const DASHBOARD_PERIOD_OPTIONS: SelectOption[] = [
  { value: "TODAY", label: "Today" },
  { value: "WEEK", label: "This week" },
  { value: "MONTH", label: "This month" },
  { value: "YEAR", label: "This year" },
];

export const DATE_FORMAT_OPTIONS: SelectOption[] = [
  { value: "DD-MM-YYYY", label: "DD-MM-YYYY (31-12-2026)" },
  { value: "MM-DD-YYYY", label: "MM-DD-YYYY (12-31-2026)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (2026-12-31)" },
];

export const TIME_FORMAT_OPTIONS: SelectOption[] = [
  { value: "12H", label: "12-hour (9:30 PM)" },
  { value: "24H", label: "24-hour (21:30)" },
];

/**
 * Number-grouping locales.
 *
 * `en-IN` groups as 1,00,000 (lakh/crore); `en-US` as 100,000. This is the one
 * formatting difference that actually changes how a figure is read, which is why
 * it is exposed separately from currency.
 */
export const LOCALE_OPTIONS: SelectOption[] = [
  { value: "en-IN", label: "Indian — 1,00,000" },
  { value: "en-US", label: "International — 100,000" },
  { value: "de-DE", label: "European — 100.000" },
];

export const LANDING_PAGE_OPTIONS: SelectOption[] = [
  { value: "DASHBOARD", label: "Dashboard" },
  { value: "POS", label: "POS Checkout" },
  { value: "SALES", label: "Sales" },
];

export const TABLE_DENSITY_OPTIONS: SelectOption[] = [
  { value: "COMFORTABLE", label: "Comfortable" },
  { value: "COMPACT", label: "Compact — more rows per screen" },
];

/**
 * Barcode symbologies the Label Engine can render.
 *
 * The labels state the constraint rather than just the name: EAN-13 will not
 * encode an arbitrary SKU (it needs a valid 13-digit code with a correct check
 * digit), so choosing it without that is how labels silently fail to print.
 */
export const BARCODE_FORMAT_OPTIONS: SelectOption[] = [
  { value: "CODE128", label: "CODE128 — encodes any SKU" },
  { value: "EAN13", label: "EAN-13 — requires a valid 13-digit code" },
];

/**
 * 0–23, labelled in 12-hour form.
 *
 * The stored value stays a 24-hour integer — the label is presentation only, so
 * business-day maths never has to parse an am/pm string.
 */
export const HOUR_OPTIONS: SelectOption[] = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: formatHourLabel(h),
}));

function formatHourLabel(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(hour).padStart(2, "0")}:00 — ${display}:00 ${suffix}`;
}
