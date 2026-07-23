import { Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { usePosStore, usePosTotals } from "../store/usePosStore";
import { formatCurrency } from "../utils/pos.utils";

/**
 * The item table on the left of the Item details screen. Columns follow the
 * design: s.no · item_code · qty · mrp · disc · final_price · colour · size · sku.
 * Clicking a row selects it for the right-hand detail/autofill panel.
 */
export function ItemCartTable() {
  const { cart, selectedCartItemId, setSelectedCartItem, removeItem } = usePosStore(
    useShallow((s) => ({
      cart: s.cart,
      selectedCartItemId: s.selectedCartItemId,
      setSelectedCartItem: s.setSelectedCartItem,
      removeItem: s.removeItem,
    }))
  );
  const { subtotal, discountAmount, grandTotal, returnTotal, saleTotal } = usePosTotals();
  const lineDiscount = cart.reduce((s, i) => s + (i.discountAmount ?? 0), 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-muted/60 backdrop-blur text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">S.No</th>
              <th className="text-left px-3 py-2 font-semibold">Item code</th>
              <th className="text-right px-3 py-2 font-semibold">Qty</th>
              <th className="text-right px-3 py-2 font-semibold">MRP</th>
              <th className="text-right px-3 py-2 font-semibold">Disc</th>
              <th className="text-right px-3 py-2 font-semibold">Final price</th>
              <th className="text-left px-3 py-2 font-semibold">Colour</th>
              <th className="text-left px-3 py-2 font-semibold">Size</th>
              <th className="text-left px-3 py-2 font-semibold">SKU</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {cart.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-16 text-muted-foreground">
                  Scan a product to start filling the bill.
                </td>
              </tr>
            ) : (
              cart.map((item, idx) => {
                const selected = item.cartItemId === selectedCartItemId;
                return (
                  <tr
                    key={item.cartItemId}
                    onClick={() => setSelectedCartItem(item.cartItemId)}
                    className={`border-b cursor-pointer transition-colors ${
                      selected ? "bg-primary/10" : "hover:bg-muted/30"
                    }`}
                  >
                    <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                    <td className="px-3 py-2 font-medium">
                      <div className="line-clamp-1">{item.variant.product.name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {item.variant.barcode || "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">{item.quantity}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(Number(item.variant.mrp))}</td>
                    <td className="px-3 py-2 text-right">
                      {item.discountAmount ? `-${formatCurrency(item.discountAmount)}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{formatCurrency(item.lineTotal)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{item.variant.color?.name || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{item.variant.size?.name || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{item.variant.sku}</td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeItem(item.cartItemId);
                        }}
                        className="text-muted-foreground hover:text-destructive p-1"
                        aria-label="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Totals footer */}
      <div className="border-t bg-muted/20 px-4 py-3 shrink-0 flex flex-col gap-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-medium">{formatCurrency(subtotal)}</span>
        </div>
        {(discountAmount > 0 || lineDiscount > 0) && (
          <div className="flex justify-between text-sm text-emerald-600">
            <span>Discount</span>
            <span>-{formatCurrency(discountAmount)}</span>
          </div>
        )}
        {returnTotal > 0 && (
          <div className="flex justify-between text-sm text-red-500">
            <span>Returned value</span>
            <span>-{formatCurrency(returnTotal)}</span>
          </div>
        )}
        <div className="flex justify-between items-center text-lg font-bold pt-1 border-t border-dashed mt-1">
          <span>{returnTotal > 0 ? "Amount due" : "Total"}</span>
          <span className="text-primary">{formatCurrency(returnTotal > 0 ? grandTotal : saleTotal)}</span>
        </div>
      </div>
    </div>
  );
}
