/**
 * Wizard pure helpers: variant generation, SKU/barcode generation, and the
 * automatic financial calculations shown throughout the wizard. All pure — no
 * side effects — so they're trivially testable and reusable across steps.
 */

import type {
  AttributeValues,
  VariantPriceOverride,
  WizardState,
  WizardVariant,
} from "./types";

let seq = 0;
export function clientId(prefix = "v"): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

// ─── SKU / Barcode ─────────────────────────────────────────────────────────────

function seg(input: string, len: number): string {
  const cleaned = (input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.slice(0, len) || "X".repeat(len);
}

/** Mirrors the server's SKU format: <prefix|brand>-<cat|name>-<color>-<size>-<seq>. */
export function generateSku(opts: {
  prefix?: string;
  productName: string;
  categoryLabel?: string;
  color: string;
  size: string;
  sequence: number;
}): string {
  const parts: string[] = [];
  if (opts.prefix) parts.push(seg(opts.prefix, 4));
  parts.push(seg(opts.categoryLabel || opts.productName, 3));
  parts.push(seg(opts.color, 3));
  parts.push(seg(opts.size, 3));
  parts.push(String(opts.sequence).padStart(4, "0"));
  return parts.join("-");
}

function ean13CheckDigit(twelve: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = twelve.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/** Valid EAN-13 using the 200 in-store prefix. */
export function generateBarcode(prefix?: string): string {
  const base = (prefix || "200").replace(/\D/g, "").slice(0, 3).padEnd(3, "0");
  let body = "";
  for (let i = 0; i < 9; i++) body += Math.floor(Math.random() * 10);
  const twelve = (base + body).slice(0, 12);
  return twelve + String(ean13CheckDigit(twelve));
}

export function isValidEan13(barcode: string): boolean {
  if (!/^\d{13}$/.test(barcode)) return false;
  return ean13CheckDigit(barcode.slice(0, 12)) === barcode.charCodeAt(12) - 48;
}

// ─── Variant generation ────────────────────────────────────────────────────────

/**
 * Cartesian product of colors × sizes → variant rows, applying the wizard's
 * non-pricing defaults (stock, supplier, warehouse) and generating SKUs/barcodes.
 * Preserves any existing variant that matches the same size+color (so editing
 * attributes doesn't wipe already-entered details — including price overrides).
 *
 * Preservation stops at SKU and barcode. Those are DERIVED from the prefix
 * inputs that sit next to the Regenerate button, so carrying them over unchanged
 * made regeneration a no-op once every combination existed: the owner would edit
 * the prefix, click Regenerate, and watch nothing happen. A preserved variant
 * therefore keeps its typed details but re-derives its SKU (and its barcode, when
 * the barcode prefix no longer matches) from the current prefixes.
 *
 * Pricing is deliberately absent here: new variants start with
 * `priceOverride: null` and inherit state.pricing automatically. There is nothing
 * to "apply".
 */
export function generateVariants(
  attributes: AttributeValues,
  state: WizardState,
  existing: WizardVariant[]
): WizardVariant[] {
  const d = state.defaults;
  const byCombo = new Map(
    existing.map((v) => [`${v.sizeName.toLowerCase()}|${v.colorName.toLowerCase()}`, v])
  );

  // An empty prefix means "no in-store prefix", which generateBarcode renders as
  // the 200 default — so normalise both sides before comparing.
  const wantedBarcodePrefix = (d.barcodePrefix || "200")
    .replace(/\D/g, "")
    .slice(0, 3)
    .padEnd(3, "0");

  const result: WizardVariant[] = [];
  let n = 1;
  for (const color of attributes.colors) {
    for (const size of attributes.sizes) {
      const key = `${size.toLowerCase()}|${color.name.toLowerCase()}`;
      const sku = generateSku({
        prefix: d.skuPrefix,
        productName: state.name,
        color: color.name,
        size,
        sequence: n,
      });
      const prior = byCombo.get(key);
      if (prior) {
        // Re-roll the barcode only when the prefix actually changed; otherwise the
        // random body would churn on every click and invalidate printed labels.
        const keepBarcode =
          prior.barcode.length === 13 && prior.barcode.startsWith(wantedBarcodePrefix);
        // `removed` is left as-is: a combination the owner explicitly removed
        // stays removed across a regenerate, and is restored only via the
        // per-row Restore control.
        result.push({
          ...prior,
          sku,
          barcode: keepBarcode ? prior.barcode : generateBarcode(d.barcodePrefix),
        });
        n += 1;
        continue;
      }
      result.push({
        id: clientId(),
        sizeName: size,
        colorName: color.name,
        ...(color.hex ? { colorHex: color.hex } : {}),
        sku,
        barcode: generateBarcode(d.barcodePrefix),
        priceOverride: null, // inherits state.pricing
        status: "ACTIVE",
        openingStock: toNum(d.openingStock),
        reorderLevel: toNum(d.reorderLevel),
        maximumStock: d.maximumStock === "" ? "" : toNum(d.maximumStock),
        weight: "",
        lengthCm: "",
        widthCm: "",
        heightCm: "",
        warehouse: d.warehouse,
        rack: "",
        shelf: "",
        bin: "",
        shelfLocation: "",
        supplierId: d.supplierId,
        supplierSku: "",
        leadTimeDays: "",
        imageUrl: "",
      });
      n += 1;
    }
  }
  return result;
}

const toNum = (v: number | "" | undefined): number =>
  v === "" || v == null ? 0 : Number(v);

// ─── Pricing inheritance ───────────────────────────────────────────────────────

/** Resolved money for one variant, plus where it came from. */
export interface EffectivePricing extends VariantPriceOverride {
  /** true when this variant carries its own override rather than inheriting. */
  isOverride: boolean;
}

/**
 * Client mirror of catalogPricing.engine#discountAmountFor.
 *
 * Clamped to [0, mrp] exactly as the engine clamps it, so a ₹500 flat discount
 * on a ₹300 MRP shows ₹0 here and stores ₹0 there — the preview can never
 * promise a price the server won't produce.
 */
export function discountAmountFor(
  mrp: number,
  type: "PERCENTAGE" | "FLAT",
  value: number
): number {
  if (mrp <= 0 || value <= 0) return 0;
  const raw = type === "PERCENTAGE" ? (mrp * value) / 100 : value;
  return raw > mrp ? mrp : raw;
}

/**
 * Client mirror of catalogPricing.engine#backSolveDiscount. Always FLAT — an
 * exact rupee difference, immune to the rounding drift a derived percentage
 * would reintroduce.
 */
export function backSolveDiscount(mrp: number, sellingPrice: number): number {
  if (mrp <= 0) return 0;
  const diff = mrp - sellingPrice;
  return Math.round((diff < 0 ? 0 : diff) * 100) / 100;
}

/**
 * THE selling price for the product, however it was arrived at.
 *
 * Manual mode returns what the owner typed; derived mode returns
 * (mrp − defaultDiscount), matching the engine. Nothing may read
 * `pricing.sellingPrice` directly — in derived mode that field is only a cached
 * echo of this computation.
 */
export function derivedSellingPrice(pricing: WizardState["pricing"]): number {
  const mrp = toNum(pricing.mrp);
  if (pricing.isManualPricing) return toNum(pricing.sellingPrice);
  const discount = discountAmountFor(
    mrp,
    pricing.defaultDiscountType,
    toNum(pricing.defaultDiscountValue)
  );
  return Math.round((mrp - discount) * 100) / 100;
}

/** The product-level default pricing, normalised to numbers. */
export function productPricing(
  pricing: WizardState["pricing"]
): VariantPriceOverride {
  return {
    costPrice: toNum(pricing.costPrice),
    sellingPrice: derivedSellingPrice(pricing),
    mrp: toNum(pricing.mrp),
  };
}

/**
 * THE resolution rule for the whole wizard:
 *
 *     variant → uses product default pricing → unless an override exists
 *
 * Every margin, inventory value, retail value, profit and displayed price must go
 * through this function. Nothing else may read prices off a variant.
 */
export function effectivePricing(
  v: WizardVariant,
  pricing: WizardState["pricing"]
): EffectivePricing {
  if (v.priceOverride) {
    return {
      costPrice: toNum(v.priceOverride.costPrice),
      sellingPrice: toNum(v.priceOverride.sellingPrice),
      mrp: toNum(v.priceOverride.mrp),
      isOverride: true,
    };
  }
  return { ...productPricing(pricing), isOverride: false };
}

// ─── Financial calculations ────────────────────────────────────────────────────

export interface VariantCalc {
  margin: number; // selling - cost
  profitPct: number; // margin / selling * 100
  stockValue: number; // cost * openingStock
  retailValue: number; // selling * openingStock
  projectedProfit: number; // margin * openingStock
  isOverride: boolean;
}

/** Per-variant financials, always computed from the EFFECTIVE price. */
export function calcVariant(
  v: WizardVariant,
  pricing: WizardState["pricing"]
): VariantCalc {
  const { costPrice: cost, sellingPrice: sell, isOverride } = effectivePricing(v, pricing);
  const stock = toNum(v.openingStock);
  const margin = sell - cost;
  return {
    margin,
    profitPct: sell > 0 ? (margin / sell) * 100 : 0,
    stockValue: cost * stock,
    retailValue: sell * stock,
    projectedProfit: margin * stock,
    isOverride,
  };
}

export interface TotalsCalc {
  totalUnits: number;
  totalStockValue: number; // sum(effective cost * stock)
  totalRetailValue: number; // sum(effective selling * stock)
  projectedProfit: number; // sum(effective margin * stock)
  avgMarginPct: number | null;
  variantCount: number;
  overrideCount: number;
}

/**
 * Aggregate financials across all active variants, each resolved through
 * effectivePricing — so overridden variants contribute their own price and the
 * rest contribute the product default.
 */
export function calcTotals(
  variants: WizardVariant[],
  pricing: WizardState["pricing"]
): TotalsCalc {
  const active = variants.filter((v) => !v.removed);
  let totalUnits = 0;
  let totalStockValue = 0;
  let totalRetailValue = 0;
  let projectedProfit = 0;
  let overrideCount = 0;
  const margins: number[] = [];

  for (const v of active) {
    const { costPrice: cost, sellingPrice: sell, isOverride } = effectivePricing(v, pricing);
    const stock = toNum(v.openingStock);
    if (isOverride) overrideCount += 1;
    totalUnits += stock;
    totalStockValue += cost * stock;
    totalRetailValue += sell * stock;
    projectedProfit += (sell - cost) * stock;
    if (sell > 0) margins.push(((sell - cost) / sell) * 100);
  }

  return {
    totalUnits,
    totalStockValue,
    totalRetailValue,
    projectedProfit,
    avgMarginPct:
      margins.length > 0 ? margins.reduce((s, m) => s + m, 0) / margins.length : null,
    variantCount: active.length,
    overrideCount,
  };
}
