/**
 * Category React Query hooks — shared by both portals.
 *
 * CACHING STRATEGY
 *  • Lists use `keepPreviousData` so paging/filtering never flashes a skeleton
 *    over data the user is already reading.
 *  • Every mutation invalidates the whole `categoryKeys.all` subtree. Category
 *    writes change product counts and summary counters as well as the row
 *    itself, so surgical invalidation would leave the dashboard cards stale.
 *  • Status changes are OPTIMISTIC: archive/activate flips the row instantly and
 *    rolls back on failure. Create/delete are not — they change pagination and
 *    totals, and guessing the server's placement produces a visible correction.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Role } from "@/types";
import {
  activateCategory,
  archiveCategory,
  assignCategoryDiscount,
  bulkCategoryAction,
  categoryBase,
  createCategory,
  deleteCategory,
  fetchCategories,
  fetchCategoryActivity,
  fetchCategoryAnalytics,
  fetchCategoryDiscounts,
  fetchCategoryOptions,
  fetchCategoryProducts,
  fetchCategoryReport,
  fetchCategorySummary,
  fetchSingleCategoryAnalytics,
  setCategoryImage,
  updateCategory,
  type AssignDiscountInput,
  type CategoryListParams,
  type CategoryWriteInput,
} from "./categoryApi";
import type { CategoryRow } from "./types";

export const categoryKeys = {
  all: ["categories"] as const,
  lists: () => [...categoryKeys.all, "list"] as const,
  list: (base: string, params: CategoryListParams) =>
    [...categoryKeys.lists(), base, params] as const,
  summary: (base: string) => [...categoryKeys.all, "summary", base] as const,
  options: (base: string, exclude?: string) =>
    [...categoryKeys.all, "options", base, exclude ?? ""] as const,
  detail: (base: string, id: string) => [...categoryKeys.all, "detail", base, id] as const,
  products: (base: string, id: string, page: number, search: string) =>
    [...categoryKeys.all, "products", base, id, page, search] as const,
  discounts: (id: string) => [...categoryKeys.all, "discounts", id] as const,
  activity: (id: string, page: number) => [...categoryKeys.all, "activity", id, page] as const,
  analytics: (period: string) => [...categoryKeys.all, "analytics", period] as const,
  categoryAnalytics: (id: string, period: string) =>
    [...categoryKeys.all, "analytics", id, period] as const,
  report: (report: string, period: string) =>
    [...categoryKeys.all, "report", report, period] as const,
};

// ── Reads ────────────────────────────────────────────────────────────────────

export function useCategories(role: Role | null, params: CategoryListParams) {
  const base = categoryBase(role);
  return useQuery({
    queryKey: categoryKeys.list(base, params),
    queryFn: () => fetchCategories(base, params),
    placeholderData: keepPreviousData,
  });
}

export function useCategorySummary(role: Role | null) {
  const base = categoryBase(role);
  return useQuery({
    queryKey: categoryKeys.summary(base),
    queryFn: () => fetchCategorySummary(base),
    staleTime: 1000 * 60 * 2,
  });
}

/** Destination options for the "move products to…" picker. */
export function useCategoryOptions(role: Role | null, excludeId?: string, enabled = true) {
  const base = categoryBase(role);
  return useQuery({
    queryKey: categoryKeys.options(base, excludeId),
    queryFn: () => fetchCategoryOptions(base, excludeId),
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}

export function useCategoryProducts(
  role: Role | null,
  categoryId: string | undefined,
  params: { page: number; limit: number; search?: string; sortBy?: string }
) {
  const base = categoryBase(role);
  return useQuery({
    queryKey: categoryKeys.products(base, categoryId ?? "", params.page, params.search ?? ""),
    queryFn: () => fetchCategoryProducts(base, categoryId as string, params),
    enabled: !!categoryId,
    placeholderData: keepPreviousData,
  });
}

export function useCategoryDiscounts(categoryId: string | undefined) {
  return useQuery({
    queryKey: categoryKeys.discounts(categoryId ?? ""),
    queryFn: () => fetchCategoryDiscounts(categoryId as string),
    enabled: !!categoryId,
  });
}

export function useCategoryActivity(categoryId: string | undefined, page = 1, limit = 20) {
  return useQuery({
    queryKey: categoryKeys.activity(categoryId ?? "", page),
    queryFn: () => fetchCategoryActivity(categoryId as string, { page, limit }),
    enabled: !!categoryId,
    placeholderData: keepPreviousData,
  });
}

export function useCategoryAnalytics(period = "30d", limit = 10) {
  return useQuery({
    queryKey: categoryKeys.analytics(period),
    queryFn: () => fetchCategoryAnalytics({ period, limit }),
    staleTime: 1000 * 60 * 5, // analytics are expensive and change slowly
  });
}

export function useSingleCategoryAnalytics(categoryId: string | undefined, period = "30d") {
  return useQuery({
    queryKey: categoryKeys.categoryAnalytics(categoryId ?? "", period),
    queryFn: () => fetchSingleCategoryAnalytics(categoryId as string, { period }),
    enabled: !!categoryId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useCategoryReport(report: string, period = "30d", enabled = true) {
  return useQuery({
    queryKey: categoryKeys.report(report, period),
    queryFn: () => fetchCategoryReport(report, { period }),
    enabled,
    staleTime: 1000 * 60 * 5,
  });
}

// ── Mutations (OWNER only) ───────────────────────────────────────────────────

function useInvalidateCategories() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: categoryKeys.all });
  };
}

export function useCreateCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: (input: CategoryWriteInput) => createCategory(input),
    onSuccess: invalidate,
  });
}

