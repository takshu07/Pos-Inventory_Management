/**
 * URL-backed filter state for the procurement lists.
 *
 * Filters live in the query string so a filtered view is shareable, survives
 * refresh and back/forward, and restores itself on return — no store, no
 * localStorage. This mirrors `useCategoryFilters`, which established the
 * pattern; the debounce split is the important part of it.
 *
 * SEARCH IS DEBOUNCED SEPARATELY from everything else: the text box must update
 * on every keystroke to feel responsive, but the URL — and therefore the query
 * key and the network request — must not, or every character fires a fetch.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { clampLimit } from "@/lib/api/pagination";
import {
  EMPTY_PURCHASE_FILTERS,
  type CatalogFilterState,
  type PurchaseFilterState,
  type PurchaseSortOption,
  type PurchaseStatus,
  type SettlementStatus,
} from "../types";

/** Shared debounce plumbing for a URL-backed search box. */
function useDebouncedSearch(
  current: string,
  apply: (value: string) => void,
  debounceMs: number
) {
  const [searchInput, setSearchInput] = useState(current);

  // Keep the box in sync when the URL changes from OUTSIDE (reset button, back
  // navigation, a summary card applying a filter) — but never while the user is
  // mid-keystroke, which would fight their typing.
  const typingRef = useRef(false);
  useEffect(() => {
    if (!typingRef.current) setSearchInput(current);
  }, [current]);

  useEffect(() => {
    if (searchInput === current) return;

    typingRef.current = true;
    const timer = setTimeout(() => {
      apply(searchInput);
      typingRef.current = false;
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [searchInput, current, apply, debounceMs]);

  return { searchInput, setSearchInput };
}

// =============================================================================
// PURCHASES
// =============================================================================

export function usePurchaseFilters(defaultLimit = 20, debounceMs = 300) {
  const [params, setParams] = useSearchParams();

  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
  // Clamped: this comes from the URL, and the server rejects an over-cap limit
  // with 400 rather than clamping it. See lib/api/pagination.ts.
  const limit = clampLimit(
    parseInt(params.get("limit") || String(defaultLimit), 10) || defaultLimit
  );

  const filters: PurchaseFilterState = useMemo(
    () => ({
      search: params.get("search") ?? "",
      supplierId: params.get("supplierId") ?? "",
      status: (params.get("status") as PurchaseStatus | null) ?? "",
      paymentStatus: (params.get("paymentStatus") as SettlementStatus | null) ?? "",
      dateFrom: params.get("dateFrom") ?? "",
      dateTo: params.get("dateTo") ?? "",
      sortBy: (params.get("sortBy") as PurchaseSortOption | null) ?? "createdAt",
      sortOrder: (params.get("sortOrder") as "asc" | "desc" | null) ?? "desc",
    }),
    [params]
  );

  const setFilters = useCallback(
    (patch: Partial<PurchaseFilterState>) => {
      setParams(
        (prev) => {
          // Any filter change resets pagination — otherwise you land on page 7
          // of a 2-page result and stare at an empty table.
          prev.set("page", "1");
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

  const applySearch = useCallback(
    (value: string) => setFilters({ search: value }),
    [setFilters]
  );
  const { searchInput, setSearchInput } = useDebouncedSearch(
    filters.search,
    applySearch,
    debounceMs
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
    setSearchInput("");
    setParams({}, { replace: true });
  }, [setParams, setSearchInput]);

  const hasActiveFilters = useMemo(
    () =>
      Object.entries(filters).some(([key, value]) => {
        if (key === "sortBy" || key === "sortOrder") return false;
        return value !== EMPTY_PURCHASE_FILTERS[key as keyof PurchaseFilterState];
      }),
    [filters]
  );

  /** Exactly what the API layer needs — no UI-only keys leak into the query. */
  const serverParams = useMemo(
    () => ({
      page,
      limit,
      search: filters.search || undefined,
      supplierId: filters.supplierId || undefined,
      status: filters.status || undefined,
      paymentStatus: filters.paymentStatus || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
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
  };
}

// =============================================================================
// BRANDS & SUPPLIERS (same shape, different sort vocabulary)
// =============================================================================

export function useCatalogFilters<TSort extends string>(
  defaultSort: TSort,
  defaultLimit = 20,
  debounceMs = 300
) {
  const [params, setParams] = useSearchParams();

  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
  // Clamped: this comes from the URL, and the server rejects an over-cap limit
  // with 400 rather than clamping it. See lib/api/pagination.ts.
  const limit = clampLimit(
    parseInt(params.get("limit") || String(defaultLimit), 10) || defaultLimit
  );

  const filters: CatalogFilterState & { sortBy: TSort } = useMemo(
    () => ({
      search: params.get("search") ?? "",
      isActive: (params.get("isActive") as "true" | "false" | null) ?? "",
      // The URL is user-editable, so an unknown sort key falls back to the
      // default rather than being forwarded to the server as-is.
      sortBy: (params.get("sortBy") as TSort | null) ?? defaultSort,
      sortOrder: (params.get("sortOrder") as "asc" | "desc" | null) ?? "asc",
    }),
    [params, defaultSort]
  );

  const setFilters = useCallback(
    (patch: Partial<CatalogFilterState & { sortBy: TSort }>) => {
      setParams(
        (prev) => {
          prev.set("page", "1");
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

  const applySearch = useCallback(
    (value: string) => setFilters({ search: value }),
    [setFilters]
  );
  const { searchInput, setSearchInput } = useDebouncedSearch(
    filters.search,
    applySearch,
    debounceMs
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
    setSearchInput("");
    setParams({}, { replace: true });
  }, [setParams, setSearchInput]);

  const hasActiveFilters = filters.search !== "" || filters.isActive !== "";

  const serverParams = useMemo(
    () => ({
      page,
      limit,
      search: filters.search || undefined,
      isActive: filters.isActive || undefined,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
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
  };
}
