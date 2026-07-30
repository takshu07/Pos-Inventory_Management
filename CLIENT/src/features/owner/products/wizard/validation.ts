/**
 * Wizard validation. Two tiers:
 *   • errors   — block progression / submission (hard rules from the spec)
 *   • warnings — surfaced in the ValidationPanel but never block (e.g. selling <
 *                cost, zero stock, missing images/supplier)
 * Per-step error maps drive the "can I advance?" gate; the review step shows the
 * full aggregate.
 */

import { effectivePricing, isValidEan13, productPricing } from "./helpers";
import type {
  VariantPriceOverride,
  WizardState,
  WizardStepKey,
  WizardVariant,
} from "./types";

export interface WizardIssue {
  level: "error" | "warning";
  message: string;
}

const activeVariants = (s: WizardState): WizardVariant[] =>
  s.variants.filter((v) => !v.removed);

// ─── Money rules (shared by the Pricing step and the override dialog) ─────────

/**
 * The money invariants, in one place so the product pricing and every per-variant
 * override are held to identical rules:
 *   • no negative prices
 *   • selling >= cost   (margin can never be below 0%)
 *   • mrp >= selling
 * Mirrors the server's variantSchema refinements so bad data is caught before
 * submission rather than bouncing back from the API.
 */
export function validatePriceTriplet(
  p: VariantPriceOverride,
  opts: { requirePositiveSelling?: boolean; label?: string } = {}
): string[] {
  const e: string[] = [];
  const prefix = opts.label ? `${opts.label}: ` : "";
  const { costPrice: cost, sellingPrice: sell, mrp } = p;

  if (!Number.isFinite(cost) || !Number.isFinite(sell) || !Number.isFinite(mrp)) {
    e.push(`${prefix}prices must be valid numbers.`);
    return e;
  }
  if (cost < 0 || sell < 0 || mrp < 0) e.push(`${prefix}prices cannot be negative.`);
  if (opts.requirePositiveSelling && sell <= 0)
    e.push(`${prefix}selling price must be greater than zero.`);
  if (sell < cost)
    e.push(`${prefix}selling price cannot be below cost price (margin would be negative).`);
  if (mrp > 0 && mrp < sell) e.push(`${prefix}MRP cannot be below the selling price.`);
  return e;
}

/** Errors for the Pricing step: the product-level money configuration. */
export function pricingErrors(s: WizardState): string[] {
  const p = s.pricing;
  const e: string[] = [];

  // In derived mode the selling price is computed from (MRP − discount), so MRP
  // is the required input and sellingPrice is never typed. Only manual pricing
  // asks the owner for a price directly.
  if (p.isManualPricing && p.sellingPrice === "") e.push("Selling price is required.");
  if (p.costPrice === "") e.push("Cost price is required.");
  if (p.mrp === "") e.push("MRP is required.");

  if (!p.isManualPricing && p.defaultDiscountValue !== "") {
    const d = Number(p.defaultDiscountValue);
    if (!Number.isFinite(d) || d < 0) e.push("Default discount cannot be negative.");
    else if (p.defaultDiscountType === "PERCENTAGE" && d > 100)
      e.push("A percentage discount cannot exceed 100%.");
  }

  if (e.length === 0) {
    e.push(...validatePriceTriplet(productPricing(p), { requirePositiveSelling: true }));
  }

  const gst = p.gstRate;
  if (gst !== "") {
    const g = Number(gst);
    if (!Number.isFinite(g) || g < 0 || g > 100)
      e.push("GST must be between 0% and 100%.");
  }

  if (p.discountAllowed && p.maxDiscountPct !== "") {
    const d = Number(p.maxDiscountPct);
    if (!Number.isFinite(d) || d < 0 || d > 100)
      e.push("Maximum discount must be between 0% and 100%.");
  }
  if (!p.discountAllowed && p.maxDiscountPct !== "")
    e.push("Maximum discount is set but discounts are not allowed.");

  return e;
}

/**
 * Errors across every per-variant override. Also rejects "duplicate" overrides —
 * an override whose values are identical to the product pricing, which would
 * store a redundant copy of the same numbers and defeat inheritance.
 */
export function overrideErrors(s: WizardState): string[] {
  const e: string[] = [];
  const base = productPricing(s.pricing);

  for (const v of activeVariants(s)) {
    if (!v.priceOverride) continue;
    const label = `${v.colorName}/${v.sizeName} override`;
    e.push(...validatePriceTriplet(v.priceOverride, { requirePositiveSelling: true, label }));

    const o = v.priceOverride;
    if (
      o.costPrice === base.costPrice &&
      o.sellingPrice === base.sellingPrice &&
      o.mrp === base.mrp
    ) {
      e.push(
        `${label}: identical to the product pricing — remove the override so the variant inherits instead.`
      );
    }
  }
  return e;
}

// ─── Per-step errors (gate advancing) ─────────────────────────────────────────

