import { Badge } from "@/components/ui/Badge";

/**
 * ProductStatusBadge — active/inactive (archived) state.
 * Shared by both modules so status reads identically everywhere.
 */
export function ProductStatusBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <Badge variant="success">Active</Badge>
  ) : (
    <Badge variant="secondary">Archived</Badge>
  );
}
