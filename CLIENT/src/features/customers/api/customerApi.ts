import { apiClient } from "@/lib/api/axios";
import { CustomerModel, CustomerCreateDTO, CustomerQueryFilters, CustomersPaginatedResponse } from "../types";

export async function fetchCustomers(filters: CustomerQueryFilters): Promise<CustomersPaginatedResponse> {
  const cleanFilters = Object.fromEntries(
    Object.entries(filters).filter(([_, value]) => value !== "" && value !== null && value !== undefined)
  );

  const response = await apiClient.get<any>("/customers", { params: cleanFilters });
  
  return {
    total: response.data?.data?.total || 0,
    data: response.data?.data?.data || [], // mapping might be needed if backend dates need parsing, but raw is fine for now
  };
}

export async function createCustomer(data: CustomerCreateDTO): Promise<CustomerModel> {
  const response = await apiClient.post<any>("/customers", data);
  return response.data?.data;
}

export async function getWalkInCustomer(): Promise<CustomerModel> {
  const response = await apiClient.get<any>("/customers/walk-in");
  return response.data?.data;
}

export async function getCustomerByPhone(phone: string): Promise<CustomerModel | null> {
  const response = await apiClient.get<any>(`/customers/phone/${phone}`);
  return response.data?.data || null;
}
