import { Badge } from "@/components/ui";
import type { CategoryStatus } from "../types";

/**
 * CategoryStatusBadge — one visual vocabulary for category lifecycle, used by
 * the table, cards, drawer header and bulk toolbar. Defined once so ARCHIVED is
 * never amber in one place and grey in another.
 */

const VARIANT: Record<
  CategoryStatus,
  "default" | "success" | "warning" | "destructive" | "secondary" | "outline"
> = {
  ACTIVE: "success",
  INACTIVE: "warning",
  ARCHIVED: "secondary",
};

const LABEL: Record<CategoryStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ARCHIVED: "Archived",
};

export function CategoryStatusBadge({ status }: { status: CategoryStatus }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}

export { LABEL as CATEGORY_STATUS_LABEL };
