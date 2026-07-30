/**
 * Transforms the wizard's client state into the backend's
 * POST /owner/products/full payload. Drops UI-only fields, converts ""→null for
 * optional numerics, and omits removed variants.
 *
 * This is also the single place where pricing inheritance is RESOLVED. The wizard
 * stores pricing once (state.pricing) plus sparse per-variant overrides; the API
 * contract requires absolute costPrice/sellingPrice/mrp on each variant, so each
 * one is flattened here via effectivePricing (override if present, otherwise the
 * product default). Resolution lives at this boundary only — no other code
 * duplicates prices onto variants.
 */

import { backSolveDiscount, effectivePricing, type EffectivePricing } from "./helpers";
import type { WizardState } from "./types";

/**
 * The (type, value) discount that yields this variant's selling price.
 *
 * Inheriting variants carry the product-level default verbatim. An overridden
 * variant's price bears no relation to that default, so its discount is
 * back-solved to an exact FLAT rupee difference — the same thing the server's
 * engine would do, and immune to the rounding drift a derived percentage
 * reintroduces.
 */
function discountFor(
  price: EffectivePricing,
  pricing: WizardState["pricing"]
): { discountType: "PERCENTAGE" | "FLAT"; discountValue: number } {
  if (price.isOverride || pricing.isManualPricing) {
    return {
      discountType: "FLAT",
      discountValue: backSolveDiscount(price.mrp, price.sellingPrice),
    };
  }
  return {
    discountType: pricing.defaultDiscountType,
    discountValue: pricing.defaultDiscountValue === "" ? 0 : Number(pricing.defaultDiscountValue),
  };
}

const n = (v: number | "" | undefined): number | null =>
  v === "" || v == null ? null : Number(v);

const s = (v: string | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

export function buildCreatePayload(state: WizardState) {
  return {
    name: state.name.trim(),
    description: s(state.description),
    categoryId: state.categoryId,
    brandId: state.brandId || null,
    status: state.status,
    gender: s(state.gender),
    season: s(state.season),
    collectionName: s(state.collectionName),
    fabricMaterial: s(state.fabricMaterial),
    sleeveType: s(state.sleeveType),
    neckType: s(state.neckType),
    fit: s(state.fit),
    pattern: s(state.pattern),
    occasion: s(state.occasion),
    hsnCode: s(state.hsnCode),
    gstRate: n(state.pricing.gstRate),
    searchKeywords: s(state.searchKeywords),
    imageUrls: state.images.map((img) => img.url),
    variants: state.variants
      .filter((v) => !v.removed)
      .map((v) => {
        const price = effectivePricing(v, state.pricing);
        return {
        sizeName: v.sizeName.trim(),
        colorName: v.colorName.trim(),
        colorHex: s(v.colorHex),
        sku: v.sku.trim(),
        barcode: s(v.barcode),
        isActive: v.status === "ACTIVE",
        costPrice: price.costPrice,
        sellingPrice: price.sellingPrice,
        mrp: price.mrp,
        // The discount that PRODUCES sellingPrice. The server records this and
        // lets the pricing engine write the sellingPrice column, so the stored
        // price is always the engine's own output rather than a client figure.
        // An overridden variant carries its own back-solved FLAT discount; the
        // rest inherit the product-level default.
        ...discountFor(price, state.pricing),
        openingStock: Number(v.openingStock) || 0,
        reorderLevel: Number(v.reorderLevel) || 0,
        maximumStock: n(v.maximumStock),
        weight: n(v.weight),
        lengthCm: n(v.lengthCm),
        widthCm: n(v.widthCm),
        heightCm: n(v.heightCm),
        warehouse: s(v.warehouse),
        rack: s(v.rack),
        shelf: s(v.shelf),
        bin: s(v.bin),
        shelfLocation: s(v.shelfLocation),
        // Discount policy is product-level; every variant carries the same rule.
        discountAllowed: state.pricing.discountAllowed,
        maxDiscountPct: state.pricing.discountAllowed
          ? n(state.pricing.maxDiscountPct)
          : null,
        supplierId: v.supplierId || null,
        supplierSku: s(v.supplierSku),
        leadTimeDays: n(v.leadTimeDays),
        imageUrl: s(v.imageUrl),
        };
      }),
  };
}

export type CreateFullPayload = ReturnType<typeof buildCreatePayload>;
