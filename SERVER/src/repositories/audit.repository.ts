// =============================================================================
// AUDIT LOG REPOSITORY
// All database writes to the audit_logs table.
//
// Design decisions:
// - Audit writes are ALWAYS fire-and-forget. An audit failure must NEVER
//   cause a business operation to fail or roll back. We log errors to Pino.
// - oldData/newData are stored as JSON snapshots of the Prisma record shape.
// - Sensitive fields (password, refreshTokenVersion) are stripped before
//   writing to audit_logs to prevent credentials ending up in the audit trail.
// =============================================================================

import type { ActionModule, ActionType } from "../../generated/prisma";
import { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";

// Fields that must never appear in an audit log snapshot
const SENSITIVE_KEYS = new Set(["password", "refreshTokenVersion"]);

function stripSensitive(
  data: Record<string, unknown>
): Prisma.InputJsonValue {
  const cleaned: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!SENSITIVE_KEYS.has(key)) {
      // Prisma InputJsonValue is a recursive type — cast needed for unknown values.
      cleaned[key] = value as Prisma.InputJsonValue;
    }
  }
  return cleaned;
}

export interface CreateAuditLogInput {
  performedBy: string;        // employeeId who performed the action
  action: ActionType;
  module: ActionModule;
  tableName: string;          // e.g. "employees"
  recordId: string;           // cuid of the affected record
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
}

/**
 * Creates an audit log entry.
 *
 * This function is intended to be called as fire-and-forget:
 *   auditRepository.create({ ... }).catch(() => {})
 *
 * Errors are swallowed silently because an audit write failure must never
 * block or roll back the actual business operation.
 */
async function create(input: CreateAuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        employeeId: input.performedBy,
        action: input.action,
        module: input.module,
        tableName: input.tableName,
        recordId: input.recordId,
        // Only include oldData/newData keys if data is present.
        // Conditional spread avoids passing undefined to Prisma with
        // exactOptionalPropertyTypes enabled.
        ...(input.oldData != null && {
          oldData: stripSensitive(input.oldData),
        }),
        ...(input.newData != null && {
          newData: stripSensitive(input.newData),
        }),
      },
    });
  } catch (err) {
    // Log the failure but never re-throw — audit writes are non-critical.
    logger.error({ err, input }, "[AuditRepository] Failed to write audit log");
  }
}

export const auditRepository = {
  create,
} as const;
