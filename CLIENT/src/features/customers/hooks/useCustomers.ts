import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchCustomers,
  createCustomer,
  getWalkInCustomer,
  getCustomerByPhone,
  getCustomerById,
  getExchangeEligibility,
} from "../api/customerApi";
import { CustomerQueryFilters, CustomerCreateDTO } from "../types";

export const customerKeys = {
  all: ["customers"] as const,
  lists: () => [...customerKeys.all, "list"] as const,
  list: (filters: CustomerQueryFilters) => [...customerKeys.lists(), filters] as const,
  walkIn: () => [...customerKeys.all, "walk-in"] as const,
  detail: (id: string) => [...customerKeys.all, "detail", id] as const,
  eligibility: (id: string) => [...customerKeys.all, "eligibility", id] as const,
};

export function useCustomers(filters: CustomerQueryFilters) {
  return useQuery({
    queryKey: customerKeys.list(filters),
    queryFn: () => fetchCustomers(filters),
    placeholderData: (prev) => prev,
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
