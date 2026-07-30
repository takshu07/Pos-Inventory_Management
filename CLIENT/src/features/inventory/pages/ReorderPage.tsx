/** Reorder Centre (/admin/inventory/reorder). Thin binding over ReplenishmentPage. */
import { ReplenishmentPage } from "./ReplenishmentPage";

export default function ReorderPage() {
  return <ReplenishmentPage variant="reorder" />;
}
