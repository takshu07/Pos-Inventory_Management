import { useSearchParams } from "react-router";
import { useCallback } from "react";

import { clampLimit } from "@/lib/api/pagination";

export function useTableState(defaultLimit = 10) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Parse current state from URL
  const page = parseInt(searchParams.get("page") || "1", 10) || 1;
  // Clamped, and with a fallback for unparseable input: both come from the URL.
  // `?limit=abc` previously yielded NaN, which serializes as "NaN" in the query
  // string and 400s just as surely as an over-cap number does.
  const limit = clampLimit(
    parseInt(searchParams.get("limit") || String(defaultLimit), 10) || defaultLimit
  );
  const search = searchParams.get("search") || "";
  const status = searchParams.get("status") || "";
  const paymentMethod = searchParams.get("paymentMethod") || "";
  const startDate = searchParams.get("startDate") || "";
  const endDate = searchParams.get("endDate") || "";
  
  // Custom range alias mapping (e.g. "today", "7d") mapped into backend filters if needed,
  // but typically we can pass these directly or let the API layer handle them.
  const dateRange = searchParams.get("dateRange") || "";

  // Updaters (Modifies URL without losing other query params)
  const setPage = useCallback(
    (newPage: number) => {
      setSearchParams(
        (prev) => {
          prev.set("page", String(newPage));
          return prev;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setFilters = useCallback(
    (newFilters: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          // Always reset to page 1 when changing filters
          prev.set("page", "1");
          Object.entries(newFilters).forEach(([key, value]) => {
            if (value === null || value === "") {
              prev.delete(key);
            } else {
              prev.set(key, value);
            }
          });
          return prev;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  return {
    page,
    limit,
    search,
    status,
    paymentMethod,
    dateRange,
    startDate,
    endDate,
    setPage,
    setFilters,
  };
}
