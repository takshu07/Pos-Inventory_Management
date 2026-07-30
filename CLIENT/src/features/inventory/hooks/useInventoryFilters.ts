/**
 * URL-backed filter + pagination state for the inventory tables.
 *
 * Same contract as useWorkforceFilters / useProductFilters: filters live in the
 * query string, so a filtered view is shareable, survives a refresh, and works
 * with the browser's back button. Any filter change resets to page 1 — leaving
 * the user on page 7 of a result set that now has 2 pages is the classic bug
 * this avoids.
 *
 * The `prefix` namespaces the params so two tables can coexist on one page
 * without fighting over `?page`.
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

import { useDebounce } from "@/hooks/useDebounce";
import type { StockParams, StockStatusFilter } from "../types";

export interface InventoryFilterState {
  search: string;
  categoryId: string;
  brandId: string;
  supplierId: string;
  status: StockStatusFilter;
  isActive: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

const DEFAULTS: InventoryFilterState = {
  search: "",
  categoryId: "",
  brandId: "",
  supplierId: "",
  status: "ALL",
  isActive: "",
  sortBy: "updatedAt",
  sortOrder: "desc",
};

export function useInventoryFilters(prefix = "inv", defaultLimit = 25) {
  const [params, setParams] = useSearchParams();

  const k = useCallback((name: string) => (prefix ? `${prefix}_${name}` : name), [prefix]);

  const page = Math.max(1, parseInt(params.get(k("page")) || "1", 10) || 1);
  const limit = parseInt(params.get(k("limit")) || String(defaultLimit), 10) || defaultLimit;

  const filters: InventoryFilterState = useMemo(
    () => ({
      search: params.get(k("search")) ?? DEFAULTS.search,
      categoryId: params.get(k("categoryId")) ?? DEFAULTS.categoryId,
      brandId: params.get(k("brandId")) ?? DEFAULTS.brandId,
      supplierId: params.get(k("supplierId")) ?? DEFAULTS.supplierId,
      status: (params.get(k("status")) as StockStatusFilter | null) ?? DEFAULTS.status,
      isActive: params.get(k("isActive")) ?? DEFAULTS.isActive,
      sortBy: params.get(k("sortBy")) ?? DEFAULTS.sortBy,
      sortOrder: (params.get(k("sortOrder")) as "asc" | "desc" | null) ?? DEFAULTS.sortOrder,
    }),
    [params, k]
  );

  const setFilters = useCallback(
    (patch: Partial<InventoryFilterState>) => {
      setParams(
        (prev) => {
          prev.set(k("page"), "1");
          for (const [name, value] of Object.entries(patch)) {
            // "ALL" is the status default and means "no filter", so it is
            // dropped from the URL exactly like an empty string.
            if (value === "" || value == null || value === "ALL") prev.delete(k(name));
            else prev.set(k(name), String(value));
          }
          return prev;
        },
        { replace: true }
      );
    },
    [setParams, k]
  );

  const setPage = useCallback(
    (next: number) => {
      setParams(
        (prev) => {
          prev.set(k("page"), String(next));
          return prev;
        },
        { replace: true }
      );
    },
    [setParams, k]
  );

  const reset = useCallback(() => {
    setParams(
      (prev) => {
        // Only clear THIS table's params — a sibling table's state must survive.
        for (const name of [...Object.keys(DEFAULTS), "page", "limit"]) {
          prev.delete(k(name));
        }
        return prev;
      },
      { replace: true }
    );
  }, [setParams, k]);

  const hasActiveFilters = useMemo(
    () =>
      Object.entries(DEFAULTS).some(
        ([name, fallback]) => filters[name as keyof InventoryFilterState] !== fallback
      ),
    [filters]
  );

  /**
   * Debounced search. The raw value stays in the URL immediately (so the input
   * never lags a keystroke), while only the settled value reaches the query
   * key — which is what stops a request per character.
   */
  const debouncedSearch = useDebounce(filters.search, 300);

  const serverParams: StockParams = useMemo(
    () => ({
      page,
      limit,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.brandId ? { brandId: filters.brandId } : {}),
      ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
      ...(filters.status !== "ALL" ? { status: filters.status } : {}),
      ...(filters.isActive ? { isActive: filters.isActive === "true" } : {}),
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
    }),
    [page, limit, debouncedSearch, filters]
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
    isSearching: filters.search !== debouncedSearch,
  };
}
