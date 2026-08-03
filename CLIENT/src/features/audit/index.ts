/**
 * Audit Logs — public surface.
 *
 * OWNER-only, read-only. The router imports `AuditLogsPage` lazily so this
 * feature is its own chunk and never loads for a manager or cashier.
 */

export { AuditLogsPage } from "./pages/AuditLogsPage";

export { auditKeys, useAuditLogs, useAuditLog, useAuditSummary } from "./hooks/useAudit";
export { useAuditFilters } from "./hooks/useAuditFilters";

export type {
  AuditLogEntry,
  AuditLogDetail,
  AuditListParams,
  AuditListResult,
  AuditFilterOptions,
  AuditSeverity,
  AuditSummary,
} from "./types";
