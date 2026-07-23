import { useExchangeStore } from "../store/useExchangeStore";
import { formatCurrency } from "@/features/pos/utils/pos.utils";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface ReturnedItemsTableProps {
  items: any[];
}

export function ReturnedItemsTable({ items }: ReturnedItemsTableProps) {
  const { returnedItems, setReturnQuantity } = useExchangeStore();

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const selected = returnedItems.find(i => i.variantId === item.variantId);
        const currentQty = selected?.quantity || 0;
        const unitPricePaid = Number(item.totalPrice) / item.quantity;

        return (
          <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg bg-card">
            <div className="flex flex-col flex-1">
              <span className="font-medium text-sm line-clamp-1" title={item.productName}>
                {item.productName}
              </span>
              <span className="text-xs text-muted-foreground mt-0.5">
                {item.sizeName} • {item.colorName} | SKU: {item.sku}
              </span>
              <span className="text-xs font-semibold text-primary mt-1">
                {formatCurrency(unitPricePaid)} paid
              </span>
            </div>
            
            <div className="flex flex-col items-end gap-2 ml-4">
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                Max: {item.quantity}
              </span>
              <div className="flex items-center gap-2 bg-muted/50 rounded-md p-1">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-6 w-6" 
                  onClick={() => setReturnQuantity(item.variantId, currentQty - 1, item.quantity, unitPricePaid, selected?.condition || "GOOD")}
                  disabled={currentQty <= 0}
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="w-4 text-center text-sm font-medium">{currentQty}</span>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-6 w-6" 
                  onClick={() => setReturnQuantity(item.variantId, currentQty + 1, item.quantity, unitPricePaid, selected?.condition || "GOOD")}
                  disabled={currentQty >= item.quantity}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              {currentQty > 0 && (
                <select 
                  className="text-xs bg-background border rounded px-1 py-0.5 mt-1 outline-none"
                  value={selected?.condition || "GOOD"}
                  onChange={(e) => setReturnQuantity(item.variantId, currentQty, item.quantity, unitPricePaid, e.target.value as "GOOD" | "DAMAGED")}
                >
                  <option value="GOOD">Good</option>
                  <option value="DAMAGED">Damaged</option>
                </select>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
