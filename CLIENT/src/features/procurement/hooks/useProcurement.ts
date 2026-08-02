/**
 * Procurement — React Query hooks.
 *
 * CROSS-MODULE INVALIDATION IS THE POINT OF THIS FILE.
 *
 * A goods receipt is not a procurement-only event: it moves stock (Inventory),
 * changes payables and cash (Finance), and feeds the Dashboard and Reports.
 * A payment does the same minus the stock. If those caches are not invalidated,
 * the user receives 50 shirts and the Inventory screen still shows the old
 * count until it happens to refetch — the classic "the app is lying to me" bug.
 *
 * `invalidateDownstream` below is the single place that knowledge lives, so a
 * new procurement mutation cannot forget half of it. It deliberately
 * invalidates by ROOT KEY rather than by exact params: a receipt can change any
 * page of any filtered stock list, and enumerating them is impossible.
 *
 * Invalidation is not refetching — inactive queries are only marked stale, so
 * this is cheap. Screens the user is actually looking at refetch; the rest
 * refresh when next mounted.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

import * as api from "../api/procurementApi";
import type {
  BrandListParams,
  BrandWriteInput,
  CreatePurchaseInput,
  PurchaseListParams,
  ReceivePurchaseInput,
  RecordPaymentInput,
  SupplierListParams,
  SupplierWriteInput,
  UpdatePurchaseInput,
} from "../types";

// =============================================================================
// QUERY KEYS
// =============================================================================

export const procurementKeys = {
  all: ["procurement"] as const,

  brands: () => [...procurementKeys.all, "brands"] as const,
  brandList: (p: BrandListParams) => [...procurementKeys.brands(), "list", p] as const,
  brand: (id: string) => [...procurementKeys.brands(), "detail", id] as const,

  suppliers: () => [...procurementKeys.all, "suppliers"] as const,
  supplierList: (p: SupplierListParams) =>
    [...procurementKeys.suppliers(), "list", p] as const,
  supplier: (id: string) => [...procurementKeys.suppliers(), "detail", id] as const,
  supplierOptions: () => [...procurementKeys.suppliers(), "options"] as const,
  openBills: (id: string) => [...procurementKeys.suppliers(), "open-bills", id] as const,

  purchases: () => [...procurementKeys.all, "purchases"] as const,
  purchaseList: (p: PurchaseListParams) =>
    [...procurementKeys.purchases(), "list", p] as const,
  purchase: (id: string) => [...procurementKeys.purchases(), "detail", id] as const,

  productSearch: (q: string) => [...procurementKeys.all, "product-search", q] as const,
  productVariants: (id: string) => [...procurementKeys.all, "product-variants", id] as const,
};

/**
 * Root keys owned by OTHER features that procurement writes affect.
 *
 * These are string literals rather than imports from each feature's key factory
 * on purpose: importing `inventoryKeys` here would make procurement depend on
 * the inventory module's internals and create an import cycle through the
 * feature barrels. The roots are stable public contract — each feature's
 * factory declares `all: ["inventory"]`-style constants that have not changed
 * across the modules built so far.
 */
const DOWNSTREAM_ROOTS = [
  ["inventory"], // stock levels, movements, valuation
  ["finance"], // payables, cash flow, P&L
  ["dashboard"], // owner alert tiles and KPI strip
  ["reports"], // purchase/supplier/brand reporting
  ["owner-products"], // cost price and stock on the owner catalogue
  ["manager-products"], // the manager's read-only view of the same rows
  ["categories"], // category cards show product counts and stock value
  ["register"], // a cash payment posts to the open drawer
] as const;

/**
 * Invalidates every cache a procurement write can affect.
 *
 * @param scope which procurement subtrees to refresh in addition to the
 *              downstream modules.
 */
