import { CheckCircle2, Layers, Package, PackageX } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import type { CategorySummary } from "@/shared/category";

/**
 * ManagerCategoryOverview — operational counters for managers.
 *
 * Shows ONLY the non-financial figures the manager summary endpoint returns:
 * how the catalog is organised (total / active categories) and where products
 * sit (categorised, empty categories, uncategorized products). It never shows
 * revenue, margin or inventory value — the manager backend does not return
 * those fields, and category analytics is an owner-only screen.
 *
 * Clicking a card applies the matching filter, so these double as the fastest
 * route into a filtered list (e.g. "which categories are empty?").
 */
export function ManagerCategoryOverview({
  summary,
  isLoading,
  onFilter,
}: {
  summary: CategorySummary | undefined;
  isLoading?: boolean;
  onFilter?: (patch: { status?: string; hasProducts?: string }) => void;
}) {
  if (isLoading || !summary) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-6 w-12" />
          </Card>
        ))}
      </div>
    );
  }

  const cards = [
    {
      icon: Layers,
      label: "Categories",
      value: summary.total,
      hint: "in the catalog",
      filter: {} as const,
    },
    {
      icon: CheckCircle2,
      label: "Active",
      value: summary.active,
      hint: "available at checkout",
      accent: "text-emerald-600 dark:text-emerald-400",
      filter: { status: "ACTIVE" } as const,
    },
    {
      icon: Package,
      label: "Products categorised",
      value: summary.totalProducts,
      hint: "across all categories",
      filter: { hasProducts: "true" } as const,
    },
    {
      icon: PackageX,
      label: "Empty categories",
      value: summary.empty,
      hint:
        summary.uncategorized > 0
          ? `${summary.uncategorized} product${summary.uncategorized === 1 ? "" : "s"} uncategorized`
          : "every product has a category",
      accent: summary.empty > 0 ? "text-amber-600 dark:text-amber-400" : undefined,
      filter: { hasProducts: "false" } as const,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map(({ icon: Icon, label, value, hint, accent, filter }) => {
        const clickable = !!onFilter;
        return (
          <Card
            key={label}
            {...(clickable
              ? {
                  role: "button",
                  tabIndex: 0,
                  onClick: () => onFilter({ status: "", hasProducts: "", ...filter }),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onFilter({ status: "", hasProducts: "", ...filter });
                    }
                  },
                }
              : {})}
            className={`p-3 ${clickable ? "cursor-pointer transition-colors hover:bg-accent/50" : ""}`}
          >
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon className={`h-3.5 w-3.5 ${accent ?? ""}`} />
              {label}
            </div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent ?? ""}`}>
              {value.toLocaleString("en-IN")}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
          </Card>
        );
      })}
    </div>
  );
}
