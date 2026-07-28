// =============================================================================
// LABEL DATA RESOLVER
//
// Turns ProductVariant rows into LabelData — the ONLY place the engine touches
// the product catalog. Renderers, drivers and the queue never query Prisma.
//
// Two reuse rules from the brief are honoured here:
//   • Store identity comes from the existing ConfigurationEngine, not a new
//     label-specific settings copy.
//   • Pricing is read from the variant's derived sellingPrice cache, which the
//     existing effectivePrice service owns. The Label Engine never recomputes a
//     price — printing a different price than the POS charges would be a
//     correctness bug, so there is exactly one source of truth.
//
// Batch-first design: resolveMany() fetches N variants in ONE query with a
// bounded include. Printing 500 labels must not issue 500 round-trips —
// against Neon that would dominate the entire job duration.
// =============================================================================

import type { BarcodeSymbology } from "../../../generated/prisma";
import { prisma } from "../../config/prisma";
import { HTTP_STATUS } from "../../constants/httpStatus";
import { ConfigurationEngine } from "../configuration.engine";
import { AppError } from "../../errors/AppError";
import { barcodeEngine } from "./barcode/barcode.engine";
import type { LabelData } from "./label.types";

/** Currency symbols for the currencies the store settings can hold. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  AED: "د.إ",
  AUD: "A$",
  CAD: "C$",
  SGD: "S$",
};

function currencySymbolFor(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? currency.toUpperCase();
}

/** Prisma Decimal → number. Decimals never escape this module. */
function decimalToNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The exact variant shape the resolver needs. Declared as an explicit select so
 * a schema change surfaces as a compile error, and so we never over-fetch the
 * whole product graph for a 50×25mm label.
 */
const VARIANT_SELECT = {
  id: true,
  productId: true,
  sku: true,
  barcode: true,
  mrp: true,
  sellingPrice: true,
  currentStock: true,
  warehouse: true,
  rack: true,
  shelf: true,
  bin: true,
  shelfLocation: true,
  size: { select: { name: true } },
  color: { select: { name: true } },
  product: {
    select: {
      id: true,
      name: true,
      hsnCode: true,
      gstRate: true,
      category: { select: { name: true } },
      brand: { select: { name: true } },
    },
  },
} as const;

type VariantForLabel = {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  mrp: unknown;
  sellingPrice: unknown;
  currentStock: number;
  warehouse: string | null;
  rack: string | null;
  shelf: string | null;
  bin: string | null;
  shelfLocation: string | null;
  size: { name: string } | null;
  color: { name: string } | null;
  product: {
    id: string;
    name: string;
    hsnCode: string | null;
    gstRate: unknown;
    category: { name: string } | null;
    brand: { name: string } | null;
  };
};

/** Store-level context resolved once per batch, not once per label. */
interface StoreContext {
  storeName: string;
  storeLogoUrl: string | null;
  currency: string;
  currencySymbol: string;
  defaultSymbology: BarcodeSymbology;
}

async function loadStoreContext(
  defaultSymbology: BarcodeSymbology
): Promise<StoreContext> {
  // ConfigurationEngine caches in memory; init() is idempotent and cheap.
  await ConfigurationEngine.init();

  const currency = ConfigurationEngine.getCurrency();
  const storeSettings = ConfigurationEngine.getStoreSettings();

  return {
    storeName: ConfigurationEngine.getStoreName(),
    storeLogoUrl: storeSettings.logoUrl ?? null,
    currency,
    currencySymbol: currencySymbolFor(currency),
    defaultSymbology,
  };
}

/**
 * Maps one variant row + store context into LabelData.
 *
 * Discount is derived here rather than stored: mrp − sellingPrice is always
 * current, whereas a stored discount would go stale the moment a pricing rule
 * changed, and would print a promotion the till would not honour.
 */
