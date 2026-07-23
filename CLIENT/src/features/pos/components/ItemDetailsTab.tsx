import { CheckCircle2, Repeat, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useShallow } from "zustand/react/shallow";
import { usePosStore } from "../store/usePosStore";
import { formatCurrency } from "../utils/pos.utils";
import { ItemCartTable } from "./ItemCartTable";
import { ItemDetailPanel } from "./ItemDetailPanel";
import { ItemScanner } from "./ItemScanner";
import { ExchangeScanner } from "./ExchangeScanner";

/**
 * Item details screen. Left: the running bill table. Right: scan box, the
 * exchange-at-MRP toggle, the returned-items list, and the autofill detail panel.
 * Saving happens from the toolbar (Save only / Save & Print).
 */
export function ItemDetailsTab() {
  const { posMode, setPosMode, exchangeReturns, removeExchangeReturn } = usePosStore(
    useShallow((s) => ({
      posMode: s.posMode,
      setPosMode: s.setPosMode,
      exchangeReturns: s.exchangeReturns,
      removeExchangeReturn: s.removeExchangeReturn,
    }))
  );
  const isExchange = posMode === "EXCHANGE";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(340px,400px)] h-full min-h-0 divide-y lg:divide-y-0 lg:divide-x">
      {/* LEFT — running bill */}
      <div className="min-h-0 flex flex-col">
        <ItemCartTable />
      </div>

      {/* RIGHT — scan + controls */}
      <div className="min-h-0 overflow-y-auto p-4 flex flex-col gap-4 bg-muted/5">
        <div>
          <label className="text-sm font-semibold mb-2 block">Item code</label>
          <ItemScanner />
        </div>

        {/* Exchange at MRP toggle */}
        <div className="rounded-lg border p-3 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-semibold flex items-center gap-1.5">
              <Repeat className="h-4 w-4" /> Exchange at MRP
            </span>
            <span className="text-xs text-muted-foreground">
              {isExchange ? "On — scan the previously bought item" : "Off"}
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            variant={isExchange ? "default" : "outline"}
            className={isExchange ? "bg-orange-600 hover:bg-orange-700 text-white" : ""}
            onClick={() => setPosMode(isExchange ? "SALE" : "EXCHANGE")}
          >
            {isExchange ? "Turn off" : "Enable"}
          </Button>
        </div>

        {isExchange && (
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 flex flex-col gap-3">
            <span className="text-xs font-bold uppercase text-orange-600">Exchange item</span>
            <ExchangeScanner />
            {exchangeReturns.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-2">No items returned yet.</div>
            ) : (
              exchangeReturns.map((item) => (
                <div key={item.cartItemId} className="rounded border border-orange-500/20 bg-background p-2">
                  <div className="flex items-start justify-between">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{item.variant.product?.name}</span>
                      <span className="text-[10px] text-muted-foreground">Returned · MRP {formatCurrency(item.mrp)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeExchangeReturn(item.cartItemId)}
                      className="text-muted-foreground hover:text-destructive p-1"
                      aria-label="Remove returned item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-green-600">
                    <CheckCircle2 className="w-3 h-3" /> Eligible for exchange
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Autofill detail fields for the selected line */}
        <ItemDetailPanel />
      </div>
    </div>
  );
}
