/**
 * URL-backed filter, sort and pagination state for the Users & Roles table.
 *
 * Same contract as useWorkforceFilters: state lives in the query string, so a
 * filtered view is shareable, survives a refresh, and works with the browser's
 * back button. Any filter change resets to page 1 — leaving the user on page 7
 * of a result set that now has 2 pages is the classic bug this avoids.
 *
 * Sorting is SERVER-side here (unlike the workforce roster's derived columns):
 * every sort key below is one the server's zod enum accepts, so a sort applies
 * across the whole result set rather than reordering the current page only.
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

import { useDebounce } from "@/hooks/useDebounce";
import { clampLimit } from "@/lib/api/pagination";
import type { UserListParams, UserSortBy } from "../types";

export interface UserFilterState {
  search: string;
  role: string;
  isActive: string;
  sortBy: UserSortBy;
  sortOrder: "asc" | "desc";
}

/**
 * Newest accounts first is the right default for an administration screen:
 * the account you just created is the one you are most likely to act on next.
 */
const DEFAULTS: UserFilterState = {
  search: "",
  role: "",
  isActive: "",
  sortBy: "createdAt",
  sortOrder: "desc",
};

/** The server's `sortBy` enum. A value outside this set is a 400, so it is filtered. */
const VALID_SORT_KEYS: readonly UserSortBy[] = [
  "createdAt",
  "firstName",
  "joiningDate",
  "salary",
];

function parseSortBy(value: string | null): UserSortBy {
  return VALID_SORT_KEYS.includes(value as UserSortBy)
    ? (value as UserSortBy)
    : DEFAULTS.sortBy;
}

export function useUserFilters(prefix = "users", defaultLimit = 20) {
  const [params, setParams] = useSearchParams();

  const k = useCallback((name: string) => (prefix ? `${prefix}_${name}` : name), [prefix]);

  const page = Math.max(1, parseInt(params.get(k("page")) || "1", 10) || 1);
  // Clamped: this comes from the URL, and the server rejects an over-cap limit
  // with 400 rather than clamping it. See lib/api/pagination.ts.
  const limit = clampLimit(
    parseInt(params.get(k("limit")) || String(defaultLimit), 10) || defaultLimit
  );

  const filters: UserFilterState = useMemo(
    () => ({
      search: params.get(k("search")) ?? DEFAULTS.search,
      role: params.get(k("role")) ?? DEFAULTS.role,
      isActive: params.get(k("isActive")) ?? DEFAULTS.isActive,
      sortBy: parseSortBy(params.get(k("sortBy"))),
      sortOrder: (params.get(k("sortOrder")) as "asc" | "desc" | null) ?? DEFAULTS.sortOrder,
    }),
    [params, k]
  );

  const setFilters = useCallback(
    (patch: Partial<UserFilterState>) => {
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

  /**
   * Toggles a column's sort.
   *
   * Clicking the ACTIVE column flips direction; clicking a new one adopts it
   * with a sensible starting direction — names ascend (A→Z reads naturally),
   * dates and money descend (newest / largest first is what someone is looking
   * for). Both go through setFilters, so either also resets to page 1.
   */
  const toggleSort = useCallback(
    (key: UserSortBy) => {
      if (filters.sortBy === key) {
        setFilters({ sortOrder: filters.sortOrder === "asc" ? "desc" : "asc" });
        return;
      }
      setFilters({ sortBy: key, sortOrder: key === "firstName" ? "asc" : "desc" });
    },
    [filters.sortBy, filters.sortOrder, setFilters]
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

  /**
   * Whether any NARROWING filter is applied.
   *
   * Sort is deliberately excluded: re-sorting does not hide rows, so offering
   * "clear filters" because someone sorted by name would be misleading — and
   * an empty table after a sort change is never explained by the sort.
   */
  const hasActiveFilters = useMemo(
    () =>
      filters.search !== DEFAULTS.search ||
      filters.role !== DEFAULTS.role ||
      filters.isActive !== DEFAULTS.isActive,
    [filters]
  );

  /**
   * Debounced search term. The raw value stays in the URL immediately (so the
   * input never lags a keystroke), while only the settled value reaches the
   * query key — which is what stops a request per character.
   */
  const debouncedSearch = useDebounce(filters.search, 300);

  const serverParams: UserListParams = useMemo(
    () => ({
      page,
      limit,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(filters.role ? { role: filters.role as UserListParams["role"] } : {}),
      ...(filters.isActive ? { isActive: filters.isActive === "true" } : {}),
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
    }),
    [page, limit, debouncedSearch, filters]
  );

  return {
    filters,
    setFilters,
    toggleSort,
    page,
    limit,
    setPage,
    reset,
    hasActiveFilters,
    serverParams,
    isSearching: filters.search !== debouncedSearch,
  };
}
