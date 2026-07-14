import { useQuery, useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/axios";
import { PosVariant, CheckoutPayload } from "../types/pos.types";

// ============================================================================
// TYPES
// ============================================================================

interface VariantSearchResponse {
  success: boolean;
  data: {
    data: PosVariant[];
    meta: {
      total: number;
    };
  };
}

// CheckoutPayload is imported from pos.types.ts

// ============================================================================
// API CALLS
// ============================================================================

const searchVariants = async (searchStr: string): Promise<PosVariant[]> => {
  if (!searchStr.trim()) return [];
  // Uses existing product-variants endpoint with search filter
  const response = await apiClient.get<never, VariantSearchResponse>("/product-variants", {
    params: { search: searchStr, limit: 10 },
  });
  return response.data.data;
};

const lookupBarcode = async (barcode: string): Promise<PosVariant> => {
  const response = await apiClient.get<never, { data: PosVariant }>(`/product-variants/barcode/${barcode}`);
  return response.data;
};

const createSale = async (payload: CheckoutPayload): Promise<any> => {
  const idempotencyKey = crypto.randomUUID();
  const response = await apiClient.post<never, { data: any }>("/sales", payload, {
    headers: {
      "Idempotency-Key": idempotencyKey,
    },
  });
  return response.data;
};

// ============================================================================
// HOOKS
// ============================================================================

export const useSearchVariants = (searchStr: string) => {
  return useQuery({
    queryKey: ["pos", "variants", "search", searchStr],
    queryFn: () => searchVariants(searchStr),
    enabled: searchStr.trim().length > 2,
    staleTime: 1000 * 60 * 5, // 5 mins
  });
};

export const useCheckout = () => {
  return useMutation({
    mutationFn: createSale,
  });
};