function toLabelData(
  variant: VariantForLabel,
  store: StoreContext,
  printedAt: Date
): LabelData {
  const mrp = decimalToNumber(variant.mrp);
  const sellingPrice = decimalToNumber(variant.sellingPrice);

  // Clamp at zero: a selling price above MRP is a data error, not a negative
  // discount, and must never render as "-15% off".
  const discountAmount = Math.max(0, mrp - sellingPrice);
  const discountPercent =
    mrp > 0 ? Math.round((discountAmount / mrp) * 100) : 0;

  const size = variant.size?.name ?? null;
  const color = variant.color?.name ?? null;
  const variantName = [color, size].filter(Boolean).join(" / ");

  // The stored barcode may not suit the configured symbology (an internal SKU
  // cannot be EAN-13). Resolve per value so the label is always scannable.
  const barcodeValue = variant.barcode ?? variant.sku;
  const barcodeSymbology = barcodeEngine.resolveSymbologyForValue(
    barcodeValue,
    store.defaultSymbology
  );

  return {
    variantId: variant.id,
    productId: variant.productId,

    storeName: store.storeName,
    storeLogoUrl: store.storeLogoUrl,

    brand: variant.product.brand?.name ?? null,
    category: variant.product.category?.name ?? null,

    productName: variant.product.name,
    variantName,
    size,
    color,

    sku: variant.sku,
    barcode: variant.barcode,
    barcodeSymbology,

    mrp,
    sellingPrice,
    discountAmount,
    discountPercent,
    currency: store.currency,
    currencySymbol: store.currencySymbol,

    // Batch/expiry are not yet modelled on ProductVariant. They are part of the
    // LabelData contract so templates can bind them today; when the fields land
    // on the schema only this mapping changes — no template, renderer or driver
    // is affected.
    batchNumber: null,
    manufacturingDate: null,
    expiryDate: null,

    warehouse: variant.warehouse,
    rack: variant.rack,
    shelf: variant.shelf,
    bin: variant.bin,
    shelfLocation: variant.shelfLocation,

    currentStock: variant.currentStock,

    hsnCode: variant.product.hsnCode,
    gstRate:
      variant.product.gstRate === null || variant.product.gstRate === undefined
        ? null
        : decimalToNumber(variant.product.gstRate),

    // Future symbologies: the QR payload defaults to the barcode value so a QR
    // template works the moment a matrix encoder is registered.
    qrValue: barcodeValue,
    rfidTag: null,

    printedAt,
  };
}

/**
 * Resolves label data for many variants in a single query.
 *
 * Returns data in the SAME ORDER as `variantIds`, and reports any ids that no
 * longer exist so the caller can mark those job items FAILED rather than
 * silently printing fewer labels than requested.
 */
export async function resolveMany(
  variantIds: string[],
  defaultSymbology: BarcodeSymbology
): Promise<{ labels: LabelData[]; missingIds: string[] }> {
  if (variantIds.length === 0) return { labels: [], missingIds: [] };

  const uniqueIds = [...new Set(variantIds)];
  const store = await loadStoreContext(defaultSymbology);
  const printedAt = new Date();

  const variants = (await prisma.productVariant.findMany({
    where: { id: { in: uniqueIds } },
    select: VARIANT_SELECT,
  })) as unknown as VariantForLabel[];

  const byId = new Map(variants.map((variant) => [variant.id, variant]));

  const labels: LabelData[] = [];
  const missingIds: string[] = [];

  // Preserve the caller's ordering — a purchase receipt prints in line order,
  // and a reprint must reproduce the original sequence exactly.
  for (const id of variantIds) {
    const variant = byId.get(id);
    if (!variant) {
      if (!missingIds.includes(id)) missingIds.push(id);
      continue;
    }
    labels.push(toLabelData(variant, store, printedAt));
  }

  return { labels, missingIds };
}

/** Resolves a single variant. Throws 404 when it does not exist. */
export async function resolveOne(
  variantId: string,
  defaultSymbology: BarcodeSymbology
): Promise<LabelData> {
  const { labels } = await resolveMany([variantId], defaultSymbology);
  const label = labels[0];
  if (!label) {
    throw new AppError(
      HTTP_STATUS.NOT_FOUND,
      "Product variant not found, so no label can be generated."
    );
  }
  return label;
}

/**
 * Builds LabelData for a variant that does not exist yet — used by the template
 * designer/preview so an owner can see a layout without picking a real product.
 */
export async function resolveSample(
  defaultSymbology: BarcodeSymbology
): Promise<LabelData> {
  const store = await loadStoreContext(defaultSymbology);

  return {
    variantId: "sample",
    productId: "sample",
    storeName: store.storeName,
    storeLogoUrl: store.storeLogoUrl,
    brand: "Sample Brand",
    category: "T-Shirts",
    productName: "Classic Cotton T-Shirt",
    variantName: "Black / L",
    size: "L",
    color: "Black",
    sku: "SMP-TSH-BLK-L-0001",
    barcode: "5901234123457",
    barcodeSymbology: store.defaultSymbology,
    mrp: 1499,
    sellingPrice: 1199,
    discountAmount: 300,
    discountPercent: 20,
    currency: store.currency,
    currencySymbol: store.currencySymbol,
    batchNumber: "B-2026-07",
    manufacturingDate: new Date(),
    expiryDate: null,
    warehouse: "Main",
    rack: "A-3",
    shelf: "2",
    bin: "B-14",
    shelfLocation: "A-3-2",
    currentStock: 42,
    hsnCode: "6109",
    gstRate: 5,
    qrValue: "5901234123457",
    rfidTag: null,
    printedAt: new Date(),
  };
}

export const labelDataResolver = {
  resolveMany,
  resolveOne,
  resolveSample,
} as const;
