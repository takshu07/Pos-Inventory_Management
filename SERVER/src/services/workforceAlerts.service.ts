// =============================================================================
// WORKFORCE ALERTS
//
// The workforce module's alert vocabulary, dispatched through the EXISTING
// NotificationEngine. This file adds no delivery mechanism of its own — the
// engine already handles channels, persistence and future email/push, so this
// is purely the set of workforce conditions worth interrupting someone for,
// plus the wording each one uses.
//
// Why a dedicated module rather than inline dispatch calls:
//   • The THRESHOLDS live in one place. "High refund rate" must mean the same
//     number wherever it is detected, and a magic 0.2 scattered across three
//     services is how that stops being true.
//   • Every alert is fire-and-forget. A notification failure must never fail
//     the operation that triggered it — clocking in has to succeed even if the
//     alert about being late cannot be delivered.
// =============================================================================

import { logger } from "../config/logger";
import { NotificationEngine } from "../engines/notification.engine";
import { LARGE_DISCOUNT_THRESHOLD } from "../engines/workforce.engine";

/**
 * Thresholds, stated once.
 *
 * LARGE_DISCOUNT reuses the engine's constant rather than redeclaring it, so a
 * discount that shows as CRITICAL in the activity feed is exactly the one that
 * raises an alert — the two can never disagree.
 */
export const ALERT_THRESHOLDS = {
  /** Refunds ÷ transactions, above which an employee's rate is notable. */
  highRefundRate: 0.2,
  /** Discount fraction of a single sale that warrants an alert. */
  largeDiscount: LARGE_DISCOUNT_THRESHOLD,
  /** Failed sign-ins from one source before it is treated as an attack. */
  failedLogins: 5,
  /** Minutes an on-shift cashier may be idle before it is worth flagging. */
  idleMinutes: 45,
  /** Performance score at or above which someone is a top performer. */
  topPerformerScore: 85,
} as const;

/**
 * Fire-and-forget dispatch.
 *
 * Every caller is inside an operation that must succeed regardless — an alert
 * is an observation about work, never a precondition for it.
 */
function emit(payload: Parameters<typeof NotificationEngine.dispatch>[0]): void {
  NotificationEngine.dispatch(payload).catch((err: unknown) => {
    logger.error({ err, type: payload.type }, "[WorkforceAlerts] dispatch failed");
  });
}

// ── Attendance ───────────────────────────────────────────────────────────────

export function employeeLate(params: {
  employeeId: string;
  employeeName: string;
  lateMinutes: number;
  attendanceId: string;
}): void {
  emit({
    type: "ATTENDANCE_LATE",
    title: "Late arrival",
    message: `${params.employeeName} clocked in ${params.lateMinutes} minutes late.`,
    referenceId: params.attendanceId,
    referenceType: "ATTENDANCE",
    targetRole: "OWNER",
  });
}

export function employeeAbsent(params: {
  employeeId: string;
  employeeName: string;
  date: Date;
}): void {
  emit({
    type: "ATTENDANCE_ABSENT",
    title: "Absent today",
    message: `${params.employeeName} has no clock-in recorded for ${params.date
      .toISOString()
      .slice(0, 10)}.`,
    referenceId: params.employeeId,
    referenceType: "EMPLOYEE",
    targetRole: "OWNER",
  });
}

/**
 * A cashier who is signed in and on shift but has recorded nothing for a while.
 * Deliberately advisory — there are many innocent reasons, which is why this is
 * a notification and not a flag on their record.
 */
export function idleCashier(params: {
  employeeId: string;
  employeeName: string;
  idleMinutes: number;
}): void {
  emit({
    type: "EMPLOYEE_IDLE",
    title: "Idle cashier",
    message: `${params.employeeName} has recorded no activity for ${params.idleMinutes} minutes while signed in.`,
    referenceId: params.employeeId,
    referenceType: "EMPLOYEE",
    targetRole: "OWNER",
  });
}

// ── Money ────────────────────────────────────────────────────────────────────

export function highRefundRate(params: {
  employeeId: string;
  employeeName: string;
  refundRate: number;
  refunds: number;
}): void {
  emit({
    type: "HIGH_REFUND_RATE",
    title: "High refund rate",
    message: `${params.employeeName} has a ${(params.refundRate * 100).toFixed(
      0
    )}% refund rate (${params.refunds} refunds).`,
    referenceId: params.employeeId,
    referenceType: "EMPLOYEE",
    targetRole: "OWNER",
  });
}

export function largeDiscountGiven(params: {
  employeeId: string;
  employeeName: string;
  discountRate: number;
  saleId: string;
}): void {
  emit({
    type: "LARGE_DISCOUNT",
    title: "Large discount given",
    message: `${params.employeeName} applied a ${(params.discountRate * 100).toFixed(
      0
    )}% discount on a single sale.`,
    referenceId: params.saleId,
    referenceType: "SALE",
    targetRole: "OWNER",
  });
}

// ── Security ─────────────────────────────────────────────────────────────────

export function multipleFailedLogins(params: {
  employeeId: string;
  employeeName: string;
  attempts: number;
  ipAddress: string | null;
}): void {
  emit({
    type: "FAILED_LOGIN_ATTEMPTS",
    title: "Multiple failed sign-ins",
    message: `${params.attempts} failed sign-in attempts for ${params.employeeName}${
      params.ipAddress ? ` from ${params.ipAddress}` : ""
    }.`,
    referenceId: params.employeeId,
    referenceType: "EMPLOYEE",
    targetRole: "OWNER",
  });
}

export function inventoryEdited(params: {
  employeeId: string;
  employeeName: string;
  productName: string;
  referenceId: string;
}): void {
  emit({
    type: "INVENTORY_EDITED",
    title: "Inventory adjusted",
    message: `${params.employeeName} adjusted stock for ${params.productName}.`,
    referenceId: params.referenceId,
    referenceType: "INVENTORY",
    targetRole: "OWNER",
  });
}

// ── Recognition ──────────────────────────────────────────────────────────────

export function topPerformer(params: {
  employeeId: string;
  employeeName: string;
  score: number;
}): void {
  emit({
    type: "TOP_PERFORMER",
    title: "Top performer",
    message: `${params.employeeName} reached a performance score of ${params.score.toFixed(
      1
    )}.`,
    referenceId: params.employeeId,
    referenceType: "EMPLOYEE",
    targetRole: "OWNER",
  });
}
