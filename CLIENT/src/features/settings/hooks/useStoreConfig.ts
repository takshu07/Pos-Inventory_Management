/**
 * Derived configuration hooks — how the rest of the app CONSUMES settings.
 *
 * Every one of these reads the same cached `GET /settings` document, so a screen
 * that needs the currency does not fetch anything of its own and does not have
 * to be told when it changes: saving in Store Settings updates the cache and
 * these re-render.
 *
 * ⚠ WHY EVERY HOOK HAS A FALLBACK
 * These are used by screens that render before settings load, and by screens a
 * CASHIER can reach — and `GET /settings` is OWNER-only, so for a cashier the
 * query never resolves. A hook that returned `undefined` would make every caller
 * write the same defensive branch, and the ones that forgot would render
 * "undefined" into a receipt. Each hook therefore always returns a usable value,
 * falling back to the same defaults the server's Zod schemas declare.
 *
 * The fallbacks are NOT a second source of truth for business rules. Money
 * decisions — discount ceilings, tax, rounding, exchange eligibility — are made
 * server-side from ConfigurationEngine, and the values here are for DISPLAY. A
 * cashier's client showing a default currency symbol is a cosmetic degradation;
 * it can never authorise a discount the server would refuse.
 */

import { useMemo } from "react";

import { useSettings } from "./useSettings";
import type { FullConfiguration } from "../types";

/** Mirrors the server's Zod defaults. See the file header for why these exist. */
const FALLBACK = {
  currency: "INR",
  numberLocale: "en-IN",
  timeZone: "Asia/Kolkata",
  storeName: "Store",
  dateFormat: "DD-MM-YYYY" as const,
  timeFormat: "12H" as const,
  itemsPerPage: 20,
  lowStockThreshold: 5,
};

/** The raw document, or `undefined` while loading / when not permitted. */
export function useConfiguration(): FullConfiguration | undefined {
  return useSettings().data;
}

/**
 * Currency formatter bound to the configured currency and number locale.
 *
 * Returns a FUNCTION rather than a formatted string so a list can format a
 * thousand rows against one `Intl.NumberFormat` instance — constructing one per
 * call is the expensive part, and it is memoised on the two values that affect
 * it.
 *
 * Fraction digits follow the currency's own convention (₹ and $ → 2, ¥ → 0)
 * rather than being forced, so the amount reads correctly in whatever currency
 * the store is configured for.
 */
export function useCurrencyFormatter() {
  const config = useConfiguration();
  const currency = config?.currency ?? FALLBACK.currency;
  const locale = config?.systemConfig.numberLocale ?? FALLBACK.numberLocale;

  return useMemo(() => {
    let formatter: Intl.NumberFormat;
    try {
      formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
    } catch {
      // An unrecognised currency or locale must not crash a receipt. Fall back
      // to the defaults, which are always valid.
      formatter = new Intl.NumberFormat(FALLBACK.numberLocale, {
        style: "currency",
        currency: FALLBACK.currency,
      });
    }
    return (amount: number) => formatter.format(Number.isFinite(amount) ? amount : 0);
  }, [currency, locale]);
}

/**
 * Date/time formatter bound to the configured time zone and display formats.
 *
 * The time zone matters for correctness, not just presentation: a sale made at
 * 00:30 IST belongs to a different calendar day depending on the zone it is
 * rendered in, and the server reports business days in the CONFIGURED zone. A
 * client formatting in the browser's local zone would disagree with the totals
 * on the same screen.
 */
export function useDateFormatter() {
  const config = useConfiguration();
  const timeZone = config?.timeZone ?? FALLBACK.timeZone;
  const dateFormat = config?.systemConfig.dateFormat ?? FALLBACK.dateFormat;
  const timeFormat = config?.systemConfig.timeFormat ?? FALLBACK.timeFormat;

  return useMemo(() => {
    const hour12 = timeFormat === "12H";

    function parts(value: Date | string): Record<string, string> {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return {};

      try {
        return Object.fromEntries(
          new Intl.DateTimeFormat("en-GB", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12,
          })
            .formatToParts(date)
            .map((p) => [p.type, p.value])
        );
      } catch {
        return {};
      }
    }

    /** Date only, in the configured field order. */
    function formatDate(value: Date | string): string {
      const p = parts(value);
      if (!p.year) return "—";
      if (dateFormat === "YYYY-MM-DD") return `${p.year}-${p.month}-${p.day}`;
      if (dateFormat === "MM-DD-YYYY") return `${p.month}-${p.day}-${p.year}`;
      return `${p.day}-${p.month}-${p.year}`;
    }

    /** Time only. */
    function formatTime(value: Date | string): string {
      const p = parts(value);
      if (!p.hour) return "—";
      const suffix = hour12 && p.dayPeriod ? ` ${p.dayPeriod}` : "";
      return `${p.hour}:${p.minute}${suffix}`;
    }

    function formatDateTime(value: Date | string): string {
      const date = formatDate(value);
      return date === "—" ? date : `${date}, ${formatTime(value)}`;
    }

    return { formatDate, formatTime, formatDateTime, timeZone };
  }, [timeZone, dateFormat, timeFormat]);
}

/** Store identity, for receipts, labels and headers. */
export function useStoreIdentity() {
  const config = useConfiguration();
  return {
    storeName: config?.storeName ?? FALLBACK.storeName,
    logoUrl: config?.storeConfig.logoUrl,
    address: config?.storeConfig.address,
    phone: config?.storeConfig.phone,
    email: config?.storeConfig.email,
    gstNumber: config?.storeConfig.gstNumber,
    storeStatus: config?.storeConfig.storeStatus ?? "OPEN",
  };
}

/**
 * The default page size for lists.
 *
 * Display-only, so the fallback is safe: a list rendering 20 rows instead of a
 * configured 50 is a preference miss, not a correctness problem.
 */
export function useDefaultPageSize(): number {
  return useConfiguration()?.systemConfig.itemsPerPage ?? FALLBACK.itemsPerPage;
}

/**
 * The low-stock threshold, for badges and replenishment highlighting.
 *
 * ⚠ DISPLAY ONLY. The server decides what is actually low-stock when it computes
 * replenishment; this is for rendering a badge next to a number the server
 * already returned. Do not use it to make a stock decision on the client.
 */
export function useLowStockThreshold(): number {
  return useConfiguration()?.inventoryConfig.lowStockThreshold ?? FALLBACK.lowStockThreshold;
}
