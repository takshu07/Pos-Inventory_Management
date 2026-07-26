import { ImageOff } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/utils/cn";
import type { ProductRow } from "../types";
import { formatSellingRange } from "../utils";
import { ProductStatusBadge } from "./ProductStatusBadge";
import { ProductStockIndicator } from "./ProductStockIndicator";

/**
 * ProductCard — grid/card presentation of a product row. Read-only and RBAC-
 * agnostic: it renders only non-financial fields (name, brand/category, selling
 * price range, stock), so it is identical for owner and manager. Clicking it
 * opens the details drawer via the caller's onClick.
 */
export function ProductCard({
  product,
  onClick,
  className,
}: {
  product: ProductRow;
  onClick?: (product: ProductRow) => void;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "flex flex-col overflow-hidden p-0 transition-shadow hover:shadow-md",
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick ? () => onClick(product) : undefined}
    >
      <div className="aspect-square w-full bg-muted/20 flex items-center justify-center overflow-hidden">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <ImageOff className="h-8 w-8 text-muted-foreground" />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium leading-tight line-clamp-2">{product.name}</h3>
          {!product.isActive && <ProductStatusBadge isActive={false} />}
        </div>

        <div className="text-xs text-muted-foreground">
          {product.brand?.name ?? "No brand"} · {product.category?.name ?? "Uncategorized"}
        </div>

        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="font-semibold">{formatSellingRange(product)}</span>
          <ProductStockIndicator status={product.stockStatus} totalStock={product.totalStock} />
        </div>

        {product.variantCount > 0 && (
          <div className="text-[11px] text-muted-foreground">
            {product.variantCount} variant{product.variantCount === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </Card>
  );
}