function invalidateDownstream(
  qc: QueryClient,
  scope: { purchases?: boolean; suppliers?: boolean; brands?: boolean } = {}
) {
  if (scope.purchases) qc.invalidateQueries({ queryKey: procurementKeys.purchases() });
  if (scope.suppliers) qc.invalidateQueries({ queryKey: procurementKeys.suppliers() });
  if (scope.brands) qc.invalidateQueries({ queryKey: procurementKeys.brands() });

  for (const root of DOWNSTREAM_ROOTS) {
    qc.invalidateQueries({ queryKey: root as unknown as string[] });
  }
}

/** Lists keep the previous page on screen while the next one loads. */
const LIST_OPTIONS = {
  placeholderData: keepPreviousData,
  staleTime: 30_000,
} as const;

/** Surfaces the server's message rather than a generic failure string. */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

// =============================================================================
// BRANDS
// =============================================================================

export function useBrands(params: BrandListParams) {
  return useQuery({
    queryKey: procurementKeys.brandList(params),
    queryFn: () => api.fetchBrands(params),
    ...LIST_OPTIONS,
  });
}

export function useBrand(id: string | null) {
  return useQuery({
    queryKey: procurementKeys.brand(id ?? ""),
    queryFn: () => api.fetchBrand(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BrandWriteInput) => api.createBrand(input),
    onSuccess: (brand) => {
      toast.success(`Brand "${brand.name}" created.`);
      invalidateDownstream(qc, { brands: true });
    },
    onError: (e) => toast.error(errorMessage(e, "Could not create the brand.")),
  });
}

export function useUpdateBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<BrandWriteInput> }) =>
      api.updateBrand(id, input),
    onSuccess: (brand) => {
      toast.success(`Brand "${brand.name}" updated.`);
      invalidateDownstream(qc, { brands: true });
    },
    onError: (e) => toast.error(errorMessage(e, "Could not update the brand.")),
  });
}

export function useDeleteBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteBrand(id),
    onSuccess: () => {
      toast.success("Brand deleted.");
      invalidateDownstream(qc, { brands: true });
    },
    // Deliberately silent: a 409 here means "this brand still has products",
    // which the dialog renders inline with a Deactivate alternative. A toast
    // would duplicate it.
  });
}

// =============================================================================
// SUPPLIERS
// =============================================================================

export function useSuppliers(params: SupplierListParams) {
  return useQuery({
    queryKey: procurementKeys.supplierList(params),
    queryFn: () => api.fetchSuppliers(params),
    ...LIST_OPTIONS,
  });
}

export function useSupplier(id: string | null) {
  return useQuery({
    queryKey: procurementKeys.supplier(id ?? ""),
    queryFn: () => api.fetchSupplier(id as string),
    enabled: Boolean(id),
  });
}

export function useSupplierOptions() {
  return useQuery({
    queryKey: procurementKeys.supplierOptions(),
    queryFn: api.fetchSupplierOptions,
    // Pickers tolerate slightly stale data; the supplier list is small and
    // changes rarely.
    staleTime: 5 * 60_000,
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SupplierWriteInput) => api.createSupplier(input),
    onSuccess: (supplier) => {
      toast.success(`Supplier "${supplier.businessName}" created.`);
      invalidateDownstream(qc, { suppliers: true });
    },
    onError: (e) => toast.error(errorMessage(e, "Could not create the supplier.")),
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<SupplierWriteInput> }) =>
      api.updateSupplier(id, input),
    onSuccess: (supplier) => {
      toast.success(`Supplier "${supplier.businessName}" updated.`);
      invalidateDownstream(qc, { suppliers: true });
    },
    onError: (e) => toast.error(errorMessage(e, "Could not update the supplier.")),
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSupplier(id),
    onSuccess: () => {
      toast.success("Supplier deleted.");
      invalidateDownstream(qc, { suppliers: true });
    },
    // See useDeleteBrand — the 409 is rendered inline by the dialog.
  });
}

// =============================================================================
// PURCHASES
// =============================================================================

