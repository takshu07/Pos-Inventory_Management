/** Low Stock (/admin/inventory/low-stock). Thin binding over ReplenishmentPage. */
import { ReplenishmentPage } from "./ReplenishmentPage";

export default function LowStockPage() {
  return <ReplenishmentPage variant="low-stock" />;
}
