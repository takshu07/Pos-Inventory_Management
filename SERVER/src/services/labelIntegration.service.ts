// =============================================================================
// LABEL INTEGRATION SERVICE
//
// The bridge between existing business modules and the Label Engine.
//
// Why this file exists rather than calling labelService from purchase.service
// directly: each integration has its own quantity semantics ("received 40 →
// print 40"), and putting that logic here keeps the Purchase, Product and
// Inventory services free of any printing knowledge. They fire an intent; this
// module translates it into a print job.
//
// EVERY function here funnels into labelService.enqueuePrintJob — no module
// gets a private path to a printer.
// =============================================================================

import { PrintSourceModule } from "../../generated/prisma";
import type { EmployeeRole } from "../../generated/prisma";
import { logger } from "../config/logger";
import { prisma } from "../config/prisma";
import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { printerRepository } from "../repositories/printer.repository";
import type { PrintJobDetail } from "../repositories/printJob.repository";
import * as labelService from "./label.service";
import type { PrintOptionOverrides } from "./label.service";

type Actor = { id: string; role: EmployeeRole };

// ─── Product module ───────────────────────────────────────────────────────────

/**
 * Prints labels for chosen variants of one product.
 *
 * When `variantIds` is omitted every active variant is printed — the common
 * case after creating a product with several sizes/colours.
 */
export async function printProductLabels(
  productId: string,
  actor: Actor,
  // Optional fields spell out `| undefined` because callers forward
  // Zod-parsed payloads and the project uses exactOptionalPropertyTypes.
  options: {
    variantIds?: string[] | undefined;
    copies?: number | undefined;
    printOptions?: PrintOptionOverrides | undefined;
    reason?: string | null | undefined;
  } = {}
): Promise<PrintJobDetail> {
  const variants = await prisma.productVariant.findMany({
    where: {
      productId,
      isActive: true,
      ...(options.variantIds &&
        options.variantIds.length > 0 && { id: { in: options.variantIds } }),
    },
    select: { id: true },
    orderBy: { sku: "asc" },
  });

  if (variants.length === 0) {
    throw new AppError(
      HTTP_STATUS.NOT_FOUND,
      "This product has no active variants to print labels for."
    );
  }

  return labelService.enqueuePrintJob(
    {
      items: variants.map((variant) => ({
        variantId: variant.id,
        ...(options.copies !== undefined && { copies: options.copies }),
      })),
      source: PrintSourceModule.PRODUCT,
      reason: options.reason ?? "Product labels",
      ...(options.printOptions !== undefined && { options: options.printOptions }),
    },
    actor
  );
}

/**
 * Called after a product is created.
 *
 * Honours the `printAfterProductCreate` setting and is deliberately
 * NON-THROWING: a printer problem must never roll back or fail a successful
 * product creation. Returns null when nothing was queued.
 */
export async function maybePrintAfterProductCreate(
  productId: string,
  actor: Actor
): Promise<PrintJobDetail | null> {
  try {
    const settings = await printerRepository.getSettings();
    if (!settings.printAfterProductCreate) return null;

    return await printProductLabels(productId, actor, {
      reason: "Automatic print after product creation",
    });
  } catch (err) {
    logger.warn(
      { err, productId },
      "[LabelEngine] Automatic post-create label print failed (product creation is unaffected)"
    );
    return null;
  }
}

// ─── Purchase module ──────────────────────────────────────────────────────────

/**
 * Prints one label per unit received on a purchase.
 *
 * This is the spec's "Received 40 Shirts → Print 40 Labels": copies come from
 * the received quantity, so a 40-unit line yields 40 labels from ONE job item
 * (copies are a count, never 40 duplicated rows).
 */
export async function printPurchaseLabels(
  purchaseId: string,
  actor: Actor,
  options: {
    printOptions?: PrintOptionOverrides | undefined;
    reason?: string | null | undefined;
    /** Print one label per line instead of one per received unit. */
    singlePerVariant?: boolean | undefined;
  } = {}
): Promise<PrintJobDetail> {
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      purchaseNumber: true,
      items: {
        select: {
          variantId: true,
          quantity: true,
        },
      },
    },
  });

  if (!purchase) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Purchase not found.");
  }
  if (purchase.items.length === 0) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      "This purchase has no items to print labels for."
    );
  }

  // PurchaseItem models a single `quantity` (this schema records receipt by
  // flipping Purchase.status to RECEIVED and posting inventory movements, not
  // by tracking partial receipts per line). So ordered quantity IS the received
  // quantity here — if partial receipts are ever added to PurchaseItem, this is
  // the one line that needs to prefer the received figure.
  const items = purchase.items
    .map((item) => ({
      variantId: item.variantId,
      copies: options.singlePerVariant ? 1 : Math.max(1, item.quantity),
    }))
    .filter((item) => item.copies > 0);

  return labelService.enqueuePrintJob(
    {
      items,
      source: PrintSourceModule.PURCHASE,
      reason: options.reason ?? `Labels for purchase ${purchase.purchaseNumber}`,
      ...(options.printOptions !== undefined && { options: options.printOptions }),
    },
    actor
  );
}

