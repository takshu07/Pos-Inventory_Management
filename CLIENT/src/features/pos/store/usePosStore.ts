import { create } from "zustand";
import { CartItem, PosVariant, PosDiscount } from "../types/pos.types";
import { calculateSubtotal, calculateDiscountAmount, calculateGrandTotal } from "../utils/pos.utils";

import { CustomerModel } from "@/features/customers/types";

export interface PosReturnedItem {
  cartItemId: string;
  variant: PosVariant;
  quantity: number;
  originalSaleId: string;
  mrp: number;
}

/** The three tabs of the cashier workspace (Static section 2 in the design). */
export type PosTab = "CUSTOMER" | "ITEMS" | "BILLS";

/** A bill produced during the current cashier session (raw backend sale/exchange payload). */
export interface SessionBill {
  id: string;
  number: string;
  kind: "SALE" | "EXCHANGE";
  grandTotal: number;
  createdAt: string;
  raw: any;
}

interface PosState {
  posMode: "SALE" | "EXCHANGE";
  isSessionStarted: boolean; // A customer has been attached and the workspace is active
  activeTab: PosTab;
  cart: CartItem[];
  selectedCartItemId: string | null; // Row shown in the right-hand detail panel
  discount?: PosDiscount;
  tax: number; // Storing total tax amount for simplicity
  customer: Partial<CustomerModel> | null; // Attached customer (can be partial for new un-saved)
  exchangeReturns: PosReturnedItem[];
  sessionBills: SessionBill[]; // Bills saved so far without leaving the workspace
  lastSavedBill: SessionBill | null; // Enables the "Print" toolbar action

  // Actions
  startSession: (customer: Partial<CustomerModel> | null) => void;
  unstartSession: () => void;
  resetWorkspace: () => void; // "Add" — begin a brand new transaction
  setActiveTab: (tab: PosTab) => void;
  addItem: (variant: PosVariant, quantity?: number) => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
  updateItemDiscount: (cartItemId: string, discount: PosDiscount | undefined) => void;
  setSelectedCartItem: (cartItemId: string | null) => void;
  removeItem: (cartItemId: string) => void;
  clearCart: () => void;
  setDiscount: (discount?: PosDiscount) => void;
  setCustomer: (customer: Partial<CustomerModel> | null) => void;
  setPosMode: (mode: "SALE" | "EXCHANGE") => void;
  addExchangeReturn: (item: PosReturnedItem) => void;
  removeExchangeReturn: (cartItemId: string) => void;
  recordBill: (bill: SessionBill) => void;
}

const emptyWorkspace = {
  isSessionStarted: false,
  activeTab: "CUSTOMER" as PosTab,
  posMode: "SALE" as const,
  cart: [] as CartItem[],
  selectedCartItemId: null,
  discount: undefined,
  tax: 0,
  customer: null,
  exchangeReturns: [] as PosReturnedItem[],
};

