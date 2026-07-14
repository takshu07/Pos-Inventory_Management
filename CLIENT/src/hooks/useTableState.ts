import { useSearchParams } from "react-router";
import { useCallback } from "react";

export function useTableState(defaultLimit = 10) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Parse current state from URL
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || String(defaultLimit), 10);
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
