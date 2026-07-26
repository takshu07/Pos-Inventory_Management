import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiClient } from "@/lib/api/axios";
import type { FilterOption } from "@/shared/product";
import {
  adjustOwnerStock,
  archiveOwnerProduct,
  createOwnerProduct,
  deleteOwnerProduct,
  duplicateOwnerProduct,
  fetchOwnerProduct,
  fetchOwnerProducts,
  fetchOwnerStats,
  restoreOwnerProduct,
  updateOwnerPricing,
  updateOwnerProduct,
  type OwnerListParams,
  type ProductWriteInput,
} from "../api/ownerProductApi";

export const ownerProductKeys = {
  all: ["owner-products"] as const,
  lists: () => [...ownerProductKeys.all, "list"] as const,
  list: (params: OwnerListParams) => [...ownerProductKeys.lists(), params] as const,
  stats: () => [...ownerProductKeys.all, "stats"] as const,
  detail: (id: string) => [...ownerProductKeys.all, "detail", id] as const,
};

/** Server-side paginated/filtered/sorted owner catalog list. */
export function useOwnerProducts(params: OwnerListParams) {
  return useQuery({
    queryKey: ownerProductKeys.list(params),
    queryFn: () => fetchOwnerProducts(params),
    placeholderData: keepPreviousData, // keep the current page while the next loads
  });
}

export function useOwnerProductStats() {
  return useQuery({
    queryKey: ownerProductKeys.stats(),
    queryFn: fetchOwnerStats,
    staleTime: 1000 * 60 * 2,
  });
}

export function useOwnerProduct(id: string | undefined) {
  return useQuery({
    queryKey: ownerProductKeys.detail(id ?? ""),
    queryFn: () => fetchOwnerProduct(id as string),
    enabled: !!id,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

function useInvalidateOwnerProducts() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ownerProductKeys.all });
  };
}

export function useCreateOwnerProduct() {
  const invalidate = useInvalidateOwnerProducts();
  return useMutation({
    mutationFn: (input: ProductWriteInput) => createOwnerProduct(input),
    onSuccess: invalidate,
  });
}

export function useUpdateOwnerProduct() {
  const invalidate = useInvalidateOwnerProducts();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<ProductWriteInput> }) =>
      updateOwnerProduct(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteOwnerProduct() {
  const invalidate = useInvalidateOwnerProducts();
  return useMutation({
    mutationFn: (id: string) => deleteOwnerProduct(id),
    onSuccess: invalidate,
  });
}

export function useArchiveOwnerProduct() {
  const invalidate = useInvalidateOwnerProducts();
  return useMutation({
    mutationFn: (id: string) => archiveOwnerProduct(id),
    onSuccess: invalidate,
  });
}

export function useRestoreOwnerProduct() {
  const invalidate = useInvalidateOwnerProducts();
  return useMutation({
    mutationFn: (id: string) => restoreOwnerProduct(id),
    onSuccess: invalidate,
  });
}

export function useDuplicateOwnerProduct() {
  const invalidate = useInvalidateOwnerProducts();
  return useMutation({
    mutationFn: (id: string) => duplicateOwnerProduct(id),
    onSuccess: invalidate,
  });
}

export function useAdjustOwnerStock() {
  const invalidate = useInvalidateOwnerProducts();
  return useMutation({
    mutationFn: adjustOwnerStock,
    onSuccess: invalidate,
  });
}

export function useUpdateOwnerPricing() {
  const invalidate = useInvalidateOwnerProducts();
  return useMutation({
    mutationFn: updateOwnerPricing,
    onSuccess: invalidate,
  });
}

// ── Category & brand options (reuse existing catalog endpoints) ────────────────
// These power the create/edit form and filter dropdowns. We deliberately reuse
// the existing /categories and /brands modules rather than duplicating them.

async function fetchOptions(path: string): Promise<FilterOption[]> {
  const res = await apiClient.get<any>(path, { params: { isActive: "true", limit: 100 } });
  const rows = res.data?.data ?? res.data ?? [];
  return rows.map((r: { id: string; name: string }) => ({ id: r.id, name: r.name }));
}

export function useCategoryOptions() {
  return useQuery({
    queryKey: ["catalog-options", "categories"],
    queryFn: () => fetchOptions("/categories"),
    staleTime: 1000 * 60 * 5,
  });
}

export function useBrandOptions() {
  return useQuery({
    queryKey: ["catalog-options", "brands"],
    queryFn: () => fetchOptions("/brands"),
    staleTime: 1000 * 60 * 5,
  });
}
