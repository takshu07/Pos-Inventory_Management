import { apiClient } from "@/lib/api";
import { ProductListResponse } from "../types";

interface GetProductsOptions {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
}

export const getProducts = async (options?: GetProductsOptions): Promise<ProductListResponse> => {
  const response = await apiClient.get("/products", {
    params: {
      page: options?.page || 1,
      limit: options?.limit || 10,
      search: options?.search,
      categoryId: options?.categoryId,
    },
  });
  
  return response.data;
};
