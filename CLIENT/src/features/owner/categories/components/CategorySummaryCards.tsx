import {
  Archive,
  CheckCircle2,
  FolderTree,
  PackageX,
  PauseCircle,
  Package,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { CategorySummarySkeleton, type CategorySummary } from "@/shared/category";

/**
 * CategorySummaryCards — the dashboard's headline counters.
 *
 * Each card is also a FILTER: clicking "Archived" filters the table to archived
 * categories rather than merely reporting a number. A dashboard tile the user
 * cannot act on is decoration.
 *
 * "Uncategorized products" counts products whose category is not active — the
 * FK is non-nullable, so a product with no category at all cannot exist.
 */
export function CategorySummaryCards({
  summary,
  isLoading,
  activeFilter,
  onFilter,
}: {
  summary: CategorySummary | undefined;
  isLoading: boolean;
  activeFilter?: string;
  onFilter?: (filter: { status?: string; hasProducts?: string; includeArchived?: string }) => void;
}) {
  if (isLoading || !summary) return <CategorySummarySkeleton />;

  const cards = [
    {
      key: "all",
      label: "Total Categories",
      value: summary.total,
      icon: FolderTree,
      tone: "text-primary",
      filter: {},
    },
    {
      key: "ACTIVE",
      label: "Active",
      value: summary.active,
      icon: CheckCircle2,
      tone: "text-emerald-600 dark:text-emerald-400",
      filter: { status: "ACTIVE" },
    },
    {
      key: "INACTIVE",
      label: "Inactive",
      value: summary.inactive,
      icon: PauseCircle,
      tone: "text-amber-600 dark:text-amber-400",
      filter: { status: "INACTIVE" },
    },
    {
      key: "ARCHIVED",
      label: "Archived",
      value: summary.archived,
      icon: Archive,
      tone: "text-muted-foreground",
      filter: { status: "ARCHIVED", includeArchived: "true" },
    },
    {
      key: "products",
      label: "Total Products",
      value: summary.totalProducts,
      icon: Package,
      tone: "text-primary",
      filter: { hasProducts: "true" },
    },
    {
      key: "uncategorized",
      label: "Uncategorized",
      value: summary.uncategorized,
      icon: PackageX,
      tone: summary.uncategorized > 0 ? "text-destructive" : "text-muted-foreground",
      hint: "In an inactive or archived category",
      filter: {},
    },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((c) => {
        const Icon = c.icon;
        const isActive = activeFilter === c.key;
        const clickable = !!onFilter;

        return (
          <button
            key={c.key}
            type="button"
            disabled={!clickable}
            onClick={() => onFilter?.(c.filter)}
            title={"hint" in c ? c.hint : undefined}
            className={cn(
              "rounded-lg border p-4 text-left transition-all",
              clickable && "hover:border-primary/50 hover:shadow-sm",
              isActive ? "border-primary bg-primary/5" : "border-border",
              !clickable && "cursor-default"
            )}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
              <Icon className={cn("h-4 w-4", c.tone)} />
            </div>
            <div className="text-2xl font-semibold tabular-nums">
              {c.value.toLocaleString("en-IN")}
            </div>
            {"hint" in c && c.value > 0 && (
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{c.hint}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
