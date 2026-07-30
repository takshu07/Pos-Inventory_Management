import { useState } from "react";
import { ExternalLink, ImageOff } from "lucide-react";
import { Button, Pagination } from "@/components/ui";
import { formatCurrency } from "@/utils/formatters";
import { cn } from "@/utils/cn";
import { useAuthStore } from "@/store/auth.store";
import { useCategoryProducts } from "../../useCategories";
import { CategorySearch } from "../CategorySearch";
import { CategoryTableSkeleton } from "../CategorySkeleton";

/**
 * CategoryProductsTab — the products belonging to a category.
 *
 * Fetches only when this tab is mounted (the drawer lazily renders panels), and
 * paginates server-side so a 5,000-product category costs the same as a 5-product
 * one.
 *
 * Price is shown as a RANGE and stock as a SUM across variants, matching the
 * product module — the authoritative values live on ProductVariant, and a
 * category view must not invent a different rollup.
 */
export function CategoryProductsTab({
  categoryId,
  canManage,
  onOpenProduct,
}: {
  categoryId: string;
  canManage: boolean;
  onOpenProduct?: (productId: string) => void;
}) {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const { data, isPending, isError, error } = useCategoryProducts(role, categoryId, {
    page,
    limit: 10,
    search: search || undefined,
  });

  const rows = data?.data ?? [];
  const meta = data?.meta;

  const priceRange = (min: number | null, max: number | null) => {
    if (min == null) return "—";
    return max != null && max !== min
      ? `${formatCurrency(min)} – ${formatCurrency(max)}`
      : formatCurrency(min);
  };

  return (
    <div className="space-y-4">
      <CategorySearch
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Search products in this category…"
      />

      {isPending ? (
        <CategoryTableSkeleton rows={5} columns={6} />
      ) : isError ? (
        <p className="py-8 text-center text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load products."}
        </p>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {search
            ? "No products match your search."
            : "This category has no products yet."}
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/40"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/20">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <ImageOff className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">
                  {p.brand ?? "No brand"}
                  {p.variantCount > 0 && ` · ${p.variantCount} variant${p.variantCount === 1 ? "" : "s"}`}
                </div>
              </div>

              <div className="hidden text-right sm:block">
                <div className="text-xs text-muted-foreground line-through">
                  {priceRange(p.mrp, p.mrpMax)}
                </div>
                <div className="text-sm font-medium">
                  {priceRange(p.sellingPrice, p.sellingPriceMax)}
                </div>
              </div>

              <div className="w-16 text-right">
                <div
                  className={cn(
                    "text-sm font-medium tabular-nums",
                    p.stock === 0
                      ? "text-destructive"
                      : p.stock < 10
                        ? "text-amber-600 dark:text-amber-400"
                        : ""
                  )}
                >
                  {p.stock}
                </div>
                <div className="text-xs text-muted-foreground">in stock</div>
              </div>

              {onOpenProduct && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onOpenProduct(p.id)}
                  aria-label={`Open ${p.name}`}
                  title={canManage ? "Open product" : "View product"}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}

          {meta && meta.totalPages > 1 && (
            <Pagination
              currentPage={meta.page}
              totalPages={meta.totalPages}
              onPageChange={setPage}
            />
          )}
        </div>
      )}
    </div>
  );
}
