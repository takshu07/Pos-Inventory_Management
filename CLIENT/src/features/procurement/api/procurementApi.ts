/**
 * Procurement — transport layer.
 *
 * Every endpoint here is OWNER-only at the router level on the server, matching
 * the "Manager is operational, Owner is business administration" split. There is
 * no role-resolved base path (unlike inventory) because there is no manager
 * variant of these trees to resolve to.
 *
 * Supplier payments live under /finance rather than /purchases: recording a
 * payment posts to the cash drawer and the payables ledger, so it is a finance
 * operation performed FROM a procurement screen, not a procurement operation.
 * Calling the finance endpoint keeps that single source of truth intact instead
 * of duplicating settlement logic behind a procurement URL.
 */

import { apiClient } from "@/lib/api";
import type {
  Brand,
  BrandListParams,
  BrandWriteInput,
  CreatePurchaseInput,
  Paginated,
  ProductSearchRow,
  PurchaseDetail,
  PurchaseListParams,
  PurchaseRow,
  RecordPaymentInput,
  VariantOption,
  ReceivePurchaseInput,
  Supplier,
  SupplierDetail,
  SupplierListParams,
  SupplierPaymentRow,
  SupplierWriteInput,
  UpdatePurchaseInput,
} from "../types";

/**
 * Drops empty params before they reach the query string.
 *
 * `?status=` would be parsed server-side as a filter on the empty string;
 * omitting the key is what makes "no filter" mean no filter. `false` and `0`
 * are preserved — both are legitimate filter values.
 */
function clean<T extends object>(params: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined)
  );
}

/**
 * Unwraps a paginated list response into the client's flat shape.
 *
 * NOTE THE DOUBLE NESTING. The axios interceptor already returns `response.data`
 * (the `{ success, message, data }` envelope), and these controllers put the
 * service's own `{ data, meta }` object inside THAT `data`. So a brands list
 * arrives as `{ success, message, data: { data: [...], meta: {...} } }` and the
 * rows live at `res.data.data`.
 *
 * This differs from the inventory endpoints, which return the rows one level
 * higher — hence a local helper rather than a shared one. Reading the wrong
 * level does not throw; it silently yields an empty list, which is why this is
 * covered by the live contract test rather than trusted to typecheck.
 */
function toPaginated<T>(response: any, fallbackLimit: number): Paginated<T> {
  const body = response?.data ?? {};
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  const meta = body?.meta ?? response?.meta ?? {};
  const total = meta.total ?? rows.length;

  return {
    data: rows as T[],
    total,
    page: meta.page ?? 1,
    totalPages: meta.totalPages ?? Math.max(1, Math.ceil(total / Math.max(1, fallbackLimit))),
  };
}

// =============================================================================
// BRANDS
// =============================================================================

export async function fetchBrands(params: BrandListParams): Promise<Paginated<Brand>> {
  const res = await apiClient.get<any>("/brands", { params: clean(params) });
  return toPaginated<Brand>(res, params.limit ?? 20);
}

export async function fetchBrand(id: string): Promise<Brand> {
  const res = await apiClient.get<any>(`/brands/${id}`);
  return res.data;
}

export async function createBrand(input: BrandWriteInput): Promise<Brand> {
  const res = await apiClient.post<any>("/brands", clean(input));
  return res.data;
}

export async function updateBrand(id: string, input: Partial<BrandWriteInput>): Promise<Brand> {
  // isActive must survive `clean` when explicitly false — that is the
  // deactivate action, not an absent field.
  const body = clean(input);
  if (input.isActive !== undefined) body["isActive"] = input.isActive;
  const res = await apiClient.patch<any>(`/brands/${id}`, body);
  return res.data;
}

export async function deleteBrand(id: string): Promise<{ id: string }> {
  const res = await apiClient.delete<any>(`/brands/${id}`);
  return res.data;
}

// =============================================================================
// SUPPLIERS
// =============================================================================

export async function fetchSuppliers(
  params: SupplierListParams
): Promise<Paginated<Supplier>> {
  const res = await apiClient.get<any>("/suppliers", { params: clean(params) });
  return toPaginated<Supplier>(res, params.limit ?? 20);
}

export async function fetchSupplier(id: string): Promise<SupplierDetail> {
  const res = await apiClient.get<any>(`/suppliers/${id}`);
  return res.data;
}

export async function createSupplier(input: SupplierWriteInput): Promise<Supplier> {
  const res = await apiClient.post<any>("/suppliers", clean(input));
  return res.data;
}

export async function updateSupplier(
  id: string,
  input: Partial<SupplierWriteInput>
): Promise<Supplier> {
  const body = clean(input);
  if (input.isActive !== undefined) body["isActive"] = input.isActive;
  const res = await apiClient.patch<any>(`/suppliers/${id}`, body);
  return res.data;
}

