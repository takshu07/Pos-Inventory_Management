// =============================================================================
// LABEL ENGINE — CORE TYPES
//
// These types are the contract between every part of the engine:
//
//   LabelData     what CAN be printed (resolved once from ProductVariant)
//   LabelElement  what a template CHOOSES to print, and where
//   LabelDocument the fully-resolved, render-ready result
//
// The separation matters: LabelData is produced by the data resolver from live
// product/pricing data, LabelElement comes from the template row, and the
// renderers (SVG / PDF / thermal) consume LabelDocument. No renderer ever
// touches Prisma, and no template ever hardcodes a field — which is exactly
// what "the template decides which fields appear" requires.
// =============================================================================

import type { BarcodeSymbology } from "../../../generated/prisma";

// ─── Label data ───────────────────────────────────────────────────────────────

/**
 * Every field the engine can print, resolved from a ProductVariant plus store
 * settings. A template picks a subset; unused fields cost nothing.
 *
 * Prices are `number` (already converted from Prisma Decimal) because renderers
 * do arithmetic on them for discount computation. Conversion happens once, in
 * the resolver, so no renderer deals with Decimal.
 */
export interface LabelData {
  // Identity
  variantId: string;
  productId: string;

  // Store / branding
  storeName: string;
  storeLogoUrl: string | null;

  // Classification
  brand: string | null;
  category: string | null;

  // Product
  productName: string;
  variantName: string; // e.g. "Black / L" — composed by the resolver
  size: string | null;
  color: string | null;

  // Codes
  sku: string;
  barcode: string | null;
  /** Symbology chosen for THIS value (may differ from the template default). */
  barcodeSymbology: BarcodeSymbology;

  // Money
  mrp: number;
  sellingPrice: number;
  /** Absolute currency amount saved (mrp − sellingPrice), never negative. */
  discountAmount: number;
  /** Percentage off MRP, rounded to a whole number for display. */
  discountPercent: number;
  currency: string;
  currencySymbol: string;

  // Traceability
  batchNumber: string | null;
  manufacturingDate: Date | null;
  expiryDate: Date | null;

  // Storage (warehouse labels)
  warehouse: string | null;
  rack: string | null;
  shelf: string | null;
  bin: string | null;
  shelfLocation: string | null;

  // Stock (shelf/warehouse labels)
  currentStock: number;

  // Compliance
  hsnCode: string | null;
  gstRate: number | null;

  /** Future: QR/RFID payload. Present in the contract so adding them is data-only. */
  qrValue: string | null;
  rfidTag: string | null;

  /** When the label was generated — some formats print this for traceability. */
  printedAt: Date;
}

/** Field keys a template element may bind to. Compile-time safe binding. */
export type LabelFieldKey = keyof Pick<
  LabelData,
  | "storeName"
  | "brand"
  | "category"
  | "productName"
  | "variantName"
  | "size"
  | "color"
  | "sku"
  | "barcode"
  | "mrp"
  | "sellingPrice"
  | "discountAmount"
  | "discountPercent"
  | "batchNumber"
  | "manufacturingDate"
  | "expiryDate"
  | "warehouse"
  | "rack"
  | "shelf"
  | "bin"
  | "shelfLocation"
  | "currentStock"
  | "hsnCode"
  | "gstRate"
  | "qrValue"
  | "rfidTag"
>;

// ─── Template elements ────────────────────────────────────────────────────────

export type LabelElementType =
  | "text"      // static or field-bound text
  | "barcode"   // 1D/2D symbol
  | "price"     // currency-formatted, supports strike-through MRP
  | "image"     // store logo
  | "line"      // horizontal rule
  | "box"       // rectangle / border
  | "qr";       // future 2D — routed, not yet rendered

export type LabelTextAlign = "left" | "center" | "right";

/**
 * One drawable element positioned in MILLIMETRES relative to the label's
 * content box (i.e. after margins).
 *
 * Millimetres — not pixels — because a label is a physical object. The same
 * template must produce identical output on a 203-dpi thermal head and in a
 * PDF; only a physical unit makes that possible.
 */
/**
 * NOTE ON OPTIONALITY: every optional property below is written as
 * `?: T | undefined` rather than just `?: T`. Template elements arrive from a
 * Zod-parsed request body (and from the `elements` JSON column), where an
 * absent key materialises as `undefined`. The project compiles with
 * exactOptionalPropertyTypes, under which `?: T` rejects an explicit
 * `undefined` — so the explicit union is what lets a parsed element be used
 * directly instead of rebuilt field by field at every boundary.
 */
export interface LabelElement {
  id: string;
  type: LabelElementType;

  // Geometry (mm)
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;

  /** Bound data field. Omit for static text / decorative elements. */
  field?: LabelFieldKey | undefined;
  /** Literal text. When `field` is also set, this acts as a prefix label. */
  text?: string | undefined;

  // Typography
  fontSize?: number | undefined;      // points
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  align?: LabelTextAlign | undefined;
  /** Max lines before truncation with an ellipsis. Defaults to 1. */
  maxLines?: number | undefined;
  letterSpacing?: number | undefined;

  // Barcode-specific
  symbology?: BarcodeSymbology | undefined;
  /** Print the human-readable value beneath the bars. */
  showBarcodeText?: boolean | undefined;

  // Price-specific
  /** Renders a strike-through — used to show MRP next to a sale price. */
  strikeThrough?: boolean | undefined;
  /** Prefix with the currency symbol. */
  showCurrency?: boolean | undefined;

  // Decorative
  /** Stroke/fill weight in mm for line and box elements. */
  thickness?: number | undefined;
  filled?: boolean | undefined;

  /**
   * Hide this element when its bound field is null/empty, instead of leaving a
   * gap. Lets one template serve products with and without, say, a batch number.
   */
  hideWhenEmpty?: boolean | undefined;
}

/** Margins in millimetres. */
export interface LabelMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * A template resolved into plain geometry, independent of its DB row. The
 * renderers accept this so they work equally for a stored template, a built-in
 * registry template, or an ad-hoc preview that was never saved.
 */
export interface ResolvedTemplate {
  id: string;
  code: string;
  name: string;
  kind: string;
  widthMm: number;
  heightMm: number;
  margins: LabelMargins;
  elements: LabelElement[];
  barcodeSymbology: BarcodeSymbology;
  rotation: number;
}

// ─── Render-ready document ────────────────────────────────────────────────────

/**
 * The final input to every renderer: one template + one label's data, already
 * validated. Produced by the Template Engine, consumed by SVG/PDF/thermal.
 */
export interface LabelDocument {
  template: ResolvedTemplate;
  data: LabelData;
  /** Non-fatal problems (e.g. barcode invalid) surfaced to the UI as warnings. */
  warnings: string[];
}

/** Options that alter HOW a document is rendered, not WHAT it contains. */
export interface RenderOptions {
  /** Preview zoom / PDF scaling. 1 = actual physical size. */
  scale?: number;
  /** Draw a dashed outline showing the physical label edge (preview only). */
  showBoundary?: boolean;
  /** Copies per label — the PDF renderer repeats pages. */
  copies?: number;
  /** Target device resolution; affects barcode module snapping. */
  dpi?: number;
}
