import { useQuery } from "@tanstack/react-query";
import { fetchSales, fetchSaleById } from "../api/salesApi";
import { SalesQueryFilters } from "../types";

export const salesKeys = {
  all: ["sales"] as const,
  lists: () => [...salesKeys.all, "list"] as const,
  list: (filters: SalesQueryFilters) => [...salesKeys.lists(), filters] as const,
  details: () => [...salesKeys.all, "detail"] as const,
  detail: (id: string) => [...salesKeys.details(), id] as const,
};

export function useSalesHistory(filters: SalesQueryFilters) {
  return useQuery({
    queryKey: salesKeys.list(filters),
    queryFn: () => fetchSales(filters),
    placeholderData: (previousData) => previousData, // keep old data while paginating
  });
}

export function useInvoiceDetail(id: string) {
  return useQuery({
    queryKey: salesKeys.detail(id),
    queryFn: () => fetchSaleById(id),
    staleTime: 5 * 60 * 1000, // 5 minutes (Invoices don't change often)
    gcTime: 30 * 60 * 1000,   // 30 minutes garbage collection
    enabled: !!id,
  });
}
