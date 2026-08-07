import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

import { clampLimit } from "@/lib/api/pagination";
import type { DiscountListParams, DiscountScope, DiscountStatus } from "../api/discountApi";

export interface DiscountFilterState {
  search: string;
  scope: DiscountScope | "";
  status: DiscountStatus | "";
  sortBy: NonNullable<DiscountListParams["sortBy"]>;
  sortOrder: NonNullable<DiscountListParams["sortOrder"]>;
}

const DEFAULT_SORT_BY = "createdAt";
const DEFAULT_SORT_ORDER = "desc";

/**
 * URL-backed filter/pagination state for the discounts table — same contract as
 * useProductFilters, so a filtered view is shareable and survives refresh/back.
 * Any filter change resets to page 1.
 */
export function useDiscountFilters(defaultLimit = 20) {
  const [params, setParams] = useSearchParams();

  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
  // Clamped: this comes from the URL, and the server rejects an over-cap limit
  // with 400 rather than clamping it. See lib/api/pagination.ts.
  const limit = clampLimit(
    parseInt(params.get("limit") || String(defaultLimit), 10) || defaultLimit
  );

  const filters: DiscountFilterState = useMemo(
    () => ({
      search: params.get("search") ?? "",
      scope: (params.get("scope") as DiscountScope | null) ?? "",
      status: (params.get("status") as DiscountStatus | null) ?? "",
      sortBy: (params.get("sortBy") as DiscountFilterState["sortBy"] | null) ?? DEFAULT_SORT_BY,
      sortOrder: (params.get("sortOrder") as DiscountFilterState["sortOrder"] | null) ?? DEFAULT_SORT_ORDER,
    }),
    [params]
  );

  const setFilters = useCallback(
    (patch: Partial<DiscountFilterState>) => {
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

  const reset = useCallback(() => setParams({}, { replace: true }), [setParams]);

  const hasActiveFilters = useMemo(
    () =>
      !!filters.search ||
      !!filters.scope ||
      !!filters.status ||
      filters.sortBy !== DEFAULT_SORT_BY ||
      filters.sortOrder !== DEFAULT_SORT_ORDER,
    [filters]
  );

  // Only non-empty keys reach the API — `clean()` in the transport layer strips
  // the rest, but keeping them undefined here also keeps the query key stable.
  const serverParams: DiscountListParams = useMemo(
    () => ({
      page,
      limit,
      ...(filters.search ? { search: filters.search } : {}),
      ...(filters.scope ? { scope: filters.scope } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
    }),
    [page, limit, filters]
  );

  return { filters, setFilters, page, limit, setPage, reset, hasActiveFilters, serverParams };
}
