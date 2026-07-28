// =============================================================================
// BARCODE ENGINE — TYPES
//
// The Barcode Engine NEVER stores or returns raster images. It returns the
// encoded *geometry* (a run-length module pattern). Every consumer renders that
// geometry in its own native form:
//
//   Preview  → SVG <rect> elements
//   PDF      → pdfkit .rect() fills
//   Thermal  → the printer's own barcode command, or a bitmap it rasterises
//
// Keeping the engine at the geometry level is what lets one encoder feed three
// very different outputs with zero duplicated layout logic, and is why a label
// stored in history always re-renders from live product data.
// =============================================================================

import type { BarcodeSymbology } from "../../../../generated/prisma";

/**
 * A single encoded barcode ready for rendering.
 *
 * `modules` is the canonical output: a string of "1" (bar) and "0" (space)
 * where each character is one module wide. Renderers scale it to physical size
 * by multiplying by a module width — this is what keeps a barcode crisp at any
 * DPI instead of being resampled from a stored PNG.
 */
export interface EncodedBarcode {
  symbology: BarcodeSymbology;
  /** The value actually encoded — may differ from input (EAN-13 adds a check digit). */
  value: string;
  /** Human-readable text printed under the bars. */
  text: string;
  /** Module pattern: "1" = bar, "0" = space. Empty for 2D symbologies. */
  modules: string;
  /** Number of modules across — renderers divide available width by this. */
  moduleCount: number;
  /**
   * For 2D symbologies (QR, DataMatrix) the pattern is a square matrix rather
   * than a linear run. Null for all 1D symbologies.
   */
  matrix?: boolean[][] | null;
  /** Quiet-zone width in modules required either side of the symbol. */
  quietZoneModules: number;
}

/** Options accepted by every encoder. Encoders ignore what they do not use. */
export interface BarcodeEncodeOptions {
  /**
   * When true, an invalid value throws. When false the engine returns null and
   * the caller renders a placeholder — used by batch printing so one bad
   * barcode never aborts a 500-label job.
   */
  strict?: boolean;
}

/**
 * The contract every symbology implementation satisfies. Registering a new
 * standard (QR, DataMatrix, RFID EPC) means adding one object that implements
 * this — no existing file changes. That is the "future barcode standards"
 * requirement expressed in code.
 */
export interface SymbologyEncoder {
  symbology: BarcodeSymbology;
  /** Human label for the settings UI. */
  displayName: string;
  /** True for matrix codes — drives renderer branch selection. */
  isTwoDimensional: boolean;
  /** Validates without throwing, so the UI can warn before a job is queued. */
  validate(value: string): { valid: boolean; reason?: string };
  /** Produces render-ready geometry. Throws only on invalid input. */
  encode(value: string, options?: BarcodeEncodeOptions): EncodedBarcode;
}
