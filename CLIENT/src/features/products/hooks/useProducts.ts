import { useQuery } from "@tanstack/react-query";
import { getProducts } from "../api/getProducts";

interface UseProductsOptions {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
}

/**
 * Hook: useProducts
 * Responsibility: Manages the server state for the product list.
 * Exposes loading, error, and data states natively via TanStack Query.
 */
export const useProducts = (options?: UseProductsOptions) => {
  return useQuery({
    queryKey: ["products", options],
    queryFn: () => getProducts(options),
    // Ensures we don't fetch if dependencies aren't ready, can be expanded.
  });
};
