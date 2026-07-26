/**
 * Product Creation Wizard — client-side state model.
 *
 * This is the single source of truth for the wizard's draft. It maps 1:1 to the
 * backend's POST /owner/products/full payload after a light transform (see
 * buildCreatePayload in ./transform.ts). Size/Color are held as free strings so
 * the owner can type new ones; the backend resolves/creates the lookup rows.
 */

export type ProductStatus = "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";

export interface WizardImage {
  id: string; // client id for reorder/remove
  url: string;
  role?: "front" | "back" | "side" | "close-up" | "lifestyle";
}

/** A user-defined attribute whose values generate variants (size & color only). */
export interface AttributeValues {
  sizes: string[]; // e.g. ["S","M","L"]
  colors: { name: string; hex?: string }[]; // e.g. [{name:"Black",hex:"#000"}]
}

/** One generated (or manually added) variant row. */
export interface WizardVariant {
  id: string; // client id
  sizeName: string;
  colorName: string;
  colorHex?: string;

  sku: string;
  barcode: string;

  costPrice: number;
  sellingPrice: number;
  mrp: number;

  openingStock: number;
  reorderLevel: number;
  maximumStock: number | "";

  weight: number | "";
  lengthCm: number | "";
  widthCm: number | "";
  heightCm: number | "";

  warehouse: string;
  rack: string;
  shelf: string;
  bin: string;
  shelfLocation: string;

  discountAllowed: boolean;
  maxDiscountPct: number | "";

  supplierId: string;
  supplierSku: string;
  leadTimeDays: number | "";

  imageUrl: string;

  // UI-only
  removed?: boolean;
}

export interface WizardState {
  // Step 1
  name: string;
  description: string;
  categoryId: string;
  brandId: string;
  status: ProductStatus;
  gender: string;
  season: string;
  collectionName: string;
  fabricMaterial: string;
  sleeveType: string;
  neckType: string;
  fit: string;
  pattern: string;
  occasion: string;
  hsnCode: string;
  gstRate: number | "";
  searchKeywords: string;

  // Step 2
  images: WizardImage[];

  // Step 3
  attributes: AttributeValues;

  // Steps 4-8
  variants: WizardVariant[];

  // Defaults applied to newly generated variants (from pricing/inventory/supplier
  // steps, so the owner sets values once and they flow into all variants).
  defaults: {
    costPrice: number | "";
    sellingPrice: number | "";
    mrp: number | "";
    openingStock: number | "";
    reorderLevel: number | "";
    maximumStock: number | "";
    supplierId: string;
    gstRate: number | "";
    skuPrefix: string;
    barcodePrefix: string;
    warehouse: string;
  };
}

export const WIZARD_STEPS = [
  { key: "basic", label: "Basic Info" },
  { key: "images", label: "Images" },
  { key: "attributes", label: "Attributes" },
  { key: "variants", label: "Variants" },
  { key: "details", label: "Variant Details" },
  { key: "inventory", label: "Inventory" },
  { key: "supplier", label: "Supplier" },
  { key: "pricing", label: "Pricing" },
  { key: "review", label: "Review" },
] as const;

export type WizardStepKey = (typeof WIZARD_STEPS)[number]["key"];

export function initialWizardState(): WizardState {
  return {
    name: "",
    description: "",
    categoryId: "",
    brandId: "",
    status: "ACTIVE",
    gender: "",
    season: "",
    collectionName: "",
    fabricMaterial: "",
    sleeveType: "",
    neckType: "",
    fit: "",
    pattern: "",
    occasion: "",
    hsnCode: "",
    gstRate: "",
    searchKeywords: "",
    images: [],
    attributes: { sizes: [], colors: [] },
    variants: [],
    defaults: {
      costPrice: "",
      sellingPrice: "",
      mrp: "",
      openingStock: "",
      reorderLevel: "",
      maximumStock: "",
      supplierId: "",
      gstRate: "",
      skuPrefix: "",
      barcodePrefix: "",
      warehouse: "",
    },
  };
}
