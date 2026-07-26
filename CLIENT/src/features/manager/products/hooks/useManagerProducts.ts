import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  fetchManagerBrands,
  fetchManagerCategories,
  fetchManagerProduct,
  fetchManagerProducts,
  searchManagerProducts,
  type ManagerListParams,
} from "../api/managerProductApi";

export const managerProductKeys = {
  all: ["manager-products"] as const,
  lists: () => [...managerProductKeys.all, "list"] as const,
  list: (params: ManagerListParams) => [...managerProductKeys.lists(), params] as const,
  search: (q: string, limit: number) => [...managerProductKeys.all, "search", q, limit] as const,
  detail: (id: string) => [...managerProductKeys.all, "detail", id] as const,
  categories: () => [...managerProductKeys.all, "categories"] as const,
  brands: () => [...managerProductKeys.all, "brands"] as const,
};

export function useManagerProducts(params: ManagerListParams) {
  return useQuery({
    queryKey: managerProductKeys.list(params),
    queryFn: () => fetchManagerProducts(params),
    placeholderData: keepPreviousData,
  });
}

/**
 * Live typeahead for the manager lookup. React Query supplies the AbortSignal so
 * a newer keystroke cancels the older in-flight request — the latest term always
 * wins and stale responses can never overwrite fresh ones.
 */
export function useManagerProductSearch(term: string, limit = 10, enabled = true) {
  return useQuery({
    queryKey: managerProductKeys.search(term, limit),
    queryFn: ({ signal }) => searchManagerProducts(term, limit, signal),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 30,
  });
}

export function useManagerProduct(id: string | undefined) {
  return useQuery({
    queryKey: managerProductKeys.detail(id ?? ""),
    queryFn: () => fetchManagerProduct(id as string),
    enabled: !!id,
  });
}

export function useManagerCategories() {
  return useQuery({
    queryKey: managerProductKeys.categories(),
    queryFn: fetchManagerCategories,
    staleTime: 1000 * 60 * 5,
  });
}

export function useManagerBrands() {
  return useQuery({
    queryKey: managerProductKeys.brands(),
    queryFn: fetchManagerBrands,
    staleTime: 1000 * 60 * 5,
  });
}
