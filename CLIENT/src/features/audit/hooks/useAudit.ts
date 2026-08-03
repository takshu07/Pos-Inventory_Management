/**
 * Audit Logs — React Query hooks.
 *
 * Read-only, and there are no mutations to invalidate: nothing in the app
 * writes the audit trail through the API. That also means nothing here needs
 * to bust another feature's cache, which is why this file is so much smaller
 * than the other feature hook modules.
 *
 * Caching: audit entries are IMMUTABLE once written. A row never changes, so a
 * fetched page and a fetched detail stay correct forever — only the newest
 * entries are missing from a stale list. That justifies a long staleTime on
 * detail (it can never go stale in a way that matters) and a short one on the
 * list. Nothing polls: an audit trail is a record, not a live monitor, and
 * background-refetching the largest table in the system on an interval is a
 * cost with no reader benefit.
 */

import { useQuery } from "@tanstack/react-query";

import * as api from "../api/auditApi";
import type { AuditListParams } from "../types";

// =============================================================================
// QUERY KEYS
// A single factory so an invalidation can never miss a key by mistyping it.
// =============================================================================

export const auditKeys = {
  all: ["audit-logs"] as const,
  lists: () => [...auditKeys.all, "list"] as const,
  list: (p: AuditListParams) => [...auditKeys.lists(), p] as const,
  detail: (id: string) => [...auditKeys.all, "detail", id] as const,
  related: (id: string) => [...auditKeys.all, "related", id] as const,
  filters: () => [...auditKeys.all, "filters"] as const,
  summary: (p: AuditListParams) => [...auditKeys.all, "summary", p] as const,
};

/** A list can only be missing NEW rows; 30s is plenty. */
const LIST_STALE_MS = 30_000;

/** Entries are immutable, so a fetched one is correct indefinitely. */
const DETAIL_STALE_MS = 5 * 60_000;

/** Filter options change only when a new module starts auditing. */
const OPTIONS_STALE_MS = 10 * 60_000;

export function useAuditLogs(params: AuditListParams) {
  return useQuery({
    queryKey: auditKeys.list(params),
    queryFn: () => api.fetchAuditLogs(params),
    // Paging and filtering update the table in place rather than flashing a
    // skeleton over content about to be replaced by similar content.
    placeholderData: (prev) => prev,
    staleTime: LIST_STALE_MS,
  });
}

/** Enabled-gated so it only runs when a drawer is actually open. */
export function useAuditLog(id: string | undefined) {
  return useQuery({
    queryKey: auditKeys.detail(id ?? ""),
    queryFn: () => api.fetchAuditLog(id as string),
    enabled: Boolean(id),
    staleTime: DETAIL_STALE_MS,
  });
}

/**
 * Other entries against the same record.
 *
 * A separate query from the detail rather than part of it, so opening a drawer
 * renders the entry immediately and the history fills in behind it — the panel
 * is supporting context, and it must never delay the thing the reader clicked.
 */
export function useRelatedAuditLogs(id: string | undefined, limit = 5) {
  return useQuery({
    queryKey: [...auditKeys.related(id ?? ""), limit] as const,
    queryFn: () => api.fetchRelatedAuditLogs(id as string, limit),
    enabled: Boolean(id),
    staleTime: DETAIL_STALE_MS,
  });
}

export function useAuditFilterOptions() {
  return useQuery({
    queryKey: auditKeys.filters(),
    queryFn: api.fetchAuditFilterOptions,
    staleTime: OPTIONS_STALE_MS,
  });
}

/**
 * Summary counts under the SAME filters as the list.
 *
 * Takes the list's params minus paging, so the strip always describes the
 * result set the reader is looking at rather than the whole table.
 */
export function useAuditSummary(params: AuditListParams) {
  const { page: _page, limit: _limit, sortBy: _s, sortOrder: _o, ...rest } = params;
  return useQuery({
    queryKey: auditKeys.summary(rest),
    queryFn: () => api.fetchAuditSummary(rest),
    placeholderData: (prev) => prev,
    staleTime: LIST_STALE_MS,
  });
}
