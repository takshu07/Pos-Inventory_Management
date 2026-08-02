/**
 * Cash Register — transport layer.
 *
 * ONE BASE PATH FOR EVERY ROLE.
 *
 * Unlike the workforce and inventory modules, the register has a single API
 * tree. That is deliberate: which SESSIONS an actor may see or touch is a
 * per-row question (is this my drawer?), not a per-path one, so the server
 * scopes results by the authenticated actor rather than exposing two trees.
 * A cashier calling /register/history gets their own sessions; an owner
 * calling the same path gets everyone's.
 */

import { apiClient } from "@/lib/api";
import type {
  AdjustmentPayload,
  CashDrop,
  CashDropPayload,
  CashPayout,
  CashPayoutPayload,
  ClosePreview,
  CloseRegisterPayload,
  DropListParams,
  LiveDashboard,
  OpenRegisterPayload,
  Paginated,
  PayoutListParams,
  RegisterActivity,
  RegisterHistoryParams,
  RegisterHistorySummary,
  RegisterSession,
  ShiftSummary,
} from "../types";

const BASE = "/register";

/**
 * Drops empty params before they reach the query string.
 * Sending `?status=` would make the server parse an empty string as a filter
 * value; dropping the key entirely is what makes "no filter" mean no filter.
 * `false` is preserved — `hasDiscrepancy=false` is a real filter.
 */
function clean<T extends object>(params: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined)
  );
}

/** Unwraps the shared `{ data, meta }` envelope into the client's flat shape. */
function toPaginated<T>(response: any, fallbackLimit: number): Paginated<T> {
  const total = response?.meta?.total ?? 0;
  return {
    data: response?.data ?? [],
    total,
    page: response?.meta?.page ?? 1,
    totalPages: response?.meta?.totalPages ?? Math.max(1, Math.ceil(total / fallbackLimit)),
  };
}

// =============================================================================
// LIVE DRAWER
// =============================================================================

export async function fetchLiveDashboard(registerId?: string): Promise<LiveDashboard> {
  const res = await apiClient.get<any>(`${BASE}/live`, {
    params: registerId ? { registerId } : {},
  });
  return res.data;
}

export async function fetchRegisterNumbers(): Promise<string[]> {
  const res = await apiClient.get<any>(`${BASE}/registers`);
  return res.data ?? [];
}

// =============================================================================
// SESSION LIFECYCLE
// =============================================================================

export async function openRegister(payload: OpenRegisterPayload): Promise<RegisterSession> {
  const res = await apiClient.post<any>(`${BASE}/open`, payload);
  return res.data;
}

export async function fetchClosePreview(registerId: string): Promise<ClosePreview> {
  const res = await apiClient.get<any>(`${BASE}/${registerId}/close-preview`);
  return res.data;
}

export async function closeRegister(
  registerId: string,
  payload: CloseRegisterPayload
): Promise<{ session: RegisterSession; variance: { difference: number; kind: string; percentage: number } }> {
  const res = await apiClient.post<any>(`${BASE}/${registerId}/close`, payload);
  return res.data;
}

export async function reconcileRegister(
  registerId: string,
  reconcileNotes?: string
): Promise<RegisterSession> {
  const res = await apiClient.post<any>(`${BASE}/${registerId}/reconcile`, {
    ...(reconcileNotes ? { reconcileNotes } : {}),
  });
  return res.data;
}

// =============================================================================
// DRAWER MOVEMENTS
// =============================================================================

export async function createCashDrop(
  registerId: string,
  payload: CashDropPayload
): Promise<CashDrop> {
  const res = await apiClient.post<any>(`${BASE}/${registerId}/drops`, clean(payload));
  return res.data;
}

export async function createCashPayout(
  registerId: string,
  payload: CashPayoutPayload
): Promise<CashPayout> {
  const res = await apiClient.post<any>(`${BASE}/${registerId}/payouts`, clean(payload));
  return res.data;
}

export async function createAdjustment(
  registerId: string,
  payload: AdjustmentPayload
): Promise<LiveDashboard> {
  const res = await apiClient.post<any>(`${BASE}/${registerId}/adjustments`, payload);
  return res.data;
}

export async function addRegisterNote(registerId: string, note: string): Promise<void> {
  await apiClient.post(`${BASE}/${registerId}/notes`, { note });
}

// =============================================================================
// LISTS
// =============================================================================

export async function fetchCashDrops(
  params: DropListParams
): Promise<Paginated<CashDrop> & { summary: { totalAmount: number; count: number } }> {
  // `any` for the reason documented on toPaginated: the response interceptor
  // returns the ENVELOPE, so AxiosResponse no longer describes what arrives —
  // and this endpoint's envelope carries a sibling `summary` alongside `data`.
  const res: any = await apiClient.get<any>(`${BASE}/drops`, { params: clean(params) });
  return {
    ...toPaginated<CashDrop>(res, params.limit ?? 25),
    summary: res?.summary ?? { totalAmount: 0, count: 0 },
  };
}

export async function fetchCashPayouts(
  params: PayoutListParams
): Promise<
  Paginated<CashPayout> & {
    summary: {
      totalAmount: number;
      count: number;
      byCategory: Array<{ category: string; amount: number; count: number }>;
    };
  }
> {
  const res: any = await apiClient.get<any>(`${BASE}/payouts`, { params: clean(params) });
  return {
    ...toPaginated<CashPayout>(res, params.limit ?? 25),
    summary: res?.summary ?? { totalAmount: 0, count: 0, byCategory: [] },
  };
}

export async function fetchRegisterHistory(
  params: RegisterHistoryParams
): Promise<Paginated<RegisterSession> & { summary: RegisterHistorySummary }> {
  const res: any = await apiClient.get<any>(`${BASE}/history`, { params: clean(params) });
  return {
    ...toPaginated<RegisterSession>(res, params.limit ?? 25),
    summary: res?.summary,
  };
}

// =============================================================================
// SESSION DETAIL
// =============================================================================

export async function fetchShiftSummary(registerId: string): Promise<ShiftSummary> {
  const res = await apiClient.get<any>(`${BASE}/${registerId}/summary`);
  return res.data;
}

export async function fetchSessionActivity(
  registerId: string,
  params: { page?: number; limit?: number; type?: string }
): Promise<Paginated<RegisterActivity>> {
  const res = await apiClient.get<any>(`${BASE}/${registerId}/activity`, {
    params: clean(params),
  });
  return toPaginated<RegisterActivity>(res, params.limit ?? 25);
}
