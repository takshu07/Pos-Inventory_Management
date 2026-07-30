/**
 * Inventory Management — React Query hooks.
 *
 * Caching strategy, and why it differs per surface:
 *
 *   • STOCK-BEARING data (overview, dashboard, detail) is polled. Stock is the
 *     thing two tills can change simultaneously, and a stock figure that is
 *     five minutes stale is worse than no figure — it invites someone to
 *     promise goods that are already sold.
 *
 *   • HISTORICAL data (movements, adjustments, completed counts) does not
 *     change retroactively, so it gets a real staleTime and no polling.
 *
 *   • ANALYTICS (valuation, velocity, aging) is expensive and rarely changes
 *     minute to minute — the longest staleTime of the three.
 *
 *   • DRAWER TABS are `enabled`-gated on the tab being open. Opening a drawer
 *     fetches ONE tab, not seven.
 *
 * Every list uses `placeholderData: (prev) => prev` so paging and filtering
 * update the table in place instead of flashing a skeleton over it.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import * as api from "../api/inventoryApi";
import type {
  AdjustmentParams,
  CreateAdjustmentPayload,
  CreateReservationPayload,
  CycleCountParams,
  DamagedParams,
  DashboardParams,
  MovementParams,
  ReorderParams,
  ReportDamagePayload,
  ReservationParams,
  ReviewAdjustmentPayload,
  StartCycleCountPayload,
  StockParams,
  ValuationParams,
  VelocityParams,
} from "../types";

// =============================================================================
// QUERY KEYS
// A single factory so an invalidation can never miss a key by mistyping it.
// =============================================================================

export const inventoryKeys = {
  all: ["inventory"] as const,

  dashboard: (p: DashboardParams) => [...inventoryKeys.all, "dashboard", p] as const,
  stock: (p: StockParams) => [...inventoryKeys.all, "stock", p] as const,
  detail: (id: string) => [...inventoryKeys.all, "detail", id] as const,
  detailPurchases: (id: string) => [...inventoryKeys.all, "detail", id, "purchases"] as const,
  detailSales: (id: string) => [...inventoryKeys.all, "detail", id, "sales"] as const,
  scan: (code: string) => [...inventoryKeys.all, "scan", code] as const,

  movements: (p: MovementParams) => [...inventoryKeys.all, "movements", p] as const,
  reservations: (p: ReservationParams) => [...inventoryKeys.all, "reservations", p] as const,
  adjustments: (p: AdjustmentParams) => [...inventoryKeys.all, "adjustments", p] as const,
  damaged: (p: DamagedParams) => [...inventoryKeys.all, "damaged", p] as const,

  cycleCounts: (p: CycleCountParams) => [...inventoryKeys.all, "cycle-counts", p] as const,
  cycleCount: (id: string) => [...inventoryKeys.all, "cycle-counts", id] as const,

  valuation: (p: ValuationParams) => [...inventoryKeys.all, "valuation", p] as const,
  reorder: (p: ReorderParams) => [...inventoryKeys.all, "reorder", p] as const,
  velocity: (p: VelocityParams) => [...inventoryKeys.all, "velocity", p] as const,
  lowStock: (p: StockParams) => [...inventoryKeys.all, "low-stock", p] as const,
  outOfStock: (p: StockParams) => [...inventoryKeys.all, "out-of-stock", p] as const,
  aging: () => [...inventoryKeys.all, "aging"] as const,
};

/**
 * How often stock-bearing queries refetch.
 *
 * Shorter than the workforce module's presence poll because stock is
 * contended: two tills selling the same last item is a real scenario, and the
 * cost of a stale number is a customer promised goods that are gone.
 */
const STOCK_POLL_MS = 45_000;

/** Historical data is immutable once written. */
const HISTORY_STALE_MS = 120_000;

/** Analytics are expensive and change slowly. */
const ANALYTICS_STALE_MS = 300_000;

// =============================================================================
// DASHBOARD & STOCK
// =============================================================================

export function useInventoryDashboard(params: DashboardParams) {
  return useQuery({
    queryKey: inventoryKeys.dashboard(params),
    queryFn: () => api.fetchDashboard(params),
    refetchInterval: STOCK_POLL_MS,
    staleTime: 30_000,
  });
}

export function useStock(params: StockParams) {
  return useQuery({
    queryKey: inventoryKeys.stock(params),
    queryFn: () => api.fetchStock(params),
    placeholderData: (prev) => prev,
    refetchInterval: STOCK_POLL_MS,
  });
}

/** Detail — enabled-gated so it only runs when a drawer is actually open. */
export function useInventoryDetail(variantId: string | undefined) {
  return useQuery({
    queryKey: inventoryKeys.detail(variantId ?? ""),
    queryFn: () => api.fetchInventoryDetail(variantId as string),
    enabled: Boolean(variantId),
    refetchInterval: STOCK_POLL_MS,
  });
}

/**
 * Barcode lookup.
 *
 * `enabled` on a non-empty code, so the hook stays inert until something is
 * actually scanned rather than firing a request for the empty string.
 */
export function useScan(code: string, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.scan(code),
    queryFn: () => api.scanCode(code),
    enabled: enabled && code.trim().length > 0,
    // A scan is a point-in-time lookup; retrying a genuine "not found" just
    // delays the error the user needs to see.
    retry: false,
    staleTime: 15_000,
  });
}

