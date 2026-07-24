import { ConfigurationEngine } from "../engines/configuration.engine";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export interface ExchangeWindowStatus {
  /** Configured exchange window length in days. */
  windowDays: number;
  /** Whole days elapsed since the purchase (same-day = 0). */
  elapsedDays: number;
  /** Whole days left in the window; 0 once expired. */
  daysRemaining: number;
  /** Whether the sale is still within the exchange window. */
  eligible: boolean;
  /** The moment the window closes for this sale. */
  expiresOn: Date;
}

/**
 * Single source of truth for the exchange-window business rule.
 *
 * Both the customer-facing eligibility endpoint and the backend exchange
 * enforcement call this so the UI can never promise an exchange the backend
 * would reject (or vice versa). The window length is always read from the
 * ConfigurationEngine — never hardcoded.
 *
 * A sale is eligible while `elapsedDays <= windowDays` (elapsed measured with
 * floor, so a purchase counts as day 0 on the day it was made).
 */
export function evaluateExchangeWindow(saleDate: Date | string, now: Date = new Date()): ExchangeWindowStatus {
  const windowDays = ConfigurationEngine.getExchangeSettings().exchangeWindowDays;
  const saleTime = new Date(saleDate).getTime();

  const elapsedDays = Math.floor((now.getTime() - saleTime) / MS_PER_DAY);
  const daysRemaining = windowDays - elapsedDays;
  const eligible = daysRemaining >= 0;

  return {
    windowDays,
    elapsedDays,
    daysRemaining: eligible ? daysRemaining : 0,
    eligible,
    expiresOn: new Date(saleTime + windowDays * MS_PER_DAY),
  };
}
