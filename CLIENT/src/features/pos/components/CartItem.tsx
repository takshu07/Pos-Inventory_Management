import { Plus, Minus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { formatCurrency } from "../utils/pos.utils";
import type { CartItem as CartItemType } from "../types/pos.types";

interface CartItemProps {
  item: CartItemType;
  onUpdateQuantity: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
}

export function CartItem({ item, onUpdateQuantity, onRemove }: CartItemProps) {
  const { cartItemId, variant, quantity, lineTotal } = item;

  return (
    <div className="flex flex-col gap-2 p-3 border-b border-border/50 bg-background hover:bg-muted/10 transition-colors">
      <div className="flex justify-between items-start">
        <div className="flex flex-col">
          <span className="font-medium text-sm leading-tight text-foreground line-clamp-1">
            {variant.product.name}
          </span>
          <span className="text-xs text-muted-foreground mt-0.5">
            {variant.size?.name} {variant.color ? `· ${variant.color.name}` : ""}
          </span>
          <span className="text-xs text-muted-foreground">SKU: {variant.sku}</span>
        </div>
        <div className="text-right">
          <div className="font-semibold text-sm">{formatCurrency(lineTotal)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {formatCurrency(item.unitPrice)} each
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center border rounded-md overflow-hidden bg-background">
          <button
            type="button"
            className="px-2 py-1 hover:bg-muted active:bg-muted/80 disabled:opacity-50 transition-colors"
            onClick={() => onUpdateQuantity(cartItemId, quantity - 1)}
            disabled={quantity <= 1}
            aria-label="Decrease quantity"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <div className="w-10 text-center text-sm font-medium border-x border-border/50">
            {quantity}
          </div>
          <button
            type="button"
            className="px-2 py-1 hover:bg-muted active:bg-muted/80 disabled:opacity-50 transition-colors"
            onClick={() => onUpdateQuantity(cartItemId, quantity + 1)}
            disabled={quantity >= variant.currentStock}
            aria-label="Increase quantity"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={() => onRemove(cartItemId)}
          aria-label="Remove item"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
