/**
 * Audit Logs — transport layer.
 *
 * Every endpoint is under `/owner/audit-logs` and is OWNER-only server-side.
 * There are no write functions here, and there must never be: the trail is
 * written by the module that performed the action, and an audit log the client
 * can edit proves nothing.
 *
 * ⚠ ENVELOPE SHAPE. The axios response interceptor already returns
 * `response.data`, so what arrives here is the server's
 * `{ success, data, meta }` envelope — rows at `res.data`, pagination at
 * `res.meta`. Reading the wrong level does not throw; it silently yields an
 * empty list, which is the failure mode that makes this worth stating. This
 * module's controllers use the FLAT shape (unlike the procurement tree, whose
 * controllers nest a second `{data, meta}` inside).
 */

import { apiClient } from "@/lib/api";
import type {
  AuditFilterOptions,
  AuditListParams,
  AuditListResult,
  AuditLogDetail,
  AuditLogEntry,
  AuditSummary,
} from "../types";

const BASE = "/owner/audit-logs";

/**
 * Serialises params for the query string.
 *
 * Arrays are joined with commas rather than repeated, because the server
 * accepts both and a comma list keeps the URL (and the React Query key)
 * readable and stable. Empty values are dropped entirely — sending
 * `?module=` would fail the server's enum rather than read as "no filter".
 */
function toQuery(params: AuditListParams): Record<string, string | number> {
  const out: Record<string, string | number> = {};

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;

    if (Array.isArray(value)) {
      if (value.length > 0) out[key] = value.join(",");
      continue;
    }
    out[key] = value as string | number;
  }

  return out;
}

export async function fetchAuditLogs(
  params: AuditListParams
): Promise<AuditListResult> {
  const res = await apiClient.get<any>(BASE, { params: toQuery(params) });

  const limit = params.limit ?? 25;
  const total = res?.meta?.total ?? 0;

  return {
    data: res?.data ?? [],
    meta: {
      total,
      // Absent means exact — only the list endpoint sets this, and only a
      // capped count makes it false.
      totalIsExact: res?.meta?.totalIsExact ?? true,
      page: res?.meta?.page ?? 1,
      limit: res?.meta?.limit ?? limit,
      totalPages: res?.meta?.totalPages ?? Math.max(1, Math.ceil(total / limit)),
      hasNextPage: res?.meta?.hasNextPage ?? false,
      hasPreviousPage: res?.meta?.hasPreviousPage ?? false,
    },
  };
}

export async function fetchAuditLog(id: string): Promise<AuditLogDetail> {
  const res = await apiClient.get<any>(`${BASE}/${id}`);
  return res.data;
}

/** Other entries against the same record — the "history of this thing" panel. */
export async function fetchRelatedAuditLogs(
  id: string,
  limit = 5
): Promise<AuditLogEntry[]> {
  const res = await apiClient.get<any>(`${BASE}/${id}/related`, {
    params: { limit },
  });
  return res.data ?? [];
}

/** Filter-bar options. Entities and actors come from real data, not a constant. */
export async function fetchAuditFilterOptions(): Promise<AuditFilterOptions> {
  const res = await apiClient.get<any>(`${BASE}/filters`);
  return res.data;
}

export async function fetchAuditSummary(
  params: AuditListParams
): Promise<AuditSummary> {
  const res = await apiClient.get<any>(`${BASE}/summary`, {
    params: toQuery(params),
  });
  return res.data;
}
