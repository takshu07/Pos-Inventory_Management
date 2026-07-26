import { Badge } from "@/components/ui/Badge";
import { AlertTriangle, PackageX, PackageCheck } from "lucide-react";
import type { StockStatus } from "../types";
import { STOCK_STATUS_BADGE, STOCK_STATUS_LABEL } from "../utils";

const ICONS: Record<StockStatus, React.ElementType> = {
  IN_STOCK: PackageCheck,
  LOW_STOCK: AlertTriangle,
  OUT_OF_STOCK: PackageX,
};

/**
 * ProductStockIndicator — a stock-status badge with the running unit count.
 * Highlights Low Stock / Out of Stock per the spec. Used across owner + manager
 * tables, cards, and the details drawer.
 */
export function ProductStockIndicator({
  status,
  totalStock,
  showCount = true,
}: {
  status: StockStatus;
  totalStock?: number;
  showCount?: boolean;
}) {
  const Icon = ICONS[status];
  return (
    <Badge variant={STOCK_STATUS_BADGE[status]} className="gap-1">
      <Icon className="h-3 w-3" />
      {STOCK_STATUS_LABEL[status]}
      {showCount && totalStock !== undefined && (
        <span className="opacity-70">· {totalStock}</span>
      )}
    </Badge>
  );
}
