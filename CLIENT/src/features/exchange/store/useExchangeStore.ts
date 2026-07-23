import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { PosVariant } from "@/features/pos/types/pos.types";

export interface ExchangeCartItem {
  cartItemId: string;
  variant: PosVariant;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ReturnSelectionItem {
  variantId: string;
  quantity: number;
  maxQuantity: number;
  priceAtSale: number;
  condition: "GOOD" | "DAMAGED";
}

interface ExchangeState {
  originalSaleId: string | null;
  returnedItems: ReturnSelectionItem[];
  issuedItems: ExchangeCartItem[];
  exchangeStep: number;
  
  // Actions
  startExchange: (saleId: string) => void;
  setReturnQuantity: (variantId: string, quantity: number, maxQuantity: number, priceAtSale: number, condition?: "GOOD" | "DAMAGED") => void;
  addIssuedItem: (variant: PosVariant, quantity?: number) => void;
  removeIssuedItem: (cartItemId: string) => void;
  clearExchange: () => void;
  setExchangeStep: (step: number) => void;
}

export const useExchangeStore = create<ExchangeState>((set) => ({
  originalSaleId: null,
  returnedItems: [],
  issuedItems: [],
  exchangeStep: 0, // 0: Select Returns, 1: Add New Items, 2: Difference/Payment, 3: Complete

  startExchange: (saleId) => set({ originalSaleId: saleId, returnedItems: [], issuedItems: [], exchangeStep: 0 }),
  
  setReturnQuantity: (variantId, quantity, maxQuantity, priceAtSale, condition = "GOOD") => {
    set((state) => {
      const existingIdx = state.returnedItems.findIndex(i => i.variantId === variantId);
      if (quantity <= 0) {
        if (existingIdx >= 0) {
          const updated = [...state.returnedItems];
          updated.splice(existingIdx, 1);
          return { returnedItems: updated };
        }
        return state;
      }

      const validQuantity = Math.min(quantity, maxQuantity);
      if (existingIdx >= 0) {
        const updated = [...state.returnedItems];
        updated[existingIdx] = { ...updated[existingIdx], quantity: validQuantity };
        return { returnedItems: updated };
      }

      return {
        returnedItems: [
          ...state.returnedItems,
          { variantId, quantity: validQuantity, maxQuantity, priceAtSale, condition }
        ]
      };
    });
  },

  addIssuedItem: (variant, quantity = 1) => {
    set((state) => {
      const existingIdx = state.issuedItems.findIndex((i) => i.variant.id === variant.id);
      
      if (existingIdx >= 0) {
        const existing = state.issuedItems[existingIdx];
        const newQuantity = existing.quantity + quantity;
        if (newQuantity > variant.currentStock) return state;

        const updated = [...state.issuedItems];
        updated[existingIdx] = {
          ...existing,
          quantity: newQuantity,
          lineTotal: newQuantity * existing.unitPrice,
        };
        return { issuedItems: updated };
      }

      const unitPrice = Number(variant.sellingPrice);
      return {
        issuedItems: [
          ...state.issuedItems,
          {
            cartItemId: crypto.randomUUID(),
            variant,
            quantity,
            unitPrice,
            lineTotal: quantity * unitPrice,
          }
        ]
      };
    });
  },

  removeIssuedItem: (cartItemId) => {
    set((state) => ({
      issuedItems: state.issuedItems.filter(i => i.cartItemId !== cartItemId)
    }));
  },

  clearExchange: () => set({ originalSaleId: null, returnedItems: [], issuedItems: [], exchangeStep: 0 }),
  
  setExchangeStep: (step) => set({ exchangeStep: step })
}));

export const useExchangeTotals = () => {
  // Subscribe only to the two item arrays (shallow) and memoize the math, so
  // this recomputes only when items change — not on every unrelated store update.
  const { returnedItems, issuedItems } = useExchangeStore(
    useShallow((s) => ({
      returnedItems: s.returnedItems,
      issuedItems: s.issuedItems,
    }))
  );

  return useMemo(() => {
    const returnedTotal = returnedItems.reduce(
      (sum, item) => sum + item.quantity * item.priceAtSale,
      0
    );
    const issuedTotal = issuedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const difference = issuedTotal - returnedTotal; // Positive means customer owes us

    return { returnedTotal, issuedTotal, difference };
  }, [returnedItems, issuedItems]);
};
