/**
 * URL-backed filter + pagination state for the workforce tables.
 *
 * Same contract as useDiscountFilters / useProductFilters: filters live in the
 * query string, so a filtered view is shareable, survives a refresh, and works
 * with the browser's back button. Any filter change resets to page 1 — leaving
 * the user on page 7 of a result set that now has 2 pages is the classic bug
 * this avoids.
 *
 * The `key` prefix namespaces the params so two tables can coexist on one page
 * (e.g. the Managers and Employees tabs) without fighting over `?page`.
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

import { useDebounce } from "@/hooks/useDebounce";
import type { RosterParams } from "../types";

export interface WorkforceFilterState {
  search: string;
  role: string;
  isActive: string;
  employmentStatus: string;
  shiftId: string;
  presence: string;
  attendance: string;
  storeCode: string;
  joinedFrom: string;
  joinedTo: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

const DEFAULTS: WorkforceFilterState = {
  search: "",
  role: "",
  isActive: "",
  employmentStatus: "",
  shiftId: "",
  presence: "",
  attendance: "",
  storeCode: "",
  joinedFrom: "",
  joinedTo: "",
  sortBy: "firstName",
  sortOrder: "asc",
};

export function useWorkforceFilters(prefix = "", defaultLimit = 20) {
  const [params, setParams] = useSearchParams();

  const k = useCallback((name: string) => (prefix ? `${prefix}_${name}` : name), [prefix]);

  const page = Math.max(1, parseInt(params.get(k("page")) || "1", 10) || 1);
  const limit = parseInt(params.get(k("limit")) || String(defaultLimit), 10) || defaultLimit;

  const filters: WorkforceFilterState = useMemo(
    () => ({
      search: params.get(k("search")) ?? DEFAULTS.search,
      role: params.get(k("role")) ?? DEFAULTS.role,
      isActive: params.get(k("isActive")) ?? DEFAULTS.isActive,
      employmentStatus: params.get(k("employmentStatus")) ?? DEFAULTS.employmentStatus,
      shiftId: params.get(k("shiftId")) ?? DEFAULTS.shiftId,
      presence: params.get(k("presence")) ?? DEFAULTS.presence,
      attendance: params.get(k("attendance")) ?? DEFAULTS.attendance,
      storeCode: params.get(k("storeCode")) ?? DEFAULTS.storeCode,
      joinedFrom: params.get(k("joinedFrom")) ?? DEFAULTS.joinedFrom,
      joinedTo: params.get(k("joinedTo")) ?? DEFAULTS.joinedTo,
      sortBy: params.get(k("sortBy")) ?? DEFAULTS.sortBy,
      sortOrder: (params.get(k("sortOrder")) as "asc" | "desc" | null) ?? DEFAULTS.sortOrder,
    }),
    [params, k]
  );

  const setFilters = useCallback(
    (patch: Partial<WorkforceFilterState>) => {
      setParams(
        (prev) => {
          prev.set(k("page"), "1");
          for (const [name, value] of Object.entries(patch)) {
            if (value === "" || value == null) prev.delete(k(name));
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
        ([name, fallback]) => filters[name as keyof WorkforceFilterState] !== fallback
      ),
    [filters]
  );

  /**
   * Debounced search term. The raw value stays in the URL immediately (so the
   * input never lags a keystroke), while only the settled value reaches the
   * query key — which is what stops a request per character.
   */
  const debouncedSearch = useDebounce(filters.search, 300);

  /**
   * Server params. `presence` and `attendance` are deliberately absent: they
   * are derived columns the server does not filter on, so they are applied
   * client-side over the current page. Sending them would be silently ignored.
   */
  const serverParams: RosterParams = useMemo(
    () => ({
      page,
      limit,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(filters.role ? { role: filters.role as RosterParams["role"] } : {}),
      ...(filters.isActive ? { isActive: filters.isActive === "true" } : {}),
      ...(filters.employmentStatus
        ? { employmentStatus: filters.employmentStatus as RosterParams["employmentStatus"] }
        : {}),
      ...(filters.shiftId ? { shiftId: filters.shiftId } : {}),
      ...(filters.storeCode ? { storeCode: filters.storeCode } : {}),
      ...(filters.joinedFrom ? { joinedFrom: filters.joinedFrom } : {}),
      ...(filters.joinedTo ? { joinedTo: filters.joinedTo } : {}),
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
