import { CartItem, PosDiscount } from "../types/pos.types";

export const calculateSubtotal = (items: CartItem[]): number => {
  return items.reduce((total, item) => total + item.lineTotal, 0);
};

export const calculateDiscountAmount = (subtotal: number, discount?: PosDiscount): number => {
  if (!discount) return 0;
  if (discount.type === "FIXED") {
    return Math.min(subtotal, discount.value);
  }
  if (discount.type === "PERCENTAGE") {
    return (subtotal * discount.value) / 100;
  }
  return 0;
};

/**
 * The exact, pre-rounding invoice total.
 *
 * Kept separate from the payable total so the UI can display both the true
 * arithmetic and the round-off line, exactly as the printed invoice does.
 */
export const calculateGrossTotal = (
  subtotal: number,
  discountAmount: number,
  tax: number = 0
): number => {
  return Math.max(0, subtotal - discountAmount + tax);
};

/**
 * Rounds an invoice total to the nearest whole rupee.
 *
 * MUST mirror the server's RoundingRule (engines/pricing.engine.ts) exactly.
 * The server validates payments against ITS OWN grandTotal, so if this drifts —
 * different rounding mode, or rounding a different quantity — the cashier is
 * shown one figure while the server demands another, and every sale is rejected
 * as underpaid. Both sides use half-up on the gross total.
 *
 * `Math.round` is half-up for positive values, which matches
 * Decimal.ROUND_HALF_UP server-side. The epsilon guards against binary
 * floating-point error: 1000.005 can be stored as 1000.00499…, which would
 * round down here but up in the server's exact decimal arithmetic.
 */
export const roundToPayable = (amount: number): number => {
  return Math.round(amount + Number.EPSILON * Math.abs(amount));
};

/** Signed round-off applied to reach the payable total (payable − gross). */
export const calculateRoundOff = (grossTotal: number): number => {
  return Number((roundToPayable(grossTotal) - grossTotal).toFixed(2));
};

/**
 * The PAYABLE total — what the customer actually pays and what the payment
 * modal collects. Always a whole rupee.
 */
export const calculateGrandTotal = (
  subtotal: number,
  discountAmount: number,
  tax: number = 0
): number => {
  return roundToPayable(calculateGrossTotal(subtotal, discountAmount, tax));
};

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
};
