import { FolderTree, SearchX } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * CategoryEmptyState — distinguishes the two empty cases, because they need
 * opposite actions:
 *
 *   • no categories exist        → offer to create the first one
 *   • filters matched nothing    → offer to clear the filters
 *
 * Showing "Create your first category" to someone who simply mistyped a search
 * is the classic version of this mistake.
 */
export function CategoryEmptyState({
  hasFilters,
  canCreate,
  onCreate,
  onClearFilters,
}: {
  hasFilters: boolean;
  canCreate: boolean;
  onCreate?: () => void;
  onClearFilters?: () => void;
}) {
  if (hasFilters) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <SearchX className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold text-foreground">No categories match your filters</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Try a different search term, or clear the filters to see the full catalog.
        </p>
        {onClearFilters && (
          <Button variant="outline" className="mt-6" onClick={onClearFilters}>
            Clear all filters
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <FolderTree className="h-8 w-8 text-primary" />
      </div>
      <h3 className="text-base font-semibold text-foreground">No categories found</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Categories organise your catalog and power pricing rules, reporting and
        inventory insights.
      </p>
      {canCreate && onCreate && (
        <Button className="mt-6" onClick={onCreate}>
          Create first category
        </Button>
      )}
    </div>
  );
}
