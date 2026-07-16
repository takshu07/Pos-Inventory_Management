import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createExchange, getExchangeById, getExchanges } from "../api/exchange.api";
import { CreateExchangePayload } from "../types";

export const exchangeKeys = {
  all: ["exchanges"] as const,
  detail: (id: string) => [...exchangeKeys.all, "detail", id] as const,
};

export function useCreateExchange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateExchangePayload) => createExchange(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: exchangeKeys.all });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
  });
}

export function useExchangeDetail(id: string) {
  return useQuery({
    queryKey: exchangeKeys.detail(id),
    queryFn: () => getExchangeById(id),
    enabled: !!id,
  });
}

export function useExchanges(params: { page?: number; limit?: number; search?: string }) {
  return useQuery({
    queryKey: [...exchangeKeys.all, "list", params],
    queryFn: () => getExchanges(params),
  });
}
