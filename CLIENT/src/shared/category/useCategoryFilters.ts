import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { clampLimit } from "@/lib/api/pagination";
import {
  EMPTY_CATEGORY_FILTERS,
  type CategoryFilterState,
  type CategorySortOption,
  type CategoryStatus,
} from "./types";

/**
 * useCategoryFilters — URL-backed filter/pagination state, shared by both
 * category modules.
 *
 * Keeping state in the URL means a filtered view is shareable, survives refresh
 * and back/forward, and restores the user's last view for free (the "persistent
 * filters" requirement) without a store or localStorage.
 *
 * SEARCH IS DEBOUNCED SEPARATELY from the rest of the state. The input must
 * update on every keystroke (so typing feels instant), but the server params —
 * and therefore the query key — must not, or every character would fire a
 * request. `searchInput` drives the text box; the debounced value drives the
 * URL and the fetch.
 *
 * Any filter change resets to page 1; otherwise you can end up on page 7 of a
 * 2-page result and see an empty table.
 */
export function useCategoryFilters(defaultLimit = 20, debounceMs = 300) {
  const [params, setParams] = useSearchParams();

  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
  // Clamped: this comes from the URL, and the server rejects an over-cap limit
  // with 400 rather than clamping it. See lib/api/pagination.ts.
  const limit = clampLimit(
    parseInt(params.get("limit") || String(defaultLimit), 10) || defaultLimit
  );

  const filters: CategoryFilterState = useMemo(
    () => ({
      search: params.get("search") ?? "",
      status: (params.get("status") as CategoryStatus | null) ?? "",
      hasProducts: (params.get("hasProducts") as "true" | "false" | null) ?? "",
      createdFrom: params.get("createdFrom") ?? "",
      createdTo: params.get("createdTo") ?? "",
      sortBy: (params.get("sortBy") as CategorySortOption | null) ?? "alphabetical",
      includeArchived: (params.get("includeArchived") as "true" | null) ?? "",
    }),
    [params]
  );

  // Local mirror of the search box so typing is never blocked by the URL write.
  const [searchInput, setSearchInput] = useState(filters.search);

  // Keep the box in sync when the URL changes from outside (reset, back button,
  // a summary card applying a filter) — but not while the user is typing.
  const typingRef = useRef(false);
  useEffect(() => {
    if (!typingRef.current) setSearchInput(filters.search);
  }, [filters.search]);

  const setFilters = useCallback(
    (patch: Partial<CategoryFilterState>) => {
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

  // Debounce: push the typed value into the URL only after the user pauses.
  useEffect(() => {
    if (searchInput === filters.search) return;

    typingRef.current = true;
    const timer = setTimeout(() => {
      setFilters({ search: searchInput });
      typingRef.current = false;
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [searchInput, filters.search, setFilters, debounceMs]);

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
    setSearchInput("");
    setParams({}, { replace: true });
  }, [setParams]);

  const hasActiveFilters = useMemo(
    () =>
      Object.entries(filters).some(([key, value]) => {
        if (key === "sortBy") return value !== "alphabetical";
        return value !== "" && value != null;
      }),
    [filters]
  );

  /**
   * Server params. Memoised on the DEBOUNCED filter values, so this object is
   * referentially stable between keystrokes — it is used as a React Query key,
   * and a new object every render would refetch forever.
   */
  const serverParams = useMemo(
    () => ({
      page,
      limit,
      search: filters.search || undefined,
      status: filters.status || undefined,
      hasProducts: filters.hasProducts || undefined,
      createdFrom: filters.createdFrom || undefined,
      createdTo: filters.createdTo || undefined,
      sortBy: filters.sortBy || undefined,
      includeArchived: filters.includeArchived || undefined,
    }),
    [page, limit, filters]
  );

  return {
    filters,
    setFilters,
    searchInput,
    setSearchInput,
    page,
    limit,
    setPage,
    reset,
    hasActiveFilters,
    serverParams,
    EMPTY_CATEGORY_FILTERS,
  };
}
