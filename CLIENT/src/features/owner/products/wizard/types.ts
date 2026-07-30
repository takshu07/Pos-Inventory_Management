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

/**
 * Per-variant price override. Pricing is a PRODUCT-level concern (state.pricing);
 * a variant only carries this object when the owner has explicitly overridden it
 * (e.g. Black/XXL costs more than Black/XL). `null` — the normal case — means the
 * variant inherits the product pricing, so identical values are never duplicated
 * across rows. Always read prices through effectivePricing() in ./helpers.
 */
export interface VariantPriceOverride {
  costPrice: number;
  sellingPrice: number;
  mrp: number;
}

/** One generated (or manually added) variant row. */
export interface WizardVariant {
  id: string; // client id
  sizeName: string;
  colorName: string;
  colorHex?: string;

  sku: string;
  barcode: string;

  /** null → inherits product pricing. Set only by the Override Pricing dialog. */
  priceOverride: VariantPriceOverride | null;

  /** Per-variant sellability, independent of the parent product's status. */
  status: "ACTIVE" | "INACTIVE";

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
  searchKeywords: string;

  // Step 2
  images: WizardImage[];

  // Step 3
  attributes: AttributeValues;

  // Steps 4-8
  variants: WizardVariant[];

  /**
   * THE single source of truth for pricing in the entire wizard. Collected once
   * in the Pricing step; every variant inherits these values automatically. A
   * variant deviates only via its own `priceOverride`. No other part of the
   * wizard may collect or store cost/selling/MRP/GST.
   *
   * `sellingPrice` is DERIVED, not typed: the pricing engine defines it as
   * (mrp − defaultDiscount), and the wizard mirrors that arithmetic so the
   * preview matches what the server will store. The owner may instead type a
   * price directly by flipping `isManualPricing`, in which case the discount is
   * back-solved from it — the two never drift apart. Read it through
   * `derivedSellingPrice()`, never straight off this object.
   */
  pricing: {
    costPrice: number | "";
    sellingPrice: number | "";
    mrp: number | "";
    gstRate: number | "";
    discountAllowed: boolean;
    maxDiscountPct: number | "";

    /** The product-level default discount off MRP — the engine's DEFAULT tier. */
    defaultDiscountType: "PERCENTAGE" | "FLAT";
    defaultDiscountValue: number | "";
    /** true → owner types sellingPrice and the discount is back-solved. */
    isManualPricing: boolean;
  };

  // Non-pricing defaults applied to newly generated variants (inventory/supplier
  // steps, so the owner sets values once and they flow into all variants).
  defaults: {
    openingStock: number | "";
    reorderLevel: number | "";
    maximumStock: number | "";
    supplierId: string;
    skuPrefix: string;
    barcodePrefix: string;
    warehouse: string;
  };
}

/**
 * Step order is deliberate: variants are generated BEFORE pricing so the Pricing
 * step can show real inventory/retail/profit projections across the generated
 * set, and Variant Details comes after pricing so it is purely an inventory/SKU
 * screen with no money inputs.
 */
export const WIZARD_STEPS = [
  { key: "basic", label: "Basic Info" },
  { key: "images", label: "Images" },
  { key: "attributes", label: "Attributes" },
  { key: "variants", label: "Variants" },
  { key: "pricing", label: "Pricing" },
  { key: "inventory", label: "Inventory" },
  { key: "supplier", label: "Supplier" },
  { key: "details", label: "Variant Details" },
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
    searchKeywords: "",
    images: [],
    attributes: { sizes: [], colors: [] },
    variants: [],
    pricing: {
      costPrice: "",
      sellingPrice: "",
      mrp: "",
      gstRate: "",
      discountAllowed: true,
      maxDiscountPct: "",
      defaultDiscountType: "PERCENTAGE",
      defaultDiscountValue: "",
      isManualPricing: false,
    },
    defaults: {
      openingStock: "",
      reorderLevel: "",
      maximumStock: "",
      supplierId: "",
      skuPrefix: "",
      barcodePrefix: "",
      warehouse: "",
    },
  };
}
