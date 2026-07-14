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

export const calculateGrandTotal = (subtotal: number, discountAmount: number, tax: number = 0): number => {
  return Math.max(0, subtotal - discountAmount + tax);
};

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
};
