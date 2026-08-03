import { apiClient } from "@/lib/api/axios";
import {
  CustomerModel,
  CustomerCreateDTO,
  CustomerQueryFilters,
  CustomersPaginatedResponse,
  CustomerSearchResult,
  ExchangeEligibilityResponse,
  CustomerAnalytics,
  CustomerTableFilters,
  CustomerTableResponse,
  CustomerProfile,
} from "../types";

export async function fetchCustomers(filters: CustomerQueryFilters): Promise<CustomersPaginatedResponse> {
  const cleanFilters = Object.fromEntries(
    Object.entries(filters).filter(([_, value]) => value !== "" && value !== null && value !== undefined)
  );

  const response = await apiClient.get<any>("/customers", { params: cleanFilters });

  // `/customers` returns the shared paginated envelope: { data, meta: { total, ... } }.
  // Read `total` from `meta.total` — same contract as fetchCustomerTable (/customers/table).
  return {
    total: response.data?.meta?.total ?? 0,
    data: response.data?.data ?? [],
  };
}

/**
 * Ranked live typeahead search. Returns a flat, relevance-ordered list (prefix
 * matches first) of lightweight rows — never the full paginated envelope.
 *
 * Accepts an AbortSignal (supplied by React Query) so a keystroke that fires a
 * newer request cancels the in-flight older one — the latest query always wins
 * and stale responses can never overwrite fresh results.
 */
export async function searchCustomers(
  q: string,
  limit: number,
  signal?: AbortSignal
): Promise<CustomerSearchResult[]> {
  const response = await apiClient.get<any>("/customers/search", {
    params: { q, limit },
    signal,
  });
  return response.data ?? [];
}

/**
 * Owner/manager customer table. Server-side paginated + filtered + sorted;
 * only the current page is fetched. Reads `total` from the paginated meta.
 */
export async function fetchCustomerTable(
  filters: CustomerTableFilters
): Promise<CustomerTableResponse> {
  const cleanFilters = Object.fromEntries(
    Object.entries(filters).filter(
      ([, value]) => value !== "" && value !== null && value !== undefined && value !== false
    )
  );

  const response = await apiClient.get<any>("/customers/table", { params: cleanFilters });

  return {
    total: response.data?.meta?.total ?? 0,
    data: response.data?.data ?? [],
  };
}

/** Aggregate metrics for the owner analytics cards. */
export async function fetchCustomerAnalytics(): Promise<CustomerAnalytics> {
  const response = await apiClient.get<any>("/customers/analytics");
  return response.data;
}

export async function createCustomer(data: CustomerCreateDTO): Promise<CustomerModel> {
  const response = await apiClient.post<any>("/customers", data);
  return response.data;
}

export async function getWalkInCustomer(): Promise<CustomerModel> {
  const response = await apiClient.get<any>("/customers/walk-in");
  return response.data;
}

export async function getCustomerByPhone(phone: string): Promise<CustomerModel | null> {
  const response = await apiClient.get<any>(`/customers/phone/${phone}`);
  return response.data || null;
}

export async function getCustomerById(id: string): Promise<CustomerModel> {
  const response = await apiClient.get<any>(`/customers/${id}`);
  return response.data;
}

/**
 * Full customer profile (OWNER-only): record, rollups, and the capped purchase,
 * exchange and top-product histories in a single response. One request rather
 * than four — the profile always renders every tab.
 */
export async function getCustomerProfile(id: string): Promise<CustomerProfile> {
  const response = await apiClient.get<any>(`/customers/${id}/profile`);
  return response.data;
}

export async function getExchangeEligibility(id: string): Promise<ExchangeEligibilityResponse> {
  const response = await apiClient.get<any>(`/customers/${id}/exchange-eligibility`);
  return response.data ?? { windowDays: 0, items: [] };
}
