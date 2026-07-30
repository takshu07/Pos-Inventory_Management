/**
 * Inventory Management — transport layer.
 *
 * THE ROLE-AWARE BASE PATH
 * ------------------------
 * The backend exposes three inventory trees: `/owner/inventory` (full surface,
 * every mutation and cost figure), `/manager/inventory` (operational, cost
 * stripped) and `/inventory` (the cashier's read-and-scan baseline). Every
 * function resolves its base path from the CURRENT USER'S ROLE, so one set of
 * API functions serves all three portals.
 *
 * This is a convenience, NOT a security control. A manager who tampers with the
 * client and calls an owner path is rejected by that tree's guard, and the
 * service independently strips cost from any shared read. The client choosing
 * the right path simply avoids a guaranteed 403 on every request.
 */

import { apiClient } from "@/lib/api";
import { ENV } from "@/config/env";
import { useAuthStore } from "@/store/auth.store";
import type {
  Adjustment,
  AdjustmentParams,
  AgingReport,
  CreateAdjustmentPayload,
  CreateReservationPayload,
  CycleCount,
  CycleCountDetail,
  CycleCountParams,
  DamagedParams,
  DamagedRow,
  DashboardParams,
  InventoryDashboard,
  InventoryDetail,
  InventoryValuation,
  LowStockRow,
  MovementParams,
  MovementRow,
  Paginated,
  ReorderParams,
  ReorderRow,
  ReportDamagePayload,
  Reservation,
  ReservationParams,
  ReviewAdjustmentPayload,
  StartCycleCountPayload,
  StockParams,
  StockRow,
  ValuationParams,
  VelocityParams,
  VelocityRow,
} from "../types";

/**
 * Resolves the inventory API root for the signed-in role.
 * Read fresh from the store on every call — a role change mid-session must not
 * be served from a stale closure.
 */
function basePath(): string {
  const role = useAuthStore.getState().user?.role;
  if (role === "OWNER") return "/owner/inventory";
  if (role === "MANAGER") return "/manager/inventory";
  return "/inventory";
}

/** Owner-only endpoints pin to this rather than resolving by role. */
const OWNER_BASE = "/owner/inventory";

/**
 * Drops empty params before they reach the query string.
 *
 * Sending `?status=` would make the server parse an empty string as a filter
 * value; dropping the key entirely is what makes "no filter" mean no filter.
 * `false` is preserved deliberately — `isActive=false` is a real filter.
 */
function clean<T extends object>(params: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined)
  );
}

/** Unwraps the shared `{ data, meta }` envelope into the client's flat shape. */
function toPaginated<T>(response: any, fallbackLimit: number): Paginated<T> {
  return {
    data: response?.data ?? [],
    total: response?.meta?.total ?? 0,
    page: response?.meta?.page ?? 1,
    totalPages:
      response?.meta?.totalPages ??
      Math.max(1, Math.ceil((response?.meta?.total ?? 0) / fallbackLimit)),
  };
}

// =============================================================================
// STOCK OVERVIEW
// =============================================================================

export async function fetchStock(params: StockParams): Promise<Paginated<StockRow>> {
  const res = await apiClient.get<any>(`${basePath()}/stock`, { params: clean(params) });
  return toPaginated<StockRow>(res, params.limit ?? 25);
}

/** Barcode/SKU lookup. Available to every role — cashiers scan at the till. */
export async function scanCode(code: string): Promise<StockRow> {
  const res = await apiClient.get<any>(`${basePath()}/scan`, { params: { code } });
  return res.data;
}

export async function fetchInventoryDetail(variantId: string): Promise<InventoryDetail> {
  const res = await apiClient.get<any>(`${basePath()}/stock/${variantId}`);
  return res.data;
}

export async function fetchVariantPurchases(variantId: string): Promise<any[]> {
  const res = await apiClient.get<any>(`${basePath()}/stock/${variantId}/purchases`);
  return res.data ?? [];
}

export async function fetchVariantSales(variantId: string): Promise<any[]> {
  const res = await apiClient.get<any>(`${basePath()}/stock/${variantId}/sales`);
  return res.data ?? [];
}

