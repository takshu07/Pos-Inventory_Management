import { useState, useEffect } from "react";
import { Search, Barcode } from "lucide-react";
import { Input, Skeleton, ErrorState, EmptyState } from "@/components/ui";
import { useSearchVariants } from "../api/pos.api";
import { usePosStore } from "../store/usePosStore";
import { formatCurrency } from "../utils/pos.utils";

export function PosLeftSection() {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const addItem = usePosStore((state) => state.addItem);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: variants, isLoading, isError } = useSearchVariants(debouncedQuery);

  // For barcode, typically we'd have a global listener or a specific input that fires an exact match.
  // We'll treat standard search as also capable of barcode exact match via backend fuzzy search.

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search Header */}
      <div className="p-4 border-b bg-muted/10 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by Name, SKU, or scan Barcode..."
            className="pl-9 bg-background shadow-sm border-muted-foreground/20 text-base"
            autoFocus
          />
          <Barcode className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4 opacity-50" />
        </div>
      </div>

      {/* Product Grid / Results */}
      <div className="flex-1 overflow-y-auto p-4 bg-muted/5">
        {isLoading && debouncedQuery.length > 2 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        )}

        {isError && (
          <ErrorState message="Failed to load products. Please try again." />
        )}

        {!isLoading && !isError && variants && variants.length === 0 && debouncedQuery.length > 2 && (
          <EmptyState message="No products found matching your search." />
        )}

        {!isLoading && !isError && variants && variants.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {variants.map((variant) => {
              const outOfStock = variant.currentStock <= 0;
              return (
                <button
                  key={variant.id}
                  type="button"
                  disabled={outOfStock || !variant.isActive}
                  onClick={() => addItem(variant)}
                  className={`
                    relative flex flex-col items-start p-3 text-left rounded-xl border bg-background transition-all
                    ${outOfStock || !variant.isActive ? "opacity-50 cursor-not-allowed bg-muted/50" : "hover:border-primary hover:shadow-sm active:scale-[0.98]"}
                  `}
                >
                  <div className="font-semibold text-sm line-clamp-2 min-h-[2.5rem]">
                    {variant.product.name}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-1">
                    {variant.size?.name} {variant.color ? `· ${variant.color.name}` : ""}
                  </div>
                  <div className="flex items-center justify-between w-full mt-3">
                    <span className="font-bold text-primary">{formatCurrency(Number(variant.sellingPrice))}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-sm ${outOfStock ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>
                      {outOfStock ? "Out of Stock" : `${variant.currentStock} in stock`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!isLoading && !isError && debouncedQuery.length <= 2 && (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm flex-col gap-2">
            <Barcode className="h-8 w-8 opacity-20" />
            <p>Scan a barcode or start typing to search products</p>
          </div>
        )}
      </div>
    </div>
  );
}
