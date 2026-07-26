/**
 * Transforms the wizard's client state into the backend's
 * POST /owner/products/full payload. Drops UI-only fields, converts ""→null for
 * optional numerics, and omits removed variants.
 */

import type { WizardState } from "./types";

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
    gstRate: n(state.gstRate),
    searchKeywords: s(state.searchKeywords),
    imageUrls: state.images.map((img) => img.url),
    variants: state.variants
      .filter((v) => !v.removed)
      .map((v) => ({
        sizeName: v.sizeName.trim(),
        colorName: v.colorName.trim(),
        colorHex: s(v.colorHex),
        sku: v.sku.trim(),
        barcode: s(v.barcode),
        costPrice: Number(v.costPrice) || 0,
        sellingPrice: Number(v.sellingPrice) || 0,
        mrp: Number(v.mrp) || 0,
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
        discountAllowed: v.discountAllowed,
        maxDiscountPct: n(v.maxDiscountPct),
        supplierId: v.supplierId || null,
        supplierSku: s(v.supplierSku),
        leadTimeDays: n(v.leadTimeDays),
        imageUrl: s(v.imageUrl),
      })),
  };
}

export type CreateFullPayload = ReturnType<typeof buildCreatePayload>;