// =============================================================================
// MOVEMENTS (the ledger)
// =============================================================================

export async function fetchMovements(
  params: MovementParams
): Promise<Paginated<MovementRow>> {
  const res = await apiClient.get<any>(`${basePath()}/movements`, { params: clean(params) });
  return toPaginated<MovementRow>(res, params.limit ?? 25);
}

// =============================================================================
// DASHBOARD & ANALYTICS
// =============================================================================

export async function fetchDashboard(
  params: DashboardParams
): Promise<InventoryDashboard> {
  const res = await apiClient.get<any>(`${basePath()}/dashboard`, { params: clean(params) });
  return res.data;
}

/** OWNER-only — the endpoint does not exist on the other trees. */
export async function fetchValuation(
  params: ValuationParams
): Promise<InventoryValuation> {
  const res = await apiClient.get<any>(`${OWNER_BASE}/valuation`, { params: clean(params) });
  return res.data;
}

export async function fetchReorder(params: ReorderParams): Promise<Paginated<ReorderRow>> {
  const res = await apiClient.get<any>(`${basePath()}/reorder`, { params: clean(params) });
  return toPaginated<ReorderRow>(res, params.limit ?? 25);
}

export async function fetchVelocity(
  params: VelocityParams
): Promise<Paginated<VelocityRow>> {
  const res = await apiClient.get<any>(`${basePath()}/velocity`, { params: clean(params) });
  return toPaginated<VelocityRow>(res, params.limit ?? 25);
}

export async function fetchLowStock(params: StockParams): Promise<Paginated<LowStockRow>> {
  const res = await apiClient.get<any>(`${basePath()}/low-stock`, { params: clean(params) });
  return toPaginated<LowStockRow>(res, params.limit ?? 25);
}

export async function fetchOutOfStock(params: StockParams): Promise<Paginated<LowStockRow>> {
  const res = await apiClient.get<any>(`${basePath()}/out-of-stock`, {
    params: clean(params),
  });
  return toPaginated<LowStockRow>(res, params.limit ?? 25);
}

export async function fetchAging(): Promise<AgingReport> {
  const res = await apiClient.get<any>(`${basePath()}/aging`);
  return res.data;
}

// =============================================================================
// RESERVATIONS
// =============================================================================

export async function fetchReservations(
  params: ReservationParams
): Promise<Paginated<Reservation>> {
  const res = await apiClient.get<any>(`${basePath()}/reservations`, {
    params: clean(params),
  });
  return toPaginated<Reservation>(res, params.limit ?? 25);
}

export async function createReservation(
  payload: CreateReservationPayload
): Promise<Reservation> {
  const res = await apiClient.post<any>(`${basePath()}/reservations`, clean(payload));
  return res.data;
}

export async function releaseReservation(id: string): Promise<Reservation> {
  const res = await apiClient.post<any>(`${basePath()}/reservations/${id}/release`);
  return res.data;
}

// =============================================================================
// ADJUSTMENTS
// =============================================================================

export async function fetchAdjustments(
  params: AdjustmentParams
): Promise<Paginated<Adjustment>> {
  const res = await apiClient.get<any>(`${basePath()}/adjustments`, {
    params: clean(params),
  });
  return toPaginated<Adjustment>(res, params.limit ?? 25);
}

/**
 * Requests an adjustment.
 *
 * A manager's request comes back PENDING; an owner's comes back APPROVED with
 * stock already moved. The caller reads `status` off the response rather than
 * inferring which happened from the current role.
 */
export async function createAdjustment(
  payload: CreateAdjustmentPayload
): Promise<Adjustment> {
  const res = await apiClient.post<any>(`${basePath()}/adjustments`, clean(payload));
  return res.data;
}

/** OWNER-only. The route is absent from the manager tree entirely. */
export async function reviewAdjustment(
  id: string,
  payload: ReviewAdjustmentPayload
): Promise<Adjustment> {
  const res = await apiClient.patch<any>(
    `${OWNER_BASE}/adjustments/${id}/review`,
    clean(payload)
  );
  return res.data;
}

// =============================================================================
// DAMAGED STOCK
// =============================================================================

