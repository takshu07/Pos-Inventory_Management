/**
 * URL-backed filter, sort and pagination state for the Audit Logs table.
 *
 * Same contract as useUserFilters: state lives in the query string, so a
 * filtered view is shareable, survives a refresh, and works with the back
 * button. That matters more here than anywhere else in the app — "the entries
 * I am looking at" is exactly the thing someone investigating an incident needs
 * to send to somebody else.
 *
 * Any filter change resets to page 1: leaving the reader on page 7 of a result
 * set that now has 2 pages is the classic bug this avoids.
 *
 * Multi-select filters (module, action, severity) live in the URL as comma
 * lists, which is also how the API takes them — so the URL, the query key and
 * the request all carry the same representation and cannot drift.
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

import { useDebounce } from "@/hooks/useDebounce";
import type { AuditListParams, AuditPeriod, AuditSortBy } from "../types";

export interface AuditFilterState {
  search: string;
  module: string[];
  action: string[];
  severity: string[];
  employeeId: string;
  tableName: string;
  recordId: string;
  period: AuditPeriod;
  from: string;
  to: string;
  sortBy: AuditSortBy;
  sortOrder: "asc" | "desc";
}

/**
 * Newest first over the last 30 days.
 *
 * A default of "all time" would make the very first request the most expensive
 * one the screen can issue, on the largest table in the system, to answer a
 * question nobody asked. A month is the window an audit review actually starts
 * from, and widening it is one click.
 */
const DEFAULTS: AuditFilterState = {
  search: "",
  module: [],
  action: [],
  severity: [],
  employeeId: "",
  tableName: "",
  recordId: "",
  period: "month",
  from: "",
  to: "",
  sortBy: "createdAt",
  sortOrder: "desc",
};

const VALID_PERIODS: readonly AuditPeriod[] = [
  "today", "yesterday", "week", "month", "quarter", "year", "all", "custom",
];
const VALID_SORT_KEYS: readonly AuditSortBy[] = ["createdAt", "severity"];

