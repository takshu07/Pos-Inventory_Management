/**
 * @file utils/formatters.ts
 *
 * Purpose: Global formatting utilities (currency, dates, etc).
 *
 * CONFIGURATION PROPAGATION (2026-08)
 * -----------------------------------
 * `formatCurrency` is called from ~650 places. Converting every one of them to a
 * React hook would be a large, risky refactor for no behavioural gain, and it is
 * not possible at all in the call sites that are not components (chart
 * formatters, table column definitions, CSV export builders).
 *
 * Instead the module keeps a small snapshot of the currency-relevant settings,
 * which `SettingsSync` refreshes whenever the configuration query resolves or
 * changes. Every existing call site then picks up the store's configured
 * currency and number locale without being touched.
 *
 * ⚠ THIS IS A DISPLAY CONCERN ONLY. No money decision is made here. Totals,
 * tax, rounding and discount ceilings are all computed server-side from
 * ConfigurationEngine; this only decides how an already-computed number is
 * rendered. If the snapshot is stale or never set, amounts render in the
 * defaults below — visibly plain, never wrong.
 */

/** Mirrors the server's Zod defaults, so pre-load rendering matches post-load. */
const DEFAULTS = {
  currency: "INR",
  locale: "en-IN",
};

let currentCurrency = DEFAULTS.currency;
let currentLocale = DEFAULTS.locale;

/**
 * Cached formatter. `Intl.NumberFormat` construction is the expensive part, and
 * this function runs in table-render loops, so it is built once per
 * currency/locale pair rather than per call.
 */
let cachedFormatter: Intl.NumberFormat | null = null;

function getFormatter(): Intl.NumberFormat {
  if (cachedFormatter) return cachedFormatter;

  try {
    cachedFormatter = new Intl.NumberFormat(currentLocale, {
      style: "currency",
      currency: currentCurrency,
      // Whole rupees. The POS rounds every sale total to a whole currency unit
      // (see the round-off logic in the sale engine), so showing decimals here
      // would imply a precision the stored amounts do not have.
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } catch {
    // An unrecognised currency or locale must never break a receipt or a table.
    cachedFormatter = new Intl.NumberFormat(DEFAULTS.locale, {
      style: "currency",
      currency: DEFAULTS.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  return cachedFormatter;
}

/**
 * Points the global formatters at the store's configured currency and locale.
 *
 * Called by `SettingsSync` (mounted once in AppProvider) whenever the settings
 * query resolves or changes. Not exported through any barrel and not meant to be
 * called from feature code — configuration has exactly one source, the
 * `/settings` endpoint, and a second caller here would let the display drift
 * from it.
 *
 * No-ops when nothing changed, so an unrelated settings save does not
 * needlessly discard the cached formatter.
 */
export function configureCurrencyFormatting(currency: string, locale: string): void {
  if (currency === currentCurrency && locale === currentLocale) return;
  currentCurrency = currency || DEFAULTS.currency;
  currentLocale = locale || DEFAULTS.locale;
  cachedFormatter = null;
}

/** The active currency code — for places that need the code rather than a formatted amount. */
export function getActiveCurrency(): string {
  return currentCurrency;
}

export function formatCurrency(amount: number): string {
  // Guards against NaN/Infinity reaching Intl, which would render "NaN" into a
  // receipt rather than an obviously-empty value.
  return getFormatter().format(Number.isFinite(amount) ? amount : 0);
}

export function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

  let interval = Math.floor(seconds / 31536000);
  if (interval >= 1) return interval + "y ago";
  interval = Math.floor(seconds / 2592000);
  if (interval >= 1) return interval + "m ago";
  interval = Math.floor(seconds / 86400);
  if (interval >= 1) return interval + "d ago";
  interval = Math.floor(seconds / 3600);
  if (interval >= 1) return interval + "hr ago";
  interval = Math.floor(seconds / 60);
  if (interval >= 1) return interval + "min ago";
  return Math.floor(seconds) + "s ago";
}
