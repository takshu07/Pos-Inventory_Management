// =============================================================================
// BARCODE ENGINE
//
// The single entry point for turning a barcode VALUE into render-ready
// geometry. Nothing else in the application constructs a barcode.
//
// Two rules from the spec are enforced structurally here:
//   1. "Never store barcode images"  — this module has no filesystem or DB
//      access at all. It cannot persist anything even by accident.
//   2. "Barcode rendering must be reusable" — the registry is keyed by the
//      BarcodeSymbology enum, so adding a standard is a map entry, never a
//      change to a caller.
// =============================================================================

import { BarcodeSymbology } from "../../../../generated/prisma";
import type { EncodedBarcode, SymbologyEncoder } from "./barcode.types";
import {
  code128Encoder,
  code39Encoder,
  dataMatrixEncoder,
  ean13Encoder,
  itf14Encoder,
  noneEncoder,
  qrEncoder,
  upcEncoder,
} from "./encoders";

// ─── Registry ─────────────────────────────────────────────────────────────────
// Adding a future symbology = one line here. No existing code is modified,
// which is the open/closed requirement stated in the brief.

const REGISTRY: Record<BarcodeSymbology, SymbologyEncoder> = {
  [BarcodeSymbology.EAN13]: ean13Encoder,
  [BarcodeSymbology.UPC]: upcEncoder,
  [BarcodeSymbology.CODE128]: code128Encoder,
  [BarcodeSymbology.CODE39]: code39Encoder,
  [BarcodeSymbology.ITF14]: itf14Encoder,
  [BarcodeSymbology.QR]: qrEncoder,
  [BarcodeSymbology.DATA_MATRIX]: dataMatrixEncoder,
  [BarcodeSymbology.NONE]: noneEncoder,
};

/** Returns the encoder for a symbology. Throws only on an unregistered enum. */
export function getEncoder(symbology: BarcodeSymbology): SymbologyEncoder {
  const encoder = REGISTRY[symbology];
  if (!encoder) {
    throw new Error(`No barcode encoder registered for symbology "${symbology}".`);
  }
  return encoder;
}

/** Lists every registered symbology for the settings/template pickers. */
export function listSymbologies(): Array<{
  symbology: BarcodeSymbology;
  displayName: string;
  isTwoDimensional: boolean;
  /** False for declared-but-unimplemented standards (QR/DataMatrix today). */
  isImplemented: boolean;
}> {
  return Object.values(REGISTRY).map((encoder) => ({
    symbology: encoder.symbology,
    displayName: encoder.displayName,
    isTwoDimensional: encoder.isTwoDimensional,
    isImplemented: encoder.validate("TEST123").valid || encoder.symbology === BarcodeSymbology.EAN13,
  }));
}

/**
 * Validates a value against a symbology WITHOUT throwing.
 *
 * Used before a job is queued so the user gets "SKU-1 is not a valid EAN-13"
 * in the print dialog rather than a failed job an hour later.
 */
export function validate(
  symbology: BarcodeSymbology,
  value: string
): { valid: boolean; reason?: string } {
  return getEncoder(symbology).validate(value);
}

/**
 * Encodes a value into render-ready geometry.
 *
 * @throws when the value is invalid for the symbology — callers that must not
 *         fail (batch printing) should use {@link tryEncode} instead.
 */
export function encode(
  symbology: BarcodeSymbology,
  value: string
): EncodedBarcode {
  return getEncoder(symbology).encode(value);
}

/**
 * Non-throwing encode for bulk paths.
 *
 * A 500-label batch must not abort because one variant has a malformed
 * barcode: that item is marked FAILED with a reason and the rest still print.
 * Returns null instead of throwing so the caller decides the policy.
 */
export function tryEncode(
  symbology: BarcodeSymbology,
  value: string | null | undefined
): { barcode: EncodedBarcode | null; error: string | null } {
  if (!value) {
    return { barcode: null, error: "No barcode value on this variant." };
  }
  try {
    return { barcode: getEncoder(symbology).encode(value), error: null };
  } catch (err) {
    return {
      barcode: null,
      error: err instanceof Error ? err.message : "Barcode encoding failed.",
    };
  }
}

/**
 * Chooses the best symbology for a value when a template says "auto".
 *
 * Real-world catalogs mix EAN-13 barcodes (retail GTINs) with internal SKUs
 * that are not numeric at all. Forcing one symbology would make half the
 * catalog unprintable, so we pick per value: 12–13 digits → EAN-13,
 * anything else → Code 128 (which encodes the full ASCII range).
 */
export function resolveSymbologyForValue(
  value: string,
  preferred: BarcodeSymbology
): BarcodeSymbology {
  if (preferred !== BarcodeSymbology.EAN13) return preferred;

  const digitsOnly = /^\d+$/.test(value);
  if (digitsOnly && (value.length === 12 || value.length === 13)) {
    return BarcodeSymbology.EAN13;
  }
  // Preferred was EAN-13 but the value cannot be one — fall back rather than
  // emit an unscannable label.
  return BarcodeSymbology.CODE128;
}

export const barcodeEngine = {
  encode,
  tryEncode,
  validate,
  getEncoder,
  listSymbologies,
  resolveSymbologyForValue,
} as const;