/** Array params travel as comma lists in both the URL and the API. */
function parseList(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

export function useAuditFilters(prefix = "audit", defaultLimit = 25) {
  const [params, setParams] = useSearchParams();

  const k = useCallback(
    (name: string) => (prefix ? `${prefix}_${name}` : name),
    [prefix]
  );

  const page = Math.max(1, parseInt(params.get(k("page")) || "1", 10) || 1);
  const limit = parseInt(params.get(k("limit")) || String(defaultLimit), 10) || defaultLimit;

  const filters: AuditFilterState = useMemo(() => {
    const rawPeriod = params.get(k("period")) as AuditPeriod | null;
    const period = rawPeriod && VALID_PERIODS.includes(rawPeriod) ? rawPeriod : DEFAULTS.period;
    const rawSort = params.get(k("sortBy")) as AuditSortBy | null;
    const sortBy = rawSort && VALID_SORT_KEYS.includes(rawSort) ? rawSort : DEFAULTS.sortBy;

    return {
      search: params.get(k("search")) ?? DEFAULTS.search,
      module: parseList(params.get(k("module"))),
      action: parseList(params.get(k("action"))),
      severity: parseList(params.get(k("severity"))),
      employeeId: params.get(k("employeeId")) ?? DEFAULTS.employeeId,
      tableName: params.get(k("tableName")) ?? DEFAULTS.tableName,
      recordId: params.get(k("recordId")) ?? DEFAULTS.recordId,
      period,
      from: params.get(k("from")) ?? DEFAULTS.from,
      to: params.get(k("to")) ?? DEFAULTS.to,
      sortBy,
      sortOrder: (params.get(k("sortOrder")) as "asc" | "desc" | null) ?? DEFAULTS.sortOrder,
    };
  }, [params, k]);

  const setFilters = useCallback(
    (patch: Partial<AuditFilterState>) => {
      setParams(
        (prev) => {
          prev.set(k("page"), "1");
          for (const [name, value] of Object.entries(patch)) {
            const serialised = Array.isArray(value) ? value.join(",") : value;
            if (serialised === "" || serialised == null) prev.delete(k(name));
            else prev.set(k(name), String(serialised));
          }
          return prev;
        },
        { replace: true }
      );
    },
    [setParams, k]
  );

  /**
   * Adds or removes one value from a multi-select filter.
   *
   * Exposed rather than making every caller rebuild the array, so the
   * "already selected → remove it" behaviour is implemented once.
   */
  const toggleValue = useCallback(
    (key: "module" | "action" | "severity", value: string) => {
      const current = filters[key];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      setFilters({ [key]: next } as Partial<AuditFilterState>);
    },
    [filters, setFilters]
  );

  /**
   * Toggles a column's sort.
   *
   * Clicking the ACTIVE column flips direction; a new column adopts its natural
   * starting direction. Both go through setFilters, so either also resets to
   * page 1 — without which a sort change can strand the reader past the end.
   */
  const toggleSort = useCallback(
    (key: AuditSortBy) => {
      if (filters.sortBy === key) {
        setFilters({ sortOrder: filters.sortOrder === "asc" ? "desc" : "asc" });
        return;
      }
      // Newest first and most-severe first are both "desc".
      setFilters({ sortBy: key, sortOrder: "desc" });
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
        // Only this table's params — a sibling table's state must survive.
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
   * The period is included only when it differs from the default, because the
   * default month IS a narrowing filter — an empty table under it should offer
   * "widen the range", which is exactly what the empty state does with this.
   * Sort is excluded: re-sorting never hides a row.
   */
  const hasActiveFilters = useMemo(
    () =>
      filters.search !== DEFAULTS.search ||
      filters.module.length > 0 ||
      filters.action.length > 0 ||
      filters.severity.length > 0 ||
      filters.employeeId !== DEFAULTS.employeeId ||
      filters.tableName !== DEFAULTS.tableName ||
      filters.recordId !== DEFAULTS.recordId ||
      filters.period !== DEFAULTS.period,
    [filters]
  );

  /** Count of applied filters, for the "Filters (3)" affordance. */
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.search) count += 1;
    count += filters.module.length > 0 ? 1 : 0;
    count += filters.action.length > 0 ? 1 : 0;
    count += filters.severity.length > 0 ? 1 : 0;
    if (filters.employeeId) count += 1;
    if (filters.tableName) count += 1;
    if (filters.recordId) count += 1;
    if (filters.period !== DEFAULTS.period) count += 1;
    return count;
  }, [filters]);

  /**
   * Debounced search term. The raw value stays in the URL immediately (so the
   * input never lags a keystroke) while only the settled value reaches the
   * query key — which is what stops one request per character against the
   * largest table in the system.
   */
  const debouncedSearch = useDebounce(filters.search, 350);

  const serverParams: AuditListParams = useMemo(
    () => ({
      page,
      limit,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(filters.module.length ? { module: filters.module } : {}),
      ...(filters.action.length ? { action: filters.action } : {}),
      ...(filters.severity.length ? { severity: filters.severity } : {}),
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      ...(filters.tableName ? { tableName: filters.tableName } : {}),
      ...(filters.recordId ? { recordId: filters.recordId } : {}),
      period: filters.period,
      // Only sent for a custom period; the server ignores them otherwise, and
      // omitting them keeps a stale URL date out of the query key.
      ...(filters.period === "custom" && filters.from ? { from: filters.from } : {}),
      ...(filters.period === "custom" && filters.to ? { to: filters.to } : {}),
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
    }),
    [page, limit, debouncedSearch, filters]
  );

  return {
    filters,
    setFilters,
    toggleValue,
    toggleSort,
    page,
    limit,
    setPage,
    reset,
    hasActiveFilters,
    activeFilterCount,
    serverParams,
    isSearching: filters.search !== debouncedSearch,
  };
}