export async function fetchDamaged(
  params: DamagedParams
): Promise<Paginated<DamagedRow>> {
  const res = await apiClient.get<any>(`${basePath()}/damaged`, { params: clean(params) });
  return toPaginated<DamagedRow>(res, params.limit ?? 25);
}

/** OWNER-only — writing off stock changes it. */
export async function reportDamage(payload: ReportDamagePayload): Promise<DamagedRow> {
  const res = await apiClient.post<any>(`${OWNER_BASE}/damaged`, payload);
  return res.data;
}

// =============================================================================
// CYCLE COUNTS
// =============================================================================

export async function fetchCycleCounts(
  params: CycleCountParams
): Promise<Paginated<CycleCount>> {
  const res = await apiClient.get<any>(`${basePath()}/cycle-counts`, {
    params: clean(params),
  });
  return toPaginated<CycleCount>(res, params.limit ?? 25);
}

export async function fetchCycleCount(id: string): Promise<CycleCountDetail> {
  const res = await apiClient.get<any>(`${basePath()}/cycle-counts/${id}`);
  return res.data;
}

export async function startCycleCount(
  payload: StartCycleCountPayload
): Promise<CycleCount> {
  const res = await apiClient.post<any>(`${basePath()}/cycle-counts`, clean(payload));
  return res.data;
}

export async function recordCount(
  cycleCountId: string,
  payload: { variantId: string; countedQuantity: number; notes?: string }
): Promise<any> {
  const res = await apiClient.post<any>(
    `${basePath()}/cycle-counts/${cycleCountId}/count`,
    clean(payload)
  );
  return res.data;
}

/** Scanner entry point — takes a code rather than an id. */
export async function recordCountByCode(
  cycleCountId: string,
  payload: { code: string; countedQuantity: number; notes?: string }
): Promise<any> {
  const res = await apiClient.post<any>(
    `${basePath()}/cycle-counts/${cycleCountId}/scan`,
    clean(payload)
  );
  return res.data;
}

/**
 * Closes a count.
 *
 * `postAdjustments` is OWNER-only at the server: a manager may complete a dry
 * run, but turning variances into stock movements is an owner's decision.
 */
export async function completeCycleCount(
  id: string,
  payload: { postAdjustments: boolean; notes?: string }
): Promise<CycleCount> {
  const res = await apiClient.post<any>(
    `${basePath()}/cycle-counts/${id}/complete`,
    clean(payload)
  );
  return res.data;
}

// =============================================================================
// EXPORTS
// =============================================================================

export type InventoryReport =
  | "stock"
  | "valuation"
  | "movements"
  | "adjustments"
  | "low-stock"
  | "out-of-stock"
  | "dead-stock"
  | "fast-moving"
  | "slow-moving"
  | "aging";

export type ExportFormat = "csv" | "excel" | "pdf";

/**
 * Downloads a report.
 *
 * Deliberately bypasses `apiClient`: that instance's response interceptor
 * unwraps `{ success, data }` JSON, which would mangle a CSV body. Building the
 * URL and letting the browser fetch it keeps the transport honest — and means
 * the server's Content-Disposition drives the filename rather than the client
 * guessing one.
 *
 * PDF is served as printable HTML (the server does not lie about the content
 * type), so it opens in a print window instead of downloading.
 */
export async function downloadReport(
  report: InventoryReport,
  format: ExportFormat,
  filters: Record<string, unknown> = {}
): Promise<void> {
  const params = new URLSearchParams({ format });
  for (const [key, value] of Object.entries(clean(filters))) {
    params.set(key, String(value));
  }

  const token = useAuthStore.getState().accessToken;

  const response = await fetch(
    `${ENV.VITE_API_URL}${basePath()}/export/${report}?${params}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );

  if (!response.ok) throw new Error(`Export failed (${response.status})`);

  const blob = await response.blob();

  // The server owns the filename; fall back only if the header is absent.
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? `${report}.${format === "excel" ? "xls" : format}`;

  const url = URL.createObjectURL(blob);

  if (format === "pdf") {
    // Printable HTML: open it so the browser's own print-to-PDF renders it.
    window.open(url, "_blank");
    // Revoke late — revoking immediately can race the new window's load.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
