import { apiClient } from "@/lib/api/axios";
import { SalesPaginatedResponse, SalesQueryFilters, InvoiceDetailModel } from "../types";
import { mapToSaleHistoryRow, mapToInvoiceDetail } from "./sales.mapper";

export async function fetchSales(filters: SalesQueryFilters): Promise<SalesPaginatedResponse> {
  // Strip out empty string parameters to prevent backend validation errors (400 Bad Request)
  const cleanFilters = Object.fromEntries(
    Object.entries(filters).filter(([_, value]) => value !== "" && value !== null && value !== undefined)
  );

  const response = await apiClient.get<any>("/sales", {
    params: cleanFilters,
  });

  // Backend interceptor returns { success, message, data: { total, data: [] } }
  const payload = response.data;
  
  return {
    total: payload?.total || 0,
    data: (payload?.data || []).map(mapToSaleHistoryRow),
  };
}

export async function fetchSaleById(id: string): Promise<InvoiceDetailModel> {
  const response = await apiClient.get<any>(`/sales/${id}`);
  
  // Backend interceptor returns { success, message, data: { ...saleObject } }
  return mapToInvoiceDetail(response.data);
}
