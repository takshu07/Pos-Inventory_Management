/**
 * Wizard validation. Two tiers:
 *   • errors   — block progression / submission (hard rules from the spec)
 *   • warnings — surfaced in the ValidationPanel but never block (e.g. selling <
 *                cost, zero stock, missing images/supplier)
 * Per-step error maps drive the "can I advance?" gate; the review step shows the
 * full aggregate.
 */

import { isValidEan13 } from "./helpers";
import type { WizardState, WizardStepKey, WizardVariant } from "./types";

export interface WizardIssue {
  level: "error" | "warning";
  message: string;
}

const activeVariants = (s: WizardState): WizardVariant[] =>
  s.variants.filter((v) => !v.removed);

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
    case "variants":
    case "details":
    case "pricing":
    case "inventory": {
      const vs = activeVariants(s);
      if (vs.length === 0) {
        e.push("Generate at least one variant.");
        break;
      }
      // Hard errors: negative prices, duplicate SKU/barcode, invalid barcode.
      const skus = new Map<string, number>();
      const barcodes = new Map<string, number>();
      vs.forEach((v, i) => {
        if (!v.sku || v.sku.trim().length < 3)
          e.push(`Variant ${i + 1}: SKU must be at least 3 characters.`);
        if (v.costPrice < 0 || v.sellingPrice < 0 || v.mrp < 0)
          e.push(`Variant ${i + 1}: prices cannot be negative.`);
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

  const skus = new Set<string>();
  const barcodes = new Set<string>();
  vs.forEach((v, i) => {
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
    if (v.costPrice < 0 || v.sellingPrice < 0 || v.mrp < 0)
      issues.push({ level: "error", message: `Variant ${i + 1}: negative price.` });
  });

  // Warnings
  if (s.images.length === 0)
    issues.push({ level: "warning", message: "No images added — products sell better with photos." });

  // Duplicate images
  const imgUrls = s.images.map((im) => im.url);
  if (new Set(imgUrls).size !== imgUrls.length)
    issues.push({ level: "warning", message: "Duplicate images detected." });

  vs.forEach((v, i) => {
    if (v.sellingPrice < v.costPrice)
      issues.push({
        level: "warning",
        message: `Variant ${i + 1} (${v.sizeName}/${v.colorName}): selling price is below cost.`,
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