export function stepErrors(step: WizardStepKey, s: WizardState): string[] {
  const e: string[] = [];
  switch (step) {
    case "basic":
      if (s.name.trim().length < 3) e.push("Product name must be at least 3 characters.");
      if (!s.categoryId) e.push("Select a category.");
      break;
    case "attributes":
      if (s.attributes.sizes.length === 0) e.push("Add at least one size.");
      if (s.attributes.colors.length === 0) e.push("Add at least one color.");
      break;
    case "pricing": {
      if (activeVariants(s).length === 0) {
        e.push("Generate at least one variant.");
        break;
      }
      // Pricing is the money gate: the product default AND every override must
      // satisfy the invariants before the owner can continue.
      e.push(...pricingErrors(s));
      e.push(...overrideErrors(s));
      break;
    }
    case "variants":
    case "details":
    case "inventory": {
      const vs = activeVariants(s);
      if (vs.length === 0) {
        e.push("Generate at least one variant.");
        break;
      }
      // Hard errors: duplicate SKU/barcode, invalid barcode, bad overrides.
      const skus = new Map<string, number>();
      const barcodes = new Map<string, number>();
      vs.forEach((v, i) => {
        if (!v.sku || v.sku.trim().length < 3)
          e.push(`Variant ${i + 1}: SKU must be at least 3 characters.`);
        const skuKey = v.sku.trim().toLowerCase();
        if (skuKey) {
          if (skus.has(skuKey)) e.push(`Duplicate SKU "${v.sku}".`);
          else skus.set(skuKey, i);
        }
        if (v.barcode) {
          const bKey = v.barcode.trim().toLowerCase();
          if (barcodes.has(bKey)) e.push(`Duplicate barcode "${v.barcode}".`);
          else barcodes.set(bKey, i);
          if (!isValidEan13(v.barcode.trim()))
            e.push(`Variant ${i + 1}: barcode is not a valid EAN-13.`);
        }
      });
      e.push(...overrideErrors(s));
      break;
    }
    default:
      break;
  }
  return e;
}

export function isStepValid(step: WizardStepKey, s: WizardState): boolean {
  return stepErrors(step, s).length === 0;
}

// ─── Aggregate issues (review panel) ──────────────────────────────────────────

export function collectIssues(s: WizardState): WizardIssue[] {
  const issues: WizardIssue[] = [];
  const vs = activeVariants(s);

  // Errors
  if (s.name.trim().length < 3)
    issues.push({ level: "error", message: "Product name is required (min 3 chars)." });
  if (!s.categoryId) issues.push({ level: "error", message: "Category is required." });
  if (vs.length === 0)
    issues.push({ level: "error", message: "At least one variant is required." });

  // Product-level pricing + every override, held to the same money invariants.
  if (vs.length > 0) {
    pricingErrors(s).forEach((message) => issues.push({ level: "error", message }));
    overrideErrors(s).forEach((message) => issues.push({ level: "error", message }));
  }

  const skus = new Set<string>();
  const barcodes = new Set<string>();
  vs.forEach((v) => {
    const sku = v.sku.trim().toLowerCase();
    if (sku && skus.has(sku))
      issues.push({ level: "error", message: `Duplicate SKU "${v.sku}".` });
    skus.add(sku);
    if (v.barcode) {
      const b = v.barcode.trim().toLowerCase();
      if (barcodes.has(b))
        issues.push({ level: "error", message: `Duplicate barcode "${v.barcode}".` });
      barcodes.add(b);
    }
  });

  // Warnings
  if (s.images.length === 0)
    issues.push({ level: "warning", message: "No images added — products sell better with photos." });

  // Duplicate images
  const imgUrls = s.images.map((im) => im.url);
  if (new Set(imgUrls).size !== imgUrls.length)
    issues.push({ level: "warning", message: "Duplicate images detected." });

  // Zero-margin is legal but worth surfacing (selling < cost is a hard error).
  vs.forEach((v, i) => {
    const { costPrice, sellingPrice } = effectivePricing(v, s.pricing);
    if (sellingPrice > 0 && sellingPrice === costPrice)
      issues.push({
        level: "warning",
        message: `Variant ${i + 1} (${v.sizeName}/${v.colorName}): sells at cost — zero margin.`,
      });
    if (v.openingStock <= 0)
      issues.push({
        level: "warning",
        message: `Variant ${i + 1} (${v.sizeName}/${v.colorName}): zero opening stock.`,
      });
    if (!v.supplierId)
      issues.push({
        level: "warning",
        message: `Variant ${i + 1} (${v.sizeName}/${v.colorName}): no supplier assigned.`,
      });
    if (!v.barcode)
      issues.push({
        level: "warning",
        message: `Variant ${i + 1} (${v.sizeName}/${v.colorName}): no barcode.`,
      });
  });

  return issues;
}

export function hasBlockingErrors(s: WizardState): boolean {
  return collectIssues(s).some((i) => i.level === "error");
}
