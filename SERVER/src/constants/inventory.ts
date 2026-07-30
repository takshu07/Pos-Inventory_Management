// =============================================================================
// INVENTORY CONSTANTS
//
// Server-side display labels for inventory enums.
//
// These exist because EXPORTS need human labels. A CSV column reading
// "SUPPLIER_ERROR" is a database value leaking into a document someone opens in
// Excel and sends to their accountant. The client has its own copy of these
// labels for the UI; this is the server's, used only where the server itself
// produces human-readable output.
// =============================================================================

import type { AdjustmentReason, MovementType } from "../../generated/prisma";

export const ADJUSTMENT_REASON_LABEL: Record<AdjustmentReason, string> = {
  DAMAGE: "Damage",
  LOST: "Lost",
  THEFT: "Theft",
  MISCOUNT: "Miscount",
  SUPPLIER_ERROR: "Supplier Error",
  SYSTEM_CORRECTION: "System Correction",
  EXPIRED: "Expired",
  OTHER: "Other",
};

export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  EXCHANGE_IN: "Exchange In",
  EXCHANGE_OUT: "Exchange Out",
  SUPPLIER_RETURN: "Supplier Return",
  MANUAL_ADJUSTMENT: "Adjustment",
  DAMAGED: "Damaged",
  LOST: "Lost",
  OPENING_STOCK: "Opening Stock",
};
