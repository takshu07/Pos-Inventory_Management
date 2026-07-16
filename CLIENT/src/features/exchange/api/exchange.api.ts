import { apiClient } from "@/lib/api/axios";
import { CreateExchangePayload, ExchangeModel } from "../types";

export async function createExchange(payload: CreateExchangePayload): Promise<ExchangeModel> {
  const response = await apiClient.post<any>("/exchanges", payload);
  return response.data;
}

export async function getExchangeById(id: string): Promise<ExchangeModel> {
  const response = await apiClient.get<any>(`/exchanges/${id}`);
  return response.data;
}

export async function getExchanges(params: { page?: number; limit?: number; search?: string }): Promise<{ items: ExchangeModel[]; total: number }> {
  const response = await apiClient.get<any>("/exchanges", { params });
  return response.data;
}
