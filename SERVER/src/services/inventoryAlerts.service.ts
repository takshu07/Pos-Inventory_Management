// =============================================================================
// INVENTORY ALERTS
//
// The inventory module's alert vocabulary, dispatched through the EXISTING
// NotificationEngine. No delivery mechanism of its own — the engine already
// owns channels, persistence and future email/push. This file is the set of
// stock conditions worth interrupting someone for, plus the wording each uses.
//
// Every alert is fire-and-forget. A notification failure must never fail the
// stock operation that triggered it: a sale has to complete even if the
// low-stock warning about it cannot be delivered.
// =============================================================================

import { logger } from "../config/logger";
import { NotificationEngine } from "../engines/notification.engine";

/**
 * Thresholds, stated once.
 *
 * A magic number scattered across three services is how "large adjustment"
 * stops meaning the same thing in the alert and in the report.
 */
export const INVENTORY_ALERT_THRESHOLDS = {
  /** Unit change at or above which a manual correction is worth flagging. */
  largeAdjustmentUnits: 20,
  /** Count accuracy below which a session is worth investigating. */
  poorAccuracyPercent: 95,
} as const;

function emit(payload: Parameters<typeof NotificationEngine.dispatch>[0]): void {
  NotificationEngine.dispatch(payload).catch((err: unknown) => {
    logger.error({ err, type: payload.type }, "[InventoryAlerts] dispatch failed");
  });
}

function describe(params: { productName: string; sku: string }): string {
  return `${params.productName} (${params.sku})`;
}

// ── Stock levels ─────────────────────────────────────────────────────────────

export function lowStock(params: {
  variantId: string;
  productName: string;
  sku: string;
  available: number;
  reorderLevel: number;
}): void {
  emit({
    type: "LOW_STOCK",
    title: "Low stock",
    message: `${describe(params)} is down to ${params.available} — at or below its reorder level of ${params.reorderLevel}.`,
    referenceId: params.variantId,
    referenceType: "PRODUCT",
    targetRole: "OWNER",
  });
}

export function outOfStock(params: {
  variantId: string;
  productName: string;
  sku: string;
}): void {
  emit({
    type: "OUT_OF_STOCK",
    title: "Out of stock",
    message: `${describe(params)} is out of stock.`,
    referenceId: params.variantId,
    referenceType: "PRODUCT",
    targetRole: "OWNER",
  });
}

/**
 * Negative stock is a DATA problem, not a stock level — something wrote past
 * zero. It gets its own alert rather than folding into out-of-stock, which
 * looks routine and would let a real corruption pass unnoticed.
 */
export function negativeStock(params: {
  variantId: string;
  productName: string;
  sku: string;
  currentStock: number;
}): void {
  emit({
    type: "NEGATIVE_STOCK",
    title: "Negative stock detected",
    message: `${describe(params)} has a stock level of ${params.currentStock}. This indicates a data problem and should be investigated.`,
    referenceId: params.variantId,
    referenceType: "PRODUCT",
    targetRole: "OWNER",
  });
}

// ── Adjustments ──────────────────────────────────────────────────────────────

export function adjustmentRequested(params: {
  adjustmentId: string;
  productName: string;
  sku: string;
  quantityChange: number;
  requestedBy: string;
}): void {
  const direction = params.quantityChange > 0 ? "increase" : "decrease";

  emit({
    type: "ADJUSTMENT_REQUESTED",
    title: "Stock adjustment awaiting approval",
    message: `A request to ${direction} ${describe(params)} by ${Math.abs(
      params.quantityChange
    )} units is waiting for your approval.`,
    referenceId: params.adjustmentId,
    referenceType: "INVENTORY",
    targetRole: "OWNER",
  });
}

/** Only fires above the threshold — every approved tweak would be noise. */
export function largeAdjustmentApproved(params: {
  variantId: string;
  productName: string;
  sku: string;
  quantityChange: number;
  stockAfter: number;
}): void {
  if (Math.abs(params.quantityChange) < INVENTORY_ALERT_THRESHOLDS.largeAdjustmentUnits) {
    return;
  }

  emit({
    type: "LARGE_ADJUSTMENT",
    title: "Large stock adjustment",
    message: `${describe(params)} was adjusted by ${params.quantityChange} units, leaving ${params.stockAfter} in stock.`,
    referenceId: params.variantId,
    referenceType: "PRODUCT",
    targetRole: "OWNER",
  });
}

// ── Damage & counts ──────────────────────────────────────────────────────────

export function damagedStockReported(params: {
  variantId: string;
  productName: string;
  sku: string;
  quantity: number;
  reason: string;
}): void {
  emit({
    type: "DAMAGED_INVENTORY",
    title: "Damaged stock reported",
    message: `${params.quantity} × ${describe(params)} written off as damaged — ${params.reason}.`,
    referenceId: params.variantId,
    referenceType: "PRODUCT",
    targetRole: "OWNER",
  });
}

/**
 * Announces a completed count, and flags a poor one.
 *
 * A clean count is worth a quiet confirmation; an inaccurate one is worth
 * attention, so the wording differs rather than sending the same neutral line
 * for both.
 */
export function cycleCountCompleted(params: {
  cycleCountId: string;
  reference: string;
  varianceItems: number;
  accuracy: number;
}): void {
  const poor = params.accuracy < INVENTORY_ALERT_THRESHOLDS.poorAccuracyPercent;

  emit({
    type: "CYCLE_COUNT_COMPLETED",
    title: poor ? "Cycle count found discrepancies" : "Cycle count completed",
    message: poor
      ? `${params.reference} finished at ${params.accuracy}% accuracy with ${params.varianceItems} discrepancies.`
      : `${params.reference} finished at ${params.accuracy}% accuracy.`,
    referenceId: params.cycleCountId,
    referenceType: "INVENTORY",
    targetRole: "OWNER",
  });
}

export function purchaseReceived(params: {
  purchaseId: string;
  purchaseNumber: string;
  itemCount: number;
}): void {
  emit({
    type: "PURCHASE_RECEIVED",
    title: "Stock received",
    message: `${params.purchaseNumber} received — ${params.itemCount} line${
      params.itemCount === 1 ? "" : "s"
    } added to inventory.`,
    referenceId: params.purchaseId,
    referenceType: "PURCHASE",
    targetRole: "OWNER",
  });
}
