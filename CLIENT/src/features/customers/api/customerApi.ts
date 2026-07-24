import { apiClient } from "@/lib/api/axios";
import {
  CustomerModel,
  CustomerCreateDTO,
  CustomerQueryFilters,
  CustomersPaginatedResponse,
  ExchangeEligibilityResponse,
} from "../types";

export async function fetchCustomers(filters: CustomerQueryFilters): Promise<CustomersPaginatedResponse> {
  const cleanFilters = Object.fromEntries(
    Object.entries(filters).filter(([_, value]) => value !== "" && value !== null && value !== undefined)
  );

  const response = await apiClient.get<any>("/customers", { params: cleanFilters });
  
  return {
    total: response.data?.total || 0,
    data: response.data?.data || [],
  };
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
