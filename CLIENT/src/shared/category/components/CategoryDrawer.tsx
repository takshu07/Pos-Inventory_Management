import { Suspense, lazy, useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { Drawer } from "@/components/ui";
import { cn } from "@/utils/cn";
import type { CategoryRow } from "../types";
import { CategoryStatusBadge } from "./CategoryStatusBadge";
import { CategoryDetailSkeleton } from "./CategorySkeleton";
import { CategoryOverviewTab } from "./tabs/CategoryOverviewTab";
import { CategoryProductsTab } from "./tabs/CategoryProductsTab";

/**
 * CategoryDrawer — the details panel.
 *
 * Opens over the table without navigation, so the user never loses their page,
 * scroll position or filters.
 *
 * TAB LOADING: Overview and Products are imported eagerly (they are the default
 * view and the most-used tab). Discounts, Analytics and Activity are lazy —
 * they are owner-only, individually heavy (Analytics pulls in Recharts), and
 * most drawer opens never touch them. Each tab also fetches its own data only
 * once selected, so opening the drawer costs exactly one request.
 */

const CategoryDiscountTab = lazy(() =>
  import("./tabs/CategoryDiscountTab").then((m) => ({ default: m.CategoryDiscountTab }))
);
const CategoryAnalyticsTab = lazy(() =>
  import("./tabs/CategoryAnalyticsTab").then((m) => ({ default: m.CategoryAnalyticsTab }))
);
const CategoryActivityTab = lazy(() =>
  import("./tabs/CategoryActivityTab").then((m) => ({ default: m.CategoryActivityTab }))
);

export type CategoryDrawerTab = "overview" | "products" | "discounts" | "analytics" | "activity";

const ALL_TABS: { key: CategoryDrawerTab; label: string; ownerOnly?: boolean }[] = [
  { key: "overview", label: "Overview" },
  { key: "products", label: "Products" },
  { key: "discounts", label: "Discounts", ownerOnly: true },
  { key: "analytics", label: "Analytics", ownerOnly: true },
  { key: "activity", label: "Activity", ownerOnly: true },
];

export function CategoryDrawer({
  category,
  open,
  onClose,
  canManage,
  onEdit,
  onOpenProduct,
  footer,
}: {
  category: CategoryRow | null;
  open: boolean;
  onClose: () => void;
  /** OWNER → full tab set + management actions. MANAGER → Overview + Products. */
  canManage: boolean;
  onEdit?: (category: CategoryRow) => void;
  onOpenProduct?: (productId: string) => void;
  footer?: React.ReactNode;
}) {
  const [tab, setTab] = useState<CategoryDrawerTab>("overview");

  // Reset to Overview whenever a different category is opened, so the drawer
  // never shows the previous category's tab against new data.
  useEffect(() => {
    setTab("overview");
  }, [category?.id]);

  const tabs = ALL_TABS.filter((t) => canManage || !t.ownerOnly);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="w-full max-w-3xl"
      {...(footer ? { footer } : {})}
    >
      {category && (
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-start gap-4 border-b border-border pb-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/20">
              {category.imageUrl ? (
                <img src={category.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <ImageOff className="h-6 w-6 text-muted-foreground" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-semibold">{category.name}</h2>
                <CategoryStatusBadge status={category.status} />
              </div>
              <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                {category.description || "No description"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{category.productCount}</span>{" "}
                {category.productCount === 1 ? "Product" : "Products"}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div
            role="tablist"
            aria-label="Category details"
            className="flex gap-1 overflow-x-auto border-b border-border"
          >
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                  tab === t.key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Panel */}
          <div role="tabpanel" className="flex-1 overflow-y-auto py-4">
            <Suspense fallback={<CategoryDetailSkeleton />}>
              {tab === "overview" && (
                <CategoryOverviewTab
                  category={category}
                  {...(canManage && onEdit ? { onEdit: () => onEdit(category) } : {})}
                />
              )}
              {tab === "products" && (
                <CategoryProductsTab
                  categoryId={category.id}
                  canManage={canManage}
                  {...(onOpenProduct ? { onOpenProduct } : {})}
                />
              )}
              {tab === "discounts" && canManage && (
                <CategoryDiscountTab categoryId={category.id} categoryName={category.name} />
              )}
              {tab === "analytics" && canManage && (
                <CategoryAnalyticsTab categoryId={category.id} />
              )}
              {tab === "activity" && canManage && (
                <CategoryActivityTab categoryId={category.id} />
              )}
            </Suspense>
          </div>
        </div>
      )}
    </Drawer>
  );
}
