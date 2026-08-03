/**
 * Audit Logs — types.
 *
 * These mirror the server's response shapes (services/audit.service.ts). Two
 * fields carry meaning that is easy to get wrong if you only read the name:
 *
 *   • `severity` is DERIVED from the action by the server, not stored on the
 *     row. The client must never compute its own — a badge that disagrees with
 *     the filter that produced it is worse than no badge.
 *
 *   • `context` is CORRELATED from the actor's login session, not recorded on
 *     the entry. `source: "SESSION"` is what the UI uses to label it honestly.
 *     It is null when no session covering the timestamp was found.
 */

export const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type AuditSeverity = (typeof SEVERITIES)[number];

export interface AuditActor {
  id: string;
  name: string;
  role: string;
  email: string | null;
}

export interface AuditEntity {
  table: string;
  label: string;
  recordId: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actionLabel: string;
  module: string;
  moduleLabel: string;
  severity: AuditSeverity;
  entity: AuditEntity;
  actor: AuditActor;
  createdAt: string;
}

export interface AuditFieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changeType: "added" | "removed" | "changed";
}

/** Network context inferred from the login session — never stored on the entry. */
export interface AuditContext {
  source: "SESSION";
  ipAddress: string | null;
  device: string | null;
  browser: string | null;
  operatingSystem: string | null;
  sessionStartedAt: string | null;
}

export interface AuditLogDetail extends AuditLogEntry {
  oldData: unknown;
  newData: unknown;
  changes: AuditFieldChange[];
  actor: AuditActor & { employeeCode: string | null; phone: string | null };
  context: AuditContext | null;
}

export type AuditPeriod =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "all"
  | "custom";

export type AuditSortBy = "createdAt" | "severity";
export type SortOrder = "asc" | "desc";

export interface AuditListParams {
  page?: number;
  limit?: number;
  search?: string;
  module?: string[];
  action?: string[];
  severity?: string[];
  employeeId?: string;
  tableName?: string;
  recordId?: string;
  period?: AuditPeriod;
  from?: string;
  to?: string;
  sortBy?: AuditSortBy;
  sortOrder?: SortOrder;
}

/**
 * `totalIsExact` is false when the server stopped counting at its cap. The UI
 * renders "10,000+" in that case rather than a precise number it cannot stand
 * behind, and pagination trusts `hasNextPage` over `totalPages`.
 */
export interface AuditListMeta {
  total: number;
  totalIsExact: boolean;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface AuditListResult {
  data: AuditLogEntry[];
  meta: AuditListMeta;
}

export interface AuditFilterOptions {
  modules: Array<{ value: string; label: string }>;
  actions: Array<{ value: string; label: string; severity: AuditSeverity }>;
  severities: Array<{ value: AuditSeverity; label: string }>;
  entities: Array<{ value: string; label: string }>;
  actors: Array<{ value: string; label: string; role: string; count: number }>;
}

export interface AuditSummary {
  total: number;
  totalIsExact: boolean;
  bySeverity: Array<{ severity: AuditSeverity; count: number }>;
  byModule: Array<{ module: string; label: string; count: number }>;
  topActions: Array<{ action: string; label: string; count: number }>;
}