export async function deleteSupplier(id: string): Promise<{ id: string }> {
  const res = await apiClient.delete<any>(`/suppliers/${id}`);
  return res.data;
}

// =============================================================================
// PURCHASES
// =============================================================================

export async function fetchPurchases(
  params: PurchaseListParams
): Promise<Paginated<PurchaseRow>> {
  const res = await apiClient.get<any>("/purchases", { params: clean(params) });
  return toPaginated<PurchaseRow>(res, params.limit ?? 20);
}

export async function fetchPurchase(id: string): Promise<PurchaseDetail> {
  const res = await apiClient.get<any>(`/purchases/${id}`);
  return res.data;
}

export async function createPurchase(input: CreatePurchaseInput): Promise<PurchaseDetail> {
  const res = await apiClient.post<any>("/purchases", clean(input));
  return res.data;
}

export async function updatePurchase(
  id: string,
  input: UpdatePurchaseInput
): Promise<PurchaseDetail> {
  // `dueDate: null` clears an agreed payment term and must reach the server.
  const body = clean(input);
  if (input.dueDate === null) body["dueDate"] = null;
  const res = await apiClient.patch<any>(`/purchases/${id}`, body);
  return res.data;
}

/**
 * Books a goods receipt. Omitting `items` receives everything outstanding;
 * supplying it books the named quantities and leaves the rest open.
 */
export async function receivePurchase(
  id: string,
  input: ReceivePurchaseInput
): Promise<PurchaseDetail> {
  const body: Record<string, unknown> = clean({
    notes: input.notes,
    supplierInvoiceNumber: input.supplierInvoiceNumber,
  });
  if (input.items) body["items"] = input.items;

  const res = await apiClient.post<any>(`/purchases/${id}/receive`, body);
  return res.data;
}

export async function cancelPurchase(id: string, reason: string): Promise<PurchaseDetail> {
  const res = await apiClient.post<any>(`/purchases/${id}/cancel`, { reason });
  return res.data;
}

// =============================================================================
// SETTLEMENT (finance endpoints, used from procurement screens)
// =============================================================================

export async function recordSupplierPayment(
  input: RecordPaymentInput
): Promise<SupplierPaymentRow> {
  const res = await apiClient.post<any>("/finance/supplier-payments", clean(input));
  return res.data;
}

/** Unsettled bills for a supplier — drives the "pay against" picker. */
export async function fetchOpenBills(supplierId: string): Promise<any[]> {
  const res = await apiClient.get<any>(`/finance/suppliers/${supplierId}/open-bills`);
  return res.data ?? [];
}

// =============================================================================
// LOOKUPS
// =============================================================================

/**
 * Product search for the purchase builder.
 *
 * Reuses the owner catalogue rather than adding a procurement-specific search.
 * Note this returns PRODUCTS with variant rollups — the list projection has no
 * variant ids, and a purchase line must name an exact variant. The builder
 * therefore searches here and then expands the chosen product via
 * `fetchProductVariants` below. Two calls, but neither is a new endpoint and
 * the second only fires on an explicit pick.
 */
export async function searchProducts(search: string): Promise<ProductSearchRow[]> {
  const res = await apiClient.get<any>("/owner/products", {
    params: clean({ search, limit: 20, page: 1 }),
  });
  // Paginated envelope — rows are one level deeper than on detail endpoints.
  return res?.data?.data ?? [];
}

/** Expands a product into its purchasable variants. */
export async function fetchProductVariants(productId: string): Promise<VariantOption[]> {
  const res = await apiClient.get<any>(`/owner/products/${productId}`);
  const product = res.data;

  return (product?.variants ?? []).map((v: any) => ({
    variantId: v.id,
    sku: v.sku,
    barcode: v.barcode ?? null,
    productName: product.name,
    sizeName: v.size?.name ?? null,
    colorName: v.color?.name ?? null,
    currentStock: v.currentStock ?? 0,
    costPrice: Number(v.costPrice ?? 0),
    sellingPrice: Number(v.sellingPrice ?? 0),
    isActive: v.isActive !== false,
  }));
}

/**
 * Active suppliers for the create-purchase picker.
 *
 * ⚠ Uses `/suppliers/options`, the unpaginated picker projection — NOT the
 * paginated list. The previous version asked the list for `limit=200`, which
 * exceeds the shared pagination cap of 100, so the request failed validation
 * with a 400 and the dropdown rendered empty. Even at a legal limit the list
 * would silently truncate past its page size.
 */
export async function fetchSupplierOptions(): Promise<{ id: string; businessName: string }[]> {
  const res = await apiClient.get<any>("/suppliers/options");
  const rows: Supplier[] = res?.data ?? [];
  return rows.map((s) => ({ id: s.id, businessName: s.businessName }));
}