/**
 * Called after a purchase is received.
 *
 * Honours `printAfterPurchase` and never throws — receiving stock must succeed
 * even if the label printer is unplugged.
 */
export async function maybePrintAfterPurchaseReceive(
  purchaseId: string,
  actor: Actor
): Promise<PrintJobDetail | null> {
  try {
    const settings = await printerRepository.getSettings();
    if (!settings.printAfterPurchase) return null;

    return await printPurchaseLabels(purchaseId, actor, {
      reason: "Automatic print after goods receipt",
    });
  } catch (err) {
    logger.warn(
      { err, purchaseId },
      "[LabelEngine] Automatic post-receipt label print failed (stock receipt is unaffected)"
    );
    return null;
  }
}

// ─── Inventory module ─────────────────────────────────────────────────────────

export type InventoryPrintReason =
  | "REPLACE_DAMAGED"
  | "MISSING_LABELS"
  | "RECOUNT"
  | "RELABEL";

const INVENTORY_REASON_TEXT: Record<InventoryPrintReason, string> = {
  REPLACE_DAMAGED: "Replacing damaged labels",
  MISSING_LABELS: "Printing missing labels",
  RECOUNT: "Stock recount relabelling",
  RELABEL: "Inventory relabelling",
};

/** Prints labels from an inventory workflow, with a typed business reason. */
export async function printInventoryLabels(
  variantIds: string[],
  actor: Actor,
  reason: InventoryPrintReason,
  options: {
    copies?: number | undefined;
    printOptions?: PrintOptionOverrides | undefined;
  } = {}
): Promise<PrintJobDetail> {
  if (variantIds.length === 0) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Select at least one product.");
  }

  return labelService.enqueuePrintJob(
    {
      items: variantIds.map((variantId) => ({
        variantId,
        ...(options.copies !== undefined && { copies: options.copies }),
      })),
      source: PrintSourceModule.INVENTORY,
      reason: INVENTORY_REASON_TEXT[reason],
      ...(options.printOptions !== undefined && { options: options.printOptions }),
    },
    actor
  );
}

/**
 * Prints labels for every variant currently below its reorder level.
 *
 * Reuses the same low-stock semantics as the catalog module (reorderLevel with
 * a default threshold) rather than inventing a second definition of "low".
 */
export async function printLowStockLabels(
  actor: Actor,
  options: {
    limit?: number | undefined;
    printOptions?: PrintOptionOverrides | undefined;
  } = {}
): Promise<PrintJobDetail> {
  const limit = Math.min(options.limit ?? 200, 1000);

  // currentStock <= reorderLevel is a column-to-column comparison, which needs
  // a field reference rather than a literal.
  const variants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      reorderLevel: { not: null },
      currentStock: { lte: prisma.productVariant.fields.reorderLevel },
    },
    select: { id: true },
    take: limit,
  });

  if (variants.length === 0) {
    throw new AppError(
      HTTP_STATUS.NOT_FOUND,
      "No products are currently at or below their reorder level."
    );
  }

  return labelService.enqueuePrintJob(
    {
      items: variants.map((variant) => ({ variantId: variant.id })),
      source: PrintSourceModule.INVENTORY,
      reason: "Low-stock shelf labels",
      ...(options.printOptions !== undefined && { options: options.printOptions }),
    },
    actor
  );
}

// ─── Search module ────────────────────────────────────────────────────────────

/**
 * Prints straight from search results, without opening a product.
 *
 * The search integration passes the variant ids it already displayed, so this
 * neither re-runs the query nor duplicates search logic.
 */
export async function printFromSearch(
  variantIds: string[],
  actor: Actor,
  options: {
    copies?: number | undefined;
    printOptions?: PrintOptionOverrides | undefined;
  } = {}
): Promise<PrintJobDetail> {
  if (variantIds.length === 0) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Select at least one search result.");
  }

  return labelService.enqueuePrintJob(
    {
      items: variantIds.map((variantId) => ({
        variantId,
        ...(options.copies !== undefined && { copies: options.copies }),
      })),
      source: PrintSourceModule.SEARCH,
      reason: "Printed from search results",
      ...(options.printOptions !== undefined && { options: options.printOptions }),
    },
    actor
  );
}

export const labelIntegrationService = {
  printProductLabels,
  maybePrintAfterProductCreate,
  printPurchaseLabels,
  maybePrintAfterPurchaseReceive,
  printInventoryLabels,
  printLowStockLabels,
  printFromSearch,
} as const;
