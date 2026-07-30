/** Dead Stock (/admin/inventory/dead-stock). Thin binding over VelocityPage. */
import { VelocityPage } from "./VelocityPage";

export default function DeadStockPage() {
  return <VelocityPage bucket="DEAD_STOCK" />;
}
