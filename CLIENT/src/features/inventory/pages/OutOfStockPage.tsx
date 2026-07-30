/** Out of Stock (/admin/inventory/out-of-stock). Thin binding over ReplenishmentPage. */
import { ReplenishmentPage } from "./ReplenishmentPage";

export default function OutOfStockPage() {
  return <ReplenishmentPage variant="out-of-stock" />;
}
