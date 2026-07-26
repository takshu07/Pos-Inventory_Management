import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { EMPTY_FILTERS, type ProductFilterState, type SortOption, type StockStatus } from "./types";

/**
 * useProductFilters — URL-backed filter/pagination state, shared by both product
 * modules. Keeping state in the URL means a filtered catalog view is shareable
 * and survives refresh/back. Changing any filter resets to page 1.
 *
 * Returns both the typed filter state (for the ProductFilters UI) and the
 * server params (page/limit + filters) ready to feed a query hook.
 */
export function useProductFilters(defaultLimit = 20) {
  const [params, setParams] = useSearchParams();

  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
  const limit = parseInt(params.get("limit") || String(defaultLimit), 10) || defaultLimit;

  const filters: ProductFilterState = useMemo(
    () => ({
      search: params.get("search") ?? "",
      categoryId: params.get("categoryId") ?? "",
      brandId: params.get("brandId") ?? "",
      stockStatus: (params.get("stockStatus") as StockStatus | "") ?? "",
      isActive: (params.get("isActive") as ProductFilterState["isActive"]) ?? "",
      minPrice: params.get("minPrice") ?? "",
      maxPrice: params.get("maxPrice") ?? "",
      sortBy: (params.get("sortBy") as SortOption) ?? "newest",
    }),
    [params]
  );

  const setFilters = useCallback(
    (patch: Partial<ProductFilterState>) => {
      setParams(
        (prev) => {
          prev.set("page", "1"); // any filter change resets pagination
          for (const [key, value] of Object.entries(patch)) {
            if (value === "" || value == null) prev.delete(key);
            else prev.set(key, String(value));
          }
          return prev;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  const setPage = useCallback(
    (next: number) => {
      setParams(
        (prev) => {
          prev.set("page", String(next));
          return prev;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  const reset = useCallback(() => {
    setParams({}, { replace: true });
  }, [setParams]);

  const hasActiveFilters = useMemo(
    () =>
      Object.entries(filters).some(([key, value]) => {
        if (key === "sortBy") return value !== "newest";
        return value !== "" && value != null;
      }),
    [filters]
  );

  // Server params for the API layer (only non-empty keys matter downstream).
  const serverParams = useMemo(
    () => ({
      page,
      limit,
      search: filters.search || undefined,
      categoryId: filters.categoryId || undefined,
      brandId: filters.brandId || undefined,
      stockStatus: filters.stockStatus || undefined,
      isActive: filters.isActive || undefined,
      minPrice: filters.minPrice || undefined,
      maxPrice: filters.maxPrice || undefined,
      sortBy: filters.sortBy || undefined,
    }),
    [page, limit, filters]
  );

  return {
    filters,
    setFilters,
    page,
    limit,
    setPage,
    reset,
    hasActiveFilters,
    serverParams,
    EMPTY_FILTERS,
  };
}
