import { PackageSearch } from "lucide-react";
import { EmptyState } from "@/components/ui/StateViews";

/**
 * ProductEmptyState — shown when a catalog query returns nothing. The optional
 * action (e.g. owner "Add product" or "Clear filters") is supplied by the caller
 * so the same empty state serves both modules.
 */
export function ProductEmptyState({
  filtered,
  action,
}: {
  filtered?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <EmptyState
      icon={<PackageSearch className="h-8 w-8 text-muted-foreground" />}
      title={filtered ? "No products match your filters" : "No products yet"}
      description={
        filtered
          ? "Try adjusting or clearing your search and filters."
          : "Products you add will appear here."
      }
      {...(action ? { action } : {})}
    />
  );
}
