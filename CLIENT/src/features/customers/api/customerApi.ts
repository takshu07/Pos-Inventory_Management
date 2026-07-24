import { apiClient } from "@/lib/api/axios";
import {
  CustomerModel,
  CustomerCreateDTO,
  CustomerQueryFilters,
  CustomersPaginatedResponse,
  ExchangeEligibilityResponse,
  CustomerAnalytics,
  CustomerTableFilters,
  CustomerTableResponse,
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

export async function getExchangeEligibility(id: string): Promise<ExchangeEligibilityResponse> {
  const response = await apiClient.get<any>(`/customers/${id}/exchange-eligibility`);
  return response.data ?? { windowDays: 0, items: [] };
}
