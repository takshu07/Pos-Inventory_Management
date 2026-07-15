import { create } from "zustand";
import { CartItem, PosVariant, PosDiscount } from "../types/pos.types";
import { calculateSubtotal, calculateDiscountAmount, calculateGrandTotal } from "../utils/pos.utils";

import { CustomerModel } from "@/features/customers/types";

interface PosState {
  isSessionStarted: boolean; // Controls whether the cart/scan screen is active
  cart: CartItem[];
  discount?: PosDiscount;
  tax: number; // Storing total tax amount for simplicity
  customer: Partial<CustomerModel> | null; // Attached customer (can be partial for new un-saved)
  
  // Actions
  startSession: (customer: Partial<CustomerModel> | null) => void;
  unstartSession: () => void;
  addItem: (variant: PosVariant, quantity?: number) => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
  removeItem: (cartItemId: string) => void;
  clearCart: () => void;
  setDiscount: (discount?: PosDiscount) => void;
  setCustomer: (customer: Partial<CustomerModel> | null) => void;
  checkoutStep: number;
  setCheckoutStep: (step: number) => void;
}

export const usePosStore = create<PosState>((set, get) => ({
  isSessionStarted: false,
  cart: [],
  discount: undefined,
  tax: 0,
  customer: null,
  checkoutStep: 0,

  startSession: (customer) => set({ isSessionStarted: true, customer, checkoutStep: 1 }),
  unstartSession: () => set({ isSessionStarted: false, checkoutStep: 0 }),

  addItem: (variant, quantity = 1) => {
    set((state) => {
      // Validate inventory
      if (variant.currentStock <= 0) {
        // UI should handle showing error, but we enforce here
        console.warn("Out of stock variant added");
        return state;
      }
      
      const existingItemIndex = state.cart.findIndex((i) => i.variant.id === variant.id);
      
      if (existingItemIndex >= 0) {
        const existingItem = state.cart[existingItemIndex];
        const newQuantity = existingItem.quantity + quantity;
        
        if (newQuantity > variant.currentStock) {
           return state; // Do not exceed stock
        }

        const updatedCart = [...state.cart];
        updatedCart[existingItemIndex] = {
          ...existingItem,
          quantity: newQuantity,
          lineTotal: newQuantity * existingItem.unitPrice,
        };
        return { cart: updatedCart };
      }

      const unitPrice = Number(variant.sellingPrice);
      const newItem: CartItem = {
        cartItemId: crypto.randomUUID(),
        variant,
        quantity,
        unitPrice,
        lineTotal: quantity * unitPrice,
      };

      return { cart: [...state.cart, newItem] };
    });
  },

  updateQuantity: (cartItemId, quantity) => {
    set((state) => {
      if (quantity <= 0) {
        return { cart: state.cart.filter((item) => item.cartItemId !== cartItemId) };
      }

      const updatedCart = state.cart.map((item) => {
        if (item.cartItemId === cartItemId) {
          // Enforce stock limit
          const safeQuantity = Math.min(quantity, item.variant.currentStock);
          return {
            ...item,
            quantity: safeQuantity,
            lineTotal: safeQuantity * item.unitPrice,
          };
        }
        return item;
      });

      return { cart: updatedCart };
    });
  },

  removeItem: (cartItemId) => {
    set((state) => ({
      cart: state.cart.filter((item) => item.cartItemId !== cartItemId),
    }));
  },

  clearCart: () => {
    set({ cart: [], discount: undefined, tax: 0, customer: null, isSessionStarted: false, checkoutStep: 0 });
  },

  setDiscount: (discount) => {
    set({ discount });
  },

  setCustomer: (customer) => {
    set({ customer });
  },

  setCheckoutStep: (step) => {
    set({ checkoutStep: step });
  }
}));

// Helper hook for derived totals
export const usePosTotals = () => {
  const { cart, discount, tax } = usePosStore();
  const subtotal = calculateSubtotal(cart);
  const discountAmount = calculateDiscountAmount(subtotal, discount);
  const grandTotal = calculateGrandTotal(subtotal, discountAmount, tax);

  return { subtotal, discountAmount, tax, grandTotal };
};