export function useUpdateCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CategoryWriteInput> }) =>
      updateCategory(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: ({ id, reassignToId }: { id: string; reassignToId?: string }) =>
      deleteCategory(id, reassignToId),
    onSuccess: invalidate,
  });
}

/**
 * Archive / activate with an optimistic flip.
 *
 * Status is a single field with an obvious resulting value, so the UI can show
 * the outcome immediately and reconcile on settle. `cancelQueries` prevents an
 * in-flight list refetch from overwriting the optimistic state.
 */
function useOptimisticStatus(
  mutationFn: (id: string) => Promise<CategoryRow>,
  nextStatus: "ARCHIVED" | "ACTIVE"
) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn,
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: categoryKeys.lists() });
      const snapshot = qc.getQueriesData({ queryKey: categoryKeys.lists() });

      qc.setQueriesData(
        { queryKey: categoryKeys.lists() },
        (old: { data: CategoryRow[] } | undefined) =>
          old
            ? {
                ...old,
                data: old.data.map((c) =>
                  c.id === id
                    ? { ...c, status: nextStatus, isActive: nextStatus === "ACTIVE" }
                    : c
                ),
              }
            : old
      );

      return { snapshot };
    },
    onError: (_err, _id, context) => {
      // Roll back every list we touched.
      context?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: categoryKeys.all });
    },
  });
}

export function useArchiveCategory() {
  return useOptimisticStatus(archiveCategory, "ARCHIVED");
}

export function useActivateCategory() {
  return useOptimisticStatus(activateCategory, "ACTIVE");
}

export function useBulkCategoryAction() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: ({
      ids,
      action,
    }: {
      ids: string[];
      action: "ARCHIVE" | "ACTIVATE" | "DEACTIVATE" | "DELETE";
    }) => bulkCategoryAction(ids, action),
    onSuccess: invalidate,
  });
}

export function useAssignCategoryDiscount() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AssignDiscountInput }) =>
      assignCategoryDiscount(id, input),
    onSuccess: invalidate,
  });
}

export function useSetCategoryImage() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: ({ id, imageUrl }: { id: string; imageUrl: string }) =>
      setCategoryImage(id, imageUrl),
    onSuccess: invalidate,
  });
}
