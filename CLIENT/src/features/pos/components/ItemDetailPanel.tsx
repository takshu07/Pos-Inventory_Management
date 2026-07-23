import { useMemo } from "react";
import { Input } from "@/components/ui";
import { useShallow } from "zustand/react/shallow";
import { usePosStore } from "../store/usePosStore";
import { formatCurrency } from "../utils/pos.utils";

/**
 * Right-side detail fields that autofill after a product is scanned/selected.
 * Quantity and discount are editable and flow back into the cart line.
 */
export function ItemDetailPanel() {
  const { cart, selectedCartItemId, updateQuantity, updateItemDiscount } = usePosStore(
    useShallow((s) => ({
      cart: s.cart,
      selectedCartItemId: s.selectedCartItemId,
      updateQuantity: s.updateQuantity,
      updateItemDiscount: s.updateItemDiscount,
    }))
  );

  const item = useMemo(
    () => cart.find((i) => i.cartItemId === selectedCartItemId) ?? null,
    [cart, selectedCartItemId]
  );

  if (!item) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Autofills after a product is scanned.
      </div>
    );
  }

  const gross = item.quantity * item.unitPrice;
  const discountPct =
    item.discount?.type === "PERCENTAGE" ? item.discount.value : gross > 0 ? ((item.discountAmount ?? 0) / gross) * 100 : 0;

  return (
    <div className="rounded-lg border p-4 flex flex-col gap-3 bg-muted/10">
      <div>
        <div className="font-semibold leading-tight">{item.variant.product.name}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {[item.variant.size?.name, item.variant.color?.name].filter(Boolean).join(" · ")}
          {item.variant.sku ? ` · SKU ${item.variant.sku}` : ""}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Quantity"
          type="number"
          min={1}
          max={item.variant.currentStock}
          value={item.quantity}
          onChange={(e) => updateQuantity(item.cartItemId, Math.max(1, Number(e.target.value) || 1))}
          className="h-10"
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">MRP</label>
          <div className="h-10 flex items-center px-3 rounded-md border bg-muted/30 text-sm">
            {formatCurrency(Number(item.variant.mrp))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Discount (%)"
          type="number"
          min={0}
          max={100}
          value={Number(discountPct.toFixed(2))}
          onChange={(e) => {
            const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
            updateItemDiscount(item.cartItemId, v ? { type: "PERCENTAGE", value: v } : undefined);
          }}
          className="h-10"
        />
        <Input
          label="Discount (₹)"
          type="number"
          min={0}
          value={Number((item.discountAmount ?? 0).toFixed(2))}
          onChange={(e) => {
            const v = Math.max(0, Number(e.target.value) || 0);
            updateItemDiscount(item.cartItemId, v ? { type: "FIXED", value: v } : undefined);
          }}
          className="h-10"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Final amount</label>
        <div className="h-11 flex items-center px-3 rounded-md border bg-primary/5 text-lg font-bold text-primary">
          {formatCurrency(item.lineTotal)}
        </div>
      </div>
    </div>
  );
}
