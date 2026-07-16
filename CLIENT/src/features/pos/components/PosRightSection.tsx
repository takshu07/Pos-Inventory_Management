import { useState } from "react";
import { ShoppingCart, Percent, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { usePosStore, usePosTotals } from "../store/usePosStore";
import { CartItem } from "./CartItem";
import { PaymentModal } from "./PaymentModal";
import { formatCurrency } from "../utils/pos.utils";
import { useCheckout } from "../api/pos.api";
import { useCreateExchange } from "@/features/exchange/hooks/useExchange";
import { ExchangeScanner } from "./ExchangeScanner";
import { CheckCircle2 } from "lucide-react";


export function PosRightSection() {
  const queryClient = useQueryClient();
  const { cart, updateQuantity, removeItem, clearCart, customer, unstartSession, setCheckoutStep, posMode, exchangeReturns, removeExchangeReturn } = usePosStore();
  const { subtotal, discountAmount, saleTotal, returnTotal, grandTotal } = usePosTotals();
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);

  const checkoutMutation = useCheckout();
  const exchangeMutation = useCreateExchange();

  const handleCompleteSale = (payments: { method: string; amount: number; transactionRef?: string }[]) => {
    if (posMode === "EXCHANGE") {
      if (exchangeReturns.length === 0 || cart.length === 0) {
        toast.error("Exchange requires at least one returned item and one replacement item.");
        return;
      }
      
      const payload = {
        originalSaleId: exchangeReturns[0].originalSaleId, // We assume all returns from same sale for now
        customerId: customer!.id!,
        exchangeReason: "MRP Exchange",
        returnedItems: exchangeReturns.map(item => ({
          variantId: item.variant.id,
          quantity: item.quantity,
          condition: "GOOD" // Assumed good for MRP exchange shortcut
        })),
        issuedItems: cart.map(item => ({
          variantId: item.variant.id,
          quantity: item.quantity
        })),
        payments: payments.map(p => ({
          method: p.method,
          amount: p.amount,
          transactionRef: p.transactionRef
        }))
      };

      exchangeMutation.mutate(payload, {
        onSuccess: () => {
          toast.success("Exchange completed successfully!");
          setIsPaymentOpen(false);
          setCheckoutStep(3);
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          queryClient.invalidateQueries({ queryKey: ["analytics"] });
          queryClient.invalidateQueries({ queryKey: ["sales"] });
          queryClient.invalidateQueries({ queryKey: ["customers"] });
        },
        onError: (err: any) => {
          toast.error(err.response?.data?.message || err.message || "Failed to complete exchange");
        }
      });
      return;
    }

    // Normal Sale Logic
    const items = cart.map(item => ({
      variantId: item.variant.id,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    }));

    // Build customer payload
    let customerPayload = undefined;
    if (customer && customer.phone) {
      if (!customer.id && !customer.name?.trim()) {
        toast.error("Please enter a Customer Name for new customers.");
        return;
      }
      customerPayload = {
        id: customer.id,
        phone: customer.phone,
        name: customer.name,
      };
    }

    checkoutMutation.mutate(
      {
        customer: customerPayload,
        items,
        payments,
        // If manual discount was implemented, we'd pass it here
        manualDiscountAmount: discountAmount > 0 ? discountAmount : undefined,
      },
      {
        onSuccess: () => {
          toast.success("Sale completed successfully!");
          setIsPaymentOpen(false);
          setCheckoutStep(3);
          
          // Invalidate dashboard queries to automatically refresh analytics
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          queryClient.invalidateQueries({ queryKey: ["analytics"] });
          queryClient.invalidateQueries({ queryKey: ["sales"] });
          queryClient.invalidateQueries({ queryKey: ["customers"] }); // Ensure new customers are fetchable
        },
        onError: (err: any) => {
          toast.error(err.response?.data?.message || err.message || "Failed to complete sale");
          // Keep modal open so cashier can fix errors
        }
      }
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Customer Display Section */}
      <div className="p-4 border-b bg-muted/10 shrink-0 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
            Customer
          </span>
          {customer ? (
            <div className="flex flex-col">
              <span className="font-semibold">{customer.name || "Unknown"}</span>
              <span className="text-xs text-muted-foreground">{customer.phone}</span>
            </div>
          ) : (
            <span className="font-semibold text-muted-foreground">Walk-in Customer</span>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-muted/10 shrink-0">
        <div className="flex items-center gap-2 font-semibold">
          <ShoppingCart className="h-5 w-5" />
          <span>Current Cart</span>
          <span className="ml-2 bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full">
            {cart.length}
          </span>
        </div>
        {cart.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearCart} className="text-muted-foreground hover:text-destructive h-8">
            <Trash2 className="h-4 w-4 mr-2" />
            Clear
          </Button>
        )}
      </div>

      {/* Cart Items */}
      <div className="flex-1 overflow-y-auto">
        {cart.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-60">
            <ShoppingCart className="h-12 w-12 mb-4" />
            <p>Cart is empty</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {cart.map((item) => (
              <CartItem
                key={item.cartItemId}
                item={item}
                onUpdateQuantity={updateQuantity}
                onRemove={removeItem}
              />
            ))}
          </div>
        )}
      </div>

      {/* Exchange Mode Toggle */}
      <div className="border-t bg-muted/10 shrink-0 p-3 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">Exchange at MRP</span>
          <span className="text-xs text-muted-foreground">{posMode === 'EXCHANGE' ? 'Mode ON' : 'Mode OFF'}</span>
        </div>
        <Button 
          type="button"
          variant={posMode === 'EXCHANGE' ? 'default' : 'outline'}
          size="sm"
          className={posMode === 'EXCHANGE' ? 'bg-orange-600 hover:bg-orange-700 text-white' : ''}
          onClick={() => {
            const usePosStoreAPI = usePosStore.getState();
            usePosStoreAPI.setPosMode(posMode === "SALE" ? "EXCHANGE" : "SALE");
          }}
        >
          {posMode === 'EXCHANGE' ? 'Turn Off' : 'Enable'}
        </Button>
      </div>

      {posMode === "EXCHANGE" && (
        <div className="border-t overflow-y-auto flex flex-col min-h-[120px] max-h-[250px] bg-orange-500/5">
          <div className="p-3 border-b border-orange-500/10 shrink-0">
            <span className="text-xs font-bold text-orange-600 uppercase">Exchange Item</span>
          </div>
          <div className="p-3 shrink-0">
            <ExchangeScanner />
          </div>
          
          <div className="flex-col flex px-3 pb-3">
            {exchangeReturns.map(item => (
              <div key={item.cartItemId} className="flex flex-col p-2 border border-orange-500/20 rounded mb-2 bg-background">
                <div className="flex justify-between items-start">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">{item.variant.product?.name}</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">Returned Product</span>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeExchangeReturn(item.cartItemId)} className="h-6 w-6 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 flex justify-between items-center">
                  <span className="text-xs font-medium">MRP {formatCurrency(item.mrp)}</span>
                </div>
                <div className="mt-3 pt-2 border-t border-orange-500/10 flex flex-col gap-1 text-[10px] text-green-600 dark:text-green-500">
                  <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Within 3 Days</div>
                  <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Same Customer</div>
                  <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Not Exchanged</div>
                  <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Eligible</div>
                </div>
              </div>
            ))}
            {exchangeReturns.length === 0 && (
              <div className="text-center py-4 text-xs text-muted-foreground">
                No items returned yet
              </div>
            )}
          </div>
        </div>
      )}

      {/* Totals & Action */}
      <div className="border-t bg-muted/5 shrink-0 p-4 flex flex-col gap-3">
        
        {/* Discount Toggle (Stub) */}
        <div className="flex items-center justify-between py-1 text-sm text-muted-foreground">
          <button className="flex items-center gap-1.5 hover:text-primary transition-colors">
            <Percent className="h-4 w-4" />
            Add Discount
          </button>
          <span>{discountAmount > 0 ? `-${formatCurrency(discountAmount)}` : "—"}</span>
        </div>

        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-medium">{formatCurrency(subtotal)}</span>
        </div>
        
        <div className="border-t border-dashed my-1"></div>

        {posMode === "EXCHANGE" && (
          <>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Returned Value</span>
              <span className="font-medium text-red-500">-{formatCurrency(returnTotal)}</span>
            </div>
            <div className="border-t border-dashed my-1"></div>
          </>
        )}

        <div className="flex justify-between items-center text-lg font-bold">
          <span>{posMode === "EXCHANGE" ? "Difference" : "Total"}</span>
          <span className="text-primary">{formatCurrency(grandTotal)}</span>
        </div>

        <Button
          size="lg"
          className="w-full mt-2 h-14 text-lg font-semibold shadow-md"
          disabled={cart.length === 0 && exchangeReturns.length === 0}
          onClick={() => {
            if (grandTotal > 0) {
              setIsPaymentOpen(true);
            } else {
              handleCompleteSale([]);
            }
            setCheckoutStep(2);
          }}
        >
          {grandTotal > 0 ? "Checkout" : "Complete Exchange"}
        </Button>
      </div>

      <PaymentModal
        open={isPaymentOpen}
        onClose={() => {
          if (!checkoutMutation.isPending && !exchangeMutation.isPending) {
            setIsPaymentOpen(false);
            setCheckoutStep(1);
          }
        }}
        grandTotal={grandTotal}
        onConfirm={handleCompleteSale}
        isProcessing={checkoutMutation.isPending || exchangeMutation.isPending}
      />
    </div>
  );
}
