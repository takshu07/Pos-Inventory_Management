import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePosStore, usePosTotals, validateExchangeMrp, SessionBill } from "../store/usePosStore";
import { useCheckout } from "../api/pos.api";
import { useCreateExchange } from "@/features/exchange/hooks/useExchange";
import { useCurrentUser } from "@/features/auth/hooks/useCurrentUser";
import { printReceipt } from "../utils/printReceipt";
import { buildReceiptData } from "../utils/receiptMapper";

import type { PaymentMethod } from "../types/pos.types";

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
  transactionRef?: string;
}

/**
 * Single source of truth for saving a cashier transaction. Both the toolbar
 * ("Save only" / "Save & Print") and any in-tab button call through here, so the
 * validation and receipt logic lives in exactly one place.
 */
export function usePosCheckout() {
  const queryClient = useQueryClient();
  const checkoutMutation = useCheckout();
  const exchangeMutation = useCreateExchange();
  const { data: currentUser } = useCurrentUser();

  const {
    cart,
    customer,
    posMode,
    exchangeReturns,
    recordBill,
    clearCart,
    setActiveTab,
  } = usePosStore();
  const { subtotal, discountAmount, returnTotal, grandTotal } = usePosTotals();

  const isProcessing = checkoutMutation.isPending || exchangeMutation.isPending;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["analytics"] });
    queryClient.invalidateQueries({ queryKey: ["sales"] });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["exchanges"] });
  };

  const cashierName = currentUser
    ? `${currentUser.firstName} ${currentUser.lastName}`.trim()
    : undefined;

  const makeReceipt = (savedRaw: any, payments: PaymentInput[]) =>
    buildReceiptData({
      savedRaw,
      kind: posMode === "EXCHANGE" ? "EXCHANGE" : "SALE",
      cart,
      returns: posMode === "EXCHANGE" ? exchangeReturns : [],
      subtotal,
      discountTotal: discountAmount + cart.reduce((s, i) => s + (i.discountAmount ?? 0), 0),
      returnTotal,
      grandTotal,
      payments: payments.map((p) => ({ method: p.method, amount: p.amount })),
      customerName: customer?.name ?? undefined,
      customerPhone: customer?.phone ?? undefined,
      cashierName,
    });

  /**
   * Validates and saves the current transaction.
   * @returns the saved bill on success, or null on validation/network failure.
   */
  const save = async (
    payments: PaymentInput[],
    opts: { print: boolean }
  ): Promise<SessionBill | null> => {
    // ── Guard rails common to both modes ────────────────────────────────
    if (!customer?.id) {
      toast.error("Attach a customer before saving the transaction.");
      setActiveTab("CUSTOMER");
      return null;
    }

    // ── EXCHANGE ────────────────────────────────────────────────────────
    if (posMode === "EXCHANGE") {
      if (exchangeReturns.length === 0 || cart.length === 0) {
        toast.error("Exchange needs at least one returned item and one new item.");
        return null;
      }
      const mrpCheck = validateExchangeMrp(cart, exchangeReturns);
      if (!mrpCheck.ok) {
        toast.error(mrpCheck.reason || "Exchange MRP rule failed.");
        return null;
      }

      const payload = {
        originalSaleId: exchangeReturns[0].originalSaleId,
        customerId: customer.id,
        exchangeReason: "MRP Exchange",
        returnedItems: exchangeReturns.map((item) => ({
          variantId: item.variant.id,
          quantity: item.quantity,
        })),
        issuedItems: cart.map((item) => ({
          variantId: item.variant.id,
          quantity: item.quantity,
        })),
        payments: payments.map((p) => ({
          method: p.method,
          amount: p.amount,
          transactionRef: p.transactionRef,
        })),
      };

      try {
        const savedRaw = await exchangeMutation.mutateAsync(payload);
        const bill: SessionBill = {
          id: savedRaw?.id ?? crypto.randomUUID(),
          number: savedRaw?.exchangeNumber ?? "EXCHANGE",
          kind: "EXCHANGE",
          grandTotal,
          createdAt: savedRaw?.createdAt ?? new Date().toISOString(),
          raw: savedRaw,
        };
        recordBill(bill);
        if (opts.print) printReceipt(makeReceipt(savedRaw, payments));
        invalidate();
        toast.success(opts.print ? "Exchange saved & receipt sent to printer." : "Exchange saved.");
        clearCart();
        return bill;
      } catch (err: any) {
        toast.error(err.response?.data?.message || err.message || "Failed to save exchange.");
        return null;
      }
    }

    // ── SALE ────────────────────────────────────────────────────────────
    if (cart.length === 0) {
      toast.error("Scan at least one product before saving.");
      return null;
    }

    const items = cart.map((item) => ({
      variantId: item.variant.id,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    }));

    const totalLineDiscount = cart.reduce((s, i) => s + (i.discountAmount ?? 0), 0);
    const combinedDiscount = discountAmount + totalLineDiscount;

    try {
      const savedRaw = await checkoutMutation.mutateAsync({
        customer: { id: customer.id, phone: customer.phone, name: customer.name },
        items,
        payments,
        manualDiscountAmount: combinedDiscount > 0 ? combinedDiscount : undefined,
      });
      const bill: SessionBill = {
        id: savedRaw?.id ?? crypto.randomUUID(),
        number: savedRaw?.saleNumber ?? savedRaw?.number ?? "SALE",
        kind: "SALE",
        grandTotal,
        createdAt: savedRaw?.saleDate ?? savedRaw?.createdAt ?? new Date().toISOString(),
        raw: savedRaw,
      };
      recordBill(bill);
      if (opts.print) printReceipt(makeReceipt(savedRaw, payments));
      invalidate();
      toast.success(opts.print ? "Sale saved & receipt sent to printer." : "Sale saved.");
      clearCart();
      return bill;
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to save sale.");
      return null;
    }
  };

  return { save, isProcessing };
}
