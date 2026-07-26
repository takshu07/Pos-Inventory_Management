/**
 * Wizard pure helpers: variant generation, SKU/barcode generation, and the
 * automatic financial calculations shown throughout the wizard. All pure — no
 * side effects — so they're trivially testable and reusable across steps.
 */

import type { AttributeValues, WizardState, WizardVariant } from "./types";

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
 * current defaults (prices, stock, supplier) and generating SKUs/barcodes.
 * Preserves any existing variant that matches the same size+color (so editing
 * attributes doesn't wipe already-entered variant details).
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

  const result: WizardVariant[] = [];
  let n = 1;
  for (const color of attributes.colors) {
    for (const size of attributes.sizes) {
      const key = `${size.toLowerCase()}|${color.name.toLowerCase()}`;
      const prior = byCombo.get(key);
      if (prior) {
        result.push({ ...prior, removed: false });
        n += 1;
        continue;
      }
      result.push({
        id: clientId(),
        sizeName: size,
        colorName: color.name,
        ...(color.hex ? { colorHex: color.hex } : {}),
        sku: generateSku({
          prefix: d.skuPrefix,
          productName: state.name,
          color: color.name,
          size,
          sequence: n,
        }),
        barcode: generateBarcode(d.barcodePrefix),
        costPrice: toNum(d.costPrice),
        sellingPrice: toNum(d.sellingPrice),
        mrp: toNum(d.mrp),
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
        discountAllowed: true,
        maxDiscountPct: "",
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

// ─── Financial calculations ────────────────────────────────────────────────────

export interface VariantCalc {
  margin: number; // selling - cost
  profitPct: number; // margin / selling * 100
  stockValue: number; // cost * openingStock
}

export function calcVariant(v: WizardVariant): VariantCalc {
  const cost = toNum(v.costPrice);
  const sell = toNum(v.sellingPrice);
  const stock = toNum(v.openingStock);
  const margin = sell - cost;
  const profitPct = sell > 0 ? (margin / sell) * 100 : 0;
  return { margin, profitPct, stockValue: cost * stock };
}

export interface TotalsCalc {
  totalUnits: number;
  totalStockValue: number; // sum(cost * stock)
  totalRetailValue: number; // sum(selling * stock)
  avgMarginPct: number | null;
  variantCount: number;
}

export function calcTotals(variants: WizardVariant[]): TotalsCalc {
  const active = variants.filter((v) => !v.removed);
  let totalUnits = 0;
  let totalStockValue = 0;
  let totalRetailValue = 0;
  const margins: number[] = [];

  for (const v of active) {
    const cost = toNum(v.costPrice);
    const sell = toNum(v.sellingPrice);
    const stock = toNum(v.openingStock);
    totalUnits += stock;
    totalStockValue += cost * stock;
    totalRetailValue += sell * stock;
    if (sell > 0) margins.push(((sell - cost) / sell) * 100);
  }

  return {
    totalUnits,
    totalStockValue,
    totalRetailValue,
    avgMarginPct:
      margins.length > 0 ? margins.reduce((s, m) => s + m, 0) / margins.length : null,
    variantCount: active.length,
  };
}
