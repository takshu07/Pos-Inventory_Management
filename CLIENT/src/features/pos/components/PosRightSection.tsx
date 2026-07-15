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


export function PosRightSection() {
  const queryClient = useQueryClient();
  const { cart, updateQuantity, removeItem, clearCart, customer, unstartSession, setCheckoutStep } = usePosStore();
  const { subtotal, discountAmount, grandTotal } = usePosTotals();
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);

  const checkoutMutation = useCheckout();

  const handleCompleteSale = (payments: { method: string; amount: number; transactionRef?: string }[]) => {
    // Transform cart into payload shape
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
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={unstartSession} 
          className="text-xs h-8 text-muted-foreground hover:text-foreground"
        >
          Change
        </Button>
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

        <div className="flex justify-between items-center text-lg font-bold">
          <span>Total</span>
          <span className="text-primary">{formatCurrency(grandTotal)}</span>
        </div>

        <Button
          size="lg"
          className="w-full mt-2 h-14 text-lg font-semibold shadow-md"
          disabled={cart.length === 0}
          onClick={() => {
            setIsPaymentOpen(true);
            setCheckoutStep(2);
          }}
        >
          Checkout
        </Button>
      </div>

      <PaymentModal
        open={isPaymentOpen}
        onClose={() => {
          if (!checkoutMutation.isPending) {
            setIsPaymentOpen(false);
            setCheckoutStep(1);
          }
        }}
        grandTotal={grandTotal}
        onConfirm={handleCompleteSale}
        isProcessing={checkoutMutation.isPending}
      />
    </div>
  );
}
