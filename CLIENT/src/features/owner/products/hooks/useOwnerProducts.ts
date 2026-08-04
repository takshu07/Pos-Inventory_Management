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
  createFullProduct,
  createOwnerProduct,
  deleteOwnerProduct,
  duplicateOwnerProduct,
  fetchColorOptions,
  fetchOwnerProduct,
  fetchOwnerProducts,
  fetchOwnerStats,
  fetchSizeOptions,
  fetchSupplierOptions,
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

/** The product creation wizard's atomic submit. */
export function useCreateFullProduct() {
  const invalidate = useInvalidateOwnerProducts();
  return useMutation({
    mutationFn: (payload: unknown) => createFullProduct(payload),
    onSuccess: invalidate,
  });
}

// ── Wizard lookups (sizes / colors / suppliers) ───────────────────────────────

export function useSizeOptions() {
  return useQuery({
    queryKey: ["owner-product-lookups", "sizes"],
    queryFn: fetchSizeOptions,
    staleTime: 1000 * 60 * 5,
  });
}

export function useColorOptions() {
  return useQuery({
    queryKey: ["owner-product-lookups", "colors"],
    queryFn: fetchColorOptions,
    staleTime: 1000 * 60 * 5,
  });
}

export function useSupplierOptions() {
  return useQuery({
    queryKey: ["owner-product-lookups", "suppliers"],
    queryFn: fetchSupplierOptions,
    staleTime: 1000 * 60 * 5,
  });
}

// ── Category & brand options (reuse existing catalog endpoints) ────────────────
// These power the create/edit form and filter dropdowns. We deliberately reuse
// the existing /categories and /brands modules rather than duplicating them.
//
// ⚠ Use the `/options` endpoints, NOT the paginated list endpoints. The lists
// cap at `limit=100` and page 1, so a store with more than 100 categories would
// silently lose the rest from every dropdown. `/options` is the purpose-built
// unpaginated id+name projection and already excludes archived/inactive rows —
// so no `isActive` filter is passed here either. (Category has no `isActive`
// query param at all; it uses a `status` enum, and the old `isActive=true` was
// being stripped by Zod and doing nothing.)

async function fetchOptions(path: string): Promise<FilterOption[]> {
  const res = await apiClient.get<any>(path);
  const rows = res.data?.data ?? res.data ?? [];
  return rows.map((r: { id: string; name: string }) => ({ id: r.id, name: r.name }));
}

export function useCategoryOptions() {
  return useQuery({
    queryKey: ["catalog-options", "categories"],
    queryFn: () => fetchOptions("/categories/options"),
    staleTime: 1000 * 60 * 5,
  });
}

export function useBrandOptions() {
  return useQuery({
    queryKey: ["catalog-options", "brands"],
    queryFn: () => fetchOptions("/brands/options"),
    staleTime: 1000 * 60 * 5,
  });
}
