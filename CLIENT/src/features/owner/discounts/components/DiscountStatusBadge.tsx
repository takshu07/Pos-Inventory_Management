import { Badge } from "@/components/ui";
import type { DiscountStatus } from "../api/discountApi";

/**
 * Status is DERIVED server-side from (isEnabled, startDate, endDate) — the
 * client never computes it. Rendering it from a client clock would drift from
 * the store timezone the backend uses and show "active" on an expired rule.
 */
const STATUS_META: Record<DiscountStatus, { label: string; variant: "success" | "info" | "secondary" | "warning" | "outline" }> = {
  ACTIVE:    { label: "Active",    variant: "success" },
  SCHEDULED: { label: "Scheduled", variant: "info" },
  EXPIRED:   { label: "Expired",   variant: "secondary" },
  DISABLED:  { label: "Disabled",  variant: "outline" },
  DRAFT:     { label: "Draft",     variant: "warning" },
};

export function DiscountStatusBadge({ status }: { status: DiscountStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.DRAFT;
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