export const usePosStore = create<PosState>((set, get) => ({
  ...emptyWorkspace,
  sessionBills: [],
  lastSavedBill: null,

  startSession: (customer) =>
    set({ isSessionStarted: true, customer, activeTab: "ITEMS", posMode: "SALE", cart: [], exchangeReturns: [] }),

  unstartSession: () => set({ ...emptyWorkspace }),

  // "Add" clears the current transaction entirely and returns to customer entry,
  // but keeps this session's saved bills so they remain visible in "List of bills".
  resetWorkspace: () => set({ ...emptyWorkspace }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setPosMode: (mode) => set({ posMode: mode, exchangeReturns: mode === "SALE" ? [] : get().exchangeReturns }),

  addItem: (variant, quantity = 1) => {
    set((state) => {
      if (variant.currentStock <= 0) {
        console.warn("Out of stock variant added");
        return state;
      }

      const existingItemIndex = state.cart.findIndex((i) => i.variant.id === variant.id);

      if (existingItemIndex >= 0) {
        const existingItem = state.cart[existingItemIndex];
        const newQuantity = existingItem.quantity + quantity;

        if (newQuantity > variant.currentStock) {
          return { selectedCartItemId: existingItem.cartItemId };
        }

        const updatedCart = [...state.cart];
        updatedCart[existingItemIndex] = {
          ...existingItem,
          quantity: newQuantity,
          lineTotal: newQuantity * existingItem.unitPrice - (existingItem.discountAmount ?? 0),
        };
        return { cart: updatedCart, selectedCartItemId: existingItem.cartItemId };
      }

      const unitPrice = Number(variant.sellingPrice);
      const cartItemId = crypto.randomUUID();
      const newItem: CartItem = {
        cartItemId,
        variant,
        quantity,
        unitPrice,
        discountAmount: 0,
        lineTotal: quantity * unitPrice,
      };

      return { cart: [...state.cart, newItem], selectedCartItemId: cartItemId };
    });
  },

  updateQuantity: (cartItemId, quantity) => {
    set((state) => {
      if (quantity <= 0) {
        return { cart: state.cart.filter((item) => item.cartItemId !== cartItemId) };
      }

      const updatedCart = state.cart.map((item) => {
        if (item.cartItemId === cartItemId) {
          const safeQuantity = Math.min(quantity, item.variant.currentStock);
          return {
            ...item,
            quantity: safeQuantity,
            lineTotal: safeQuantity * item.unitPrice - (item.discountAmount ?? 0),
          };
        }
        return item;
      });

      return { cart: updatedCart };
    });
  },

  // Per-row discount, entered either as a percentage or a flat rupee amount.
  updateItemDiscount: (cartItemId, discount) => {
    set((state) => {
      const updatedCart = state.cart.map((item) => {
        if (item.cartItemId !== cartItemId) return item;
        const gross = item.quantity * item.unitPrice;
        let discountAmount = 0;
        if (discount) {
          discountAmount =
            discount.type === "PERCENTAGE"
              ? (gross * discount.value) / 100
              : Math.min(gross, discount.value);
        }
        discountAmount = Math.max(0, Math.min(gross, discountAmount));
        return {
          ...item,
          discount,
          discountAmount,
          lineTotal: gross - discountAmount,
        };
      });
      return { cart: updatedCart };
    });
  },

  setSelectedCartItem: (cartItemId) => set({ selectedCartItemId: cartItemId }),

  removeItem: (cartItemId) => {
    set((state) => ({
      cart: state.cart.filter((item) => item.cartItemId !== cartItemId),
      selectedCartItemId: state.selectedCartItemId === cartItemId ? null : state.selectedCartItemId,
    }));
  },

  clearCart: () => {
    set({ cart: [], discount: undefined, tax: 0, exchangeReturns: [], selectedCartItemId: null });
  },

  setDiscount: (discount) => set({ discount }),
  setCustomer: (customer) => set({ customer }),

  addExchangeReturn: (item) => set((state) => ({ exchangeReturns: [...state.exchangeReturns, item] })),
  removeExchangeReturn: (cartItemId) =>
    set((state) => ({ exchangeReturns: state.exchangeReturns.filter((i) => i.cartItemId !== cartItemId) })),

  recordBill: (bill) =>
    set((state) => ({
      sessionBills: [bill, ...state.sessionBills],
      lastSavedBill: bill,
    })),
}));

// Helper hook for derived totals
export const usePosTotals = () => {
  const { cart, discount, tax, posMode, exchangeReturns } = usePosStore();
  const subtotal = calculateSubtotal(cart);
  const discountAmount = calculateDiscountAmount(subtotal, discount);
  const saleTotal = calculateGrandTotal(subtotal, discountAmount, tax);

  const returnTotal =
    posMode === "EXCHANGE"
      ? exchangeReturns.reduce((sum, item) => sum + Number(item.variant.sellingPrice) * item.quantity, 0)
      : 0;

  const grandTotal = posMode === "EXCHANGE" ? Math.max(0, saleTotal - returnTotal) : saleTotal;

  return { subtotal, discountAmount, tax, saleTotal, returnTotal, grandTotal };
};

/**
 * Exchange MRP eligibility, evaluated at save time (not just at scan time).
 * Rule: every returned item must be matched by a replacement whose MRP is >= the
 * returned item's MRP. We enforce it conservatively — the single highest returned
 * MRP must be met by at least one cart item, and there must be enough cart items.
 */
export const validateExchangeMrp = (
  cart: CartItem[],
  returns: PosReturnedItem[]
): { ok: boolean; reason?: string } => {
  if (returns.length === 0) return { ok: true };
  if (cart.length === 0) {
    return { ok: false, reason: "Scan at least one new product to exchange for." };
  }

  const cartMrps = cart.flatMap((i) => Array(i.quantity).fill(Number(i.variant.mrp)) as number[]);
  const returnMrps = returns
    .flatMap((r) => Array(r.quantity).fill(r.mrp) as number[])
    .sort((a, b) => b - a);

  // Highest-MRP returns must each be covered by a distinct new item of >= MRP.
  const availableNew = [...cartMrps].sort((a, b) => b - a);
  for (const returnedMrp of returnMrps) {
    const idx = availableNew.findIndex((m) => m >= returnedMrp);
    if (idx === -1) {
      return {
        ok: false,
        reason: `New product MRP must be greater than or equal to the returned product's MRP (₹${returnedMrp}).`,
      };
    }
    availableNew.splice(idx, 1);
  }

  return { ok: true };
};
