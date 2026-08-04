import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/axios";

/**
 * Warms the catalog lookup caches (categories / brands / suppliers) as soon as
 * the authenticated shell mounts.
 *
 * WHY THIS EXISTS
 * Filter dropdowns render their static "All categories" entry immediately and
 * their real options only once the lookup request resolves. On a cold cache the
 * user sees a one-item list that visibly grows a moment later — options appear
 * to "load late", and a fast click lands on a list that has not filled in yet.
 *
 * Prefetching here fixes that for every screen at once rather than per page:
 * the shell mounts long before any table does, and these three lists are shared
 * by products, inventory, procurement and the label batch dialog. By the time a
 * filter bar mounts the data is already cached, so the full list paints on the
 * first render.
 *
 * The query keys and fetchers below MUST match the ones the feature hooks use
 * (`useCategoryOptions` / `useBrandOptions` in owner products, and
 * `useSupplierOptions` in procurement) — a mismatched key would prefetch into a
 * cache entry nobody reads, which is invisible rather than loud. The keys are
 * duplicated rather than imported to keep this bootstrap file from pulling
 * feature bundles into the shell chunk; `verifyLookupPrefetchKeys` in the tests
 * pins them together.
 *
 * Failures are deliberately swallowed. This is an optimisation — if a lookup
 * 401s or the network is down, the feature hook will run normally and surface
 * the error in context. A rejected prefetch must never break the shell.
 */

async function fetchRows(path: string): Promise<Record<string, any>[]> {
  const res = await apiClient.get<any>(path);
  return res.data ?? [];
}

/**
 * Each entry mirrors ONE feature hook exactly — same key, same URL, and the
 * same projection that hook applies. The projection matters: the cached value
 * is what the hook's consumers destructure, so prefetching raw rows where the
 * hook caches `{id, name}` would put a differently-shaped object in the cache.
 */
export const CATALOG_LOOKUP_PREFETCHES = [
  {
    // mirrors useCategoryOptions() in features/owner/products/hooks
    key: ["catalog-options", "categories"] as const,
    path: "/categories/options",
    select: (rows: Record<string, any>[]) =>
      rows.map((r) => ({ id: r["id"], name: r["name"] })),
  },
  {
    // mirrors useBrandOptions() in features/owner/products/hooks
    key: ["catalog-options", "brands"] as const,
    path: "/brands/options",
    select: (rows: Record<string, any>[]) =>
      rows.map((r) => ({ id: r["id"], name: r["name"] })),
  },
  {
    // mirrors useSupplierOptions() -> procurementKeys.supplierOptions()
    key: ["procurement", "suppliers", "options"] as const,
    path: "/suppliers/options",
    select: (rows: Record<string, any>[]) =>
      rows.map((r) => ({ id: r["id"], businessName: r["businessName"] })),
  },
] as const;

export function useCatalogLookupPrefetch(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    for (const { key, path, select } of CATALOG_LOOKUP_PREFETCHES) {
      void queryClient
        .prefetchQuery({
          queryKey: key,
          queryFn: async () => select(await fetchRows(path)),
          staleTime: 1000 * 60 * 5,
        })
        .catch(() => {
          // Optimisation only — see the note above.
        });
    }
  }, [enabled, queryClient]);
}