// =============================================================================
// DRAWER TABS — lazy by construction
// =============================================================================

export function useVariantPurchases(variantId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: inventoryKeys.detailPurchases(variantId ?? ""),
    queryFn: () => api.fetchVariantPurchases(variantId as string),
    enabled: Boolean(variantId) && enabled,
    staleTime: HISTORY_STALE_MS,
  });
}

export function useVariantSales(variantId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: inventoryKeys.detailSales(variantId ?? ""),
    queryFn: () => api.fetchVariantSales(variantId as string),
    enabled: Boolean(variantId) && enabled,
    staleTime: HISTORY_STALE_MS,
  });
}

// =============================================================================
// LEDGER & WORKFLOWS
// =============================================================================

export function useMovements(params: MovementParams, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.movements(params),
    queryFn: () => api.fetchMovements(params),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: HISTORY_STALE_MS,
  });
}

export function useReservations(params: ReservationParams, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.reservations(params),
    queryFn: () => api.fetchReservations(params),
    enabled,
    placeholderData: (prev) => prev,
    // Reservations expire on a timer, so a stale list would show holds that
    // have already lapsed and stopped consuming stock.
    refetchInterval: STOCK_POLL_MS,
  });
}

export function useAdjustments(params: AdjustmentParams, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.adjustments(params),
    queryFn: () => api.fetchAdjustments(params),
    enabled,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

export function useDamaged(params: DamagedParams, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.damaged(params),
    queryFn: () => api.fetchDamaged(params),
    enabled,
    placeholderData: (prev) => prev,
    staleTime: HISTORY_STALE_MS,
  });
}

export function useCycleCounts(params: CycleCountParams) {
  return useQuery({
    queryKey: inventoryKeys.cycleCounts(params),
    queryFn: () => api.fetchCycleCounts(params),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

/**
 * One count session.
 *
 * Polled while IN_PROGRESS: counting is often two people on the floor with two
 * devices, and each needs to see the other's lines appear.
 */
export function useCycleCount(id: string | undefined) {
  return useQuery({
    queryKey: inventoryKeys.cycleCount(id ?? ""),
    queryFn: () => api.fetchCycleCount(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      query.state.data?.status === "IN_PROGRESS" ? 20_000 : false,
  });
}

// =============================================================================
// ANALYTICS
// =============================================================================

export function useValuation(params: ValuationParams, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.valuation(params),
    queryFn: () => api.fetchValuation(params),
    enabled,
    placeholderData: (prev) => prev,
    staleTime: ANALYTICS_STALE_MS,
  });
}

export function useReorder(params: ReorderParams, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.reorder(params),
    queryFn: () => api.fetchReorder(params),
    enabled,
    placeholderData: (prev) => prev,
    staleTime: ANALYTICS_STALE_MS,
  });
}

export function useVelocity(params: VelocityParams, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.velocity(params),
    queryFn: () => api.fetchVelocity(params),
    enabled,
    placeholderData: (prev) => prev,
    staleTime: ANALYTICS_STALE_MS,
  });
}

export function useLowStock(params: StockParams, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.lowStock(params),
    queryFn: () => api.fetchLowStock(params),
    enabled,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });
}

export function useOutOfStock(params: StockParams, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.outOfStock(params),
    queryFn: () => api.fetchOutOfStock(params),
    enabled,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });
}

export function useAging(enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.aging(),
    queryFn: () => api.fetchAging(),
    enabled,
    staleTime: ANALYTICS_STALE_MS,
  });
}

// =============================================================================
// MUTATIONS
//
// Every stock-changing mutation invalidates the WHOLE inventory subtree rather
// than surgically patching caches. A single adjustment moves the dashboard
// counters, the stock row, the ledger, the low-stock list and the valuation at
// once — one broad invalidation is both simpler and far less likely to leave a
// stale figure than five narrow ones.
// =============================================================================

export function useCreateReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateReservationPayload) => api.createReservation(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useReleaseReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.releaseReservation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useCreateAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateAdjustmentPayload) => api.createAdjustment(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useReviewAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ReviewAdjustmentPayload }) =>
      api.reviewAdjustment(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useReportDamage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ReportDamagePayload) => api.reportDamage(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useStartCycleCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: StartCycleCountPayload) => api.startCycleCount(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

/**
 * Records a counted line.
 *
 * Invalidates only THIS session rather than the whole subtree: counting is a
 * rapid loop of scans, and refetching the dashboard after every barcode would
 * make the scanner feel sluggish. Nothing else on screen changes until the
 * count is posted.
 */
export function useRecordCount(cycleCountId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { variantId: string; countedQuantity: number; notes?: string }) =>
      api.recordCount(cycleCountId as string, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.cycleCount(cycleCountId ?? "") });
    },
  });
}

export function useRecordCountByCode(cycleCountId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { code: string; countedQuantity: number; notes?: string }) =>
      api.recordCountByCode(cycleCountId as string, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.cycleCount(cycleCountId ?? "") });
    },
  });
}

export function useCompleteCycleCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: { postAdjustments: boolean; notes?: string };
    }) => api.completeCycleCount(id, payload),
    onSuccess: () => {
      // Posting a count moves stock across many variants at once — the broad
      // invalidation is essential here, not merely convenient.
      qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}
