/**
 * Discounts — React Query hooks.
 *
 * Every mutation invalidates BOTH the discount keys and the product/pricing
 * keys: changing a rule changes shelf prices, so any product list, product
 * detail or pricing panel already on screen is stale the moment a rule is
 * saved. Missing that is how a UI ends up showing yesterday's price.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { pricingKeys } from "@/shared/product";

import {
  bulkDiscountAction,
  createCategoryDiscount,
  createProductDiscount,
  deleteDiscount,
  fetchDiscount,
  fetchDiscountDashboard,
  fetchDiscountHistory,
  fetchDiscounts,
  fetchCategoryOptions,
  fetchImpact,
  searchProductOptions,
  updateDiscount,
  type DiscountListParams,
  type DiscountWriteInput,
} from "../api/discountApi";

export const discountKeys = {
  all: ["discounts"] as const,
  lists: () => [...discountKeys.all, "list"] as const,
  list: (params: DiscountListParams) => [...discountKeys.lists(), params] as const,
  dashboard: () => [...discountKeys.all, "dashboard"] as const,
  history: (params: object) => [...discountKeys.all, "history", params] as const,
  detail: (id: string) => [...discountKeys.all, "detail", id] as const,
  impact: (target: object) => [...discountKeys.all, "impact", target] as const,
};

// pricingKeys lives in shared/product/pricingApi — both portals read that cache,
// so invalidation here must target the same keys the shared hook populates.

// ── Queries ──────────────────────────────────────────────────────────────────

export function useDiscounts(params: DiscountListParams) {
  return useQuery({
    queryKey: discountKeys.list(params),
    queryFn: () => fetchDiscounts(params),
    placeholderData: keepPreviousData, // keep the current page while the next loads
  });
}

export function useDiscountDashboard() {
  return useQuery({
    queryKey: discountKeys.dashboard(),
    queryFn: fetchDiscountDashboard,
    // Status is derived from the clock, so the dashboard goes stale on its own
    // as rules activate and expire. A short window keeps it honest without
    // hammering the API.
    staleTime: 1000 * 60,
    refetchOnWindowFocus: true,
  });
}

export function useDiscountHistory(params: { page: number; limit: number; ruleId?: string }) {
  return useQuery({
    queryKey: discountKeys.history(params),
    queryFn: () => fetchDiscountHistory(params),
    placeholderData: keepPreviousData,
  });
}

export function useDiscount(id: string | undefined) {
  return useQuery({
    queryKey: discountKeys.detail(id ?? ""),
    queryFn: () => fetchDiscount(id as string),
    enabled: !!id,
  });
}

/** "This rule affects N variants" — shown live in the rule editor. */
export function useDiscountImpact(target: {
  scope: "PRODUCT" | "CATEGORY";
  productId?: string;
  categoryId?: string;
}) {
  const enabled = target.scope === "PRODUCT" ? !!target.productId : !!target.categoryId;
  return useQuery({
    queryKey: discountKeys.impact(target),
    queryFn: () => fetchImpact(target),
    enabled,
    staleTime: 1000 * 30,
  });
}

// ── Target pickers ───────────────────────────────────────────────────────────

/** Product typeahead for the rule editor. Idle until the user types 2+ chars. */
export function useProductOptions(search: string) {
  return useQuery({
    queryKey: ["discount-targets", "products", search],
    queryFn: () => searchProductOptions(search),
    enabled: search.trim().length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60,
  });
}

export function useCategoryTargetOptions() {
  return useQuery({
    queryKey: ["catalog-options", "categories"],
    queryFn: fetchCategoryOptions,
    staleTime: 1000 * 60 * 5,
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * Invalidate everything a rule change can affect.
 *
 * Discount rules feed ProductVariant.sellingPrice, which is rendered by the
 * product lists, the product detail drawer and the pricing panels — so those
 * caches must be dropped too, not just the discount ones.
 */
function useInvalidateDiscounts() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: discountKeys.all });
    qc.invalidateQueries({ queryKey: pricingKeys.all });
    qc.invalidateQueries({ queryKey: ["owner-products"] });
    qc.invalidateQueries({ queryKey: ["manager-products"] });
  };
}

export function useCreateProductDiscount() {
  const invalidate = useInvalidateDiscounts();
  return useMutation({
    mutationFn: (input: DiscountWriteInput & { productId: string }) => createProductDiscount(input),
    onSuccess: invalidate,
  });
}

export function useCreateCategoryDiscount() {
  const invalidate = useInvalidateDiscounts();
  return useMutation({
    mutationFn: (input: DiscountWriteInput & { categoryId: string }) => createCategoryDiscount(input),
    onSuccess: invalidate,
  });
}

export function useUpdateDiscount() {
  const invalidate = useInvalidateDiscounts();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<DiscountWriteInput> }) =>
      updateDiscount(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteDiscount() {
  const invalidate = useInvalidateDiscounts();
  return useMutation({
    mutationFn: (id: string) => deleteDiscount(id),
    onSuccess: invalidate,
  });
}

export function useBulkDiscountAction() {
  const invalidate = useInvalidateDiscounts();
  return useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: "ENABLE" | "DISABLE" | "DELETE" }) =>
      bulkDiscountAction(ids, action),
    onSuccess: invalidate,
  });
}
