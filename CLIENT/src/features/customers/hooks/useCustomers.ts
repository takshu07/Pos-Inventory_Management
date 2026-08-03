import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  fetchCustomers,
  searchCustomers,
  createCustomer,
  getWalkInCustomer,
  getCustomerByPhone,
  getCustomerById,
  getCustomerProfile,
  getExchangeEligibility,
  fetchCustomerTable,
  fetchCustomerAnalytics,
} from "../api/customerApi";
import { CustomerQueryFilters, CustomerCreateDTO, CustomerTableFilters } from "../types";

export const customerKeys = {
  all: ["customers"] as const,
  lists: () => [...customerKeys.all, "list"] as const,
  list: (filters: CustomerQueryFilters) => [...customerKeys.lists(), filters] as const,
  search: (q: string, limit: number) => [...customerKeys.all, "search", q, limit] as const,
  table: (filters: CustomerTableFilters) => [...customerKeys.all, "table", filters] as const,
  analytics: () => [...customerKeys.all, "analytics"] as const,
  walkIn: () => [...customerKeys.all, "walk-in"] as const,
  detail: (id: string) => [...customerKeys.all, "detail", id] as const,
  profile: (id: string) => [...customerKeys.all, "profile", id] as const,
  eligibility: (id: string) => [...customerKeys.all, "eligibility", id] as const,
};

export function useCustomers(filters: CustomerQueryFilters) {
  return useQuery({
    queryKey: customerKeys.list(filters),
    queryFn: () => fetchCustomers(filters),
    placeholderData: (prev) => prev,
  });
}

/**
 * Live ranked typeahead search — the engine behind the customer search combobox.
 *
 * The caller passes the *debounced* term (debounce lives in the component so the
 * input stays instant). Behaviour:
 *  - Each distinct term is its own cache key, so results are memoized and a
 *    re-typed term is served instantly from cache (no flicker, no refetch).
 *  - React Query hands the queryFn an AbortSignal; a newer keystroke cancels the
 *    older in-flight request, so the latest query always wins (no race).
 *  - `placeholderData: keepPreviousData` keeps the previous matches on screen
 *    while the next term loads — the list updates in place instead of flashing
 *    empty. `isFetching` drives the in-box spinner.
 *  - Empty term is still queried on purpose: the server returns recent customers
 *    for the empty-state list.
 */
export function useCustomerSearch(term: string, limit = 8, enabled = true) {
  return useQuery({
    queryKey: customerKeys.search(term, limit),
    queryFn: ({ signal }) => searchCustomers(term, limit, signal),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 30, // a term's results are stable for ~30s
  });
}

/**
 * Owner/manager customer table. Server-side pagination — `placeholderData`
 * keeps the previous page visible while the next page loads (no flash).
 */
export function useCustomerTable(filters: CustomerTableFilters) {
  return useQuery({
    queryKey: customerKeys.table(filters),
    queryFn: () => fetchCustomerTable(filters),
    placeholderData: (prev) => prev,
  });
}

/** Owner analytics cards. */
export function useCustomerAnalytics(enabled = true) {
  return useQuery({
    queryKey: customerKeys.analytics(),
    queryFn: fetchCustomerAnalytics,
    enabled,
    staleTime: 1000 * 60 * 2, // metrics tolerate a couple minutes of staleness
  });
}

export function useWalkInCustomer() {
  return useQuery({
    queryKey: customerKeys.walkIn(),
    queryFn: getWalkInCustomer,
    staleTime: Infinity, // Walk-in customer rarely changes
  });
}

export function useCustomerByPhone(phone: string) {
  return useQuery({
    queryKey: [...customerKeys.all, "phone-lookup", phone], // Changed key to forcefully bypass browser's ghost cache
    queryFn: () => getCustomerByPhone(phone),
    enabled: phone.length >= 10,
    staleTime: 1000 * 10, // 10 seconds (enough to prevent spam, but clears errors fast)
    retry: false, // Don't retry if 404/not found
  });
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: customerKeys.detail(id ?? ""),
    queryFn: () => getCustomerById(id as string),
    enabled: !!id,
  });
}

/**
 * Full customer profile (OWNER-only). Kept on its own cache key rather than
 * reusing `detail`: the two endpoints return different shapes, and sharing a key
 * would let a cashier's lightweight `/customers/:id` response satisfy — and
 * silently blank out — the profile screen's tabs.
 */
export function useCustomerProfile(id: string | undefined) {
  return useQuery({
    queryKey: customerKeys.profile(id ?? ""),
    queryFn: () => getCustomerProfile(id as string),
    enabled: !!id,
    retry: false, // 403/404 are answers, not transient failures
  });
}

export function useExchangeEligibility(id: string | undefined) {
  return useQuery({
    queryKey: customerKeys.eligibility(id ?? ""),
    queryFn: () => getExchangeEligibility(id as string),
    enabled: !!id,
    staleTime: 1000 * 60, // 1 min — window math only changes across day boundaries
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CustomerCreateDTO) => createCustomer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}