export function usePurchases(params: PurchaseListParams) {
  return useQuery({
    queryKey: procurementKeys.purchaseList(params),
    queryFn: () => api.fetchPurchases(params),
    ...LIST_OPTIONS,
  });
}

export function usePurchase(id: string | null) {
  return useQuery({
    queryKey: procurementKeys.purchase(id ?? ""),
    queryFn: () => api.fetchPurchase(id as string),
    enabled: Boolean(id),
  });
}

export function useCreatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePurchaseInput) => api.createPurchase(input),
    onSuccess: (purchase) => {
      toast.success(`Purchase ${purchase.purchaseNumber} created.`);
      // Creating a bill adds to payables and the supplier's balance even before
      // any goods arrive, so suppliers and finance refresh too.
      invalidateDownstream(qc, { purchases: true, suppliers: true });
    },
    onError: (e) => toast.error(errorMessage(e, "Could not create the purchase.")),
  });
}

export function useUpdatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePurchaseInput }) =>
      api.updatePurchase(id, input),
    onSuccess: (purchase) => {
      toast.success(`Purchase ${purchase.purchaseNumber} updated.`);
      invalidateDownstream(qc, { purchases: true, suppliers: true });
    },
    onError: (e) => toast.error(errorMessage(e, "Could not update the purchase.")),
  });
}

/**
 * Books a goods receipt.
 *
 * This is the widest-reaching write in the module: it moves physical stock, so
 * every inventory surface plus the dashboard and reports must be considered
 * stale afterwards.
 */
export function useReceivePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReceivePurchaseInput }) =>
      api.receivePurchase(id, input),
    onSuccess: (purchase) => {
      const done = purchase.status === "RECEIVED";
      toast.success(
        done
          ? `${purchase.purchaseNumber} fully received. Stock updated.`
          : `Partial receipt recorded for ${purchase.purchaseNumber}. Stock updated.`
      );
      invalidateDownstream(qc, { purchases: true, suppliers: true });
    },
    onError: (e) => toast.error(errorMessage(e, "Could not record the receipt.")),
  });
}

export function useCancelPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.cancelPurchase(id, reason),
    onSuccess: (purchase) => {
      toast.success(`Purchase ${purchase.purchaseNumber} cancelled.`);
      invalidateDownstream(qc, { purchases: true, suppliers: true });
    },
    onError: (e) => toast.error(errorMessage(e, "Could not cancel the purchase.")),
  });
}

// =============================================================================
// SETTLEMENT
// =============================================================================

export function useOpenBills(supplierId: string | null) {
  return useQuery({
    queryKey: procurementKeys.openBills(supplierId ?? ""),
    queryFn: () => api.fetchOpenBills(supplierId as string),
    enabled: Boolean(supplierId),
  });
}

/**
 * Records a supplier payment.
 *
 * A cash payment also posts to the open register drawer, which is why finance
 * and the dashboard are invalidated alongside procurement's own caches.
 */
export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordPaymentInput) => api.recordSupplierPayment(input),
    onSuccess: (payment) => {
      toast.success(`Payment ${payment.paymentNumber} recorded.`);
      invalidateDownstream(qc, { purchases: true, suppliers: true });
    },
    onError: (e) => toast.error(errorMessage(e, "Could not record the payment.")),
  });
}

// =============================================================================
// PICKERS
// =============================================================================

export function useProductSearch(query: string) {
  return useQuery({
    queryKey: procurementKeys.productSearch(query),
    queryFn: () => api.searchProducts(query),
    // A blank query would fetch the whole catalogue on every builder open.
    enabled: query.trim().length >= 2,
    staleTime: 60_000,
  });
}

export function useProductVariants(productId: string | null) {
  return useQuery({
    queryKey: procurementKeys.productVariants(productId ?? ""),
    queryFn: () => api.fetchProductVariants(productId as string),
    enabled: Boolean(productId),
    staleTime: 60_000,
  });
}
