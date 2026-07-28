// =============================================================================
// BARCODE ENGINE — SYMBOLOGY ENCODERS
//
// Thin adapters over jsbarcode's barcode classes. We deliberately do NOT use
// jsbarcode's top-level JsBarcode() entry point: it expects a DOM element and
// renders SVG/canvas. On the server there is no DOM, and we do not want an
// image anyway — we want the module pattern so each renderer can draw natively.
//
// The internal barcode classes give us exactly that: `new EAN13(value, {})
// .encode()` returns `{ data: "1010001...", text: "5901234123457" }` with no
// DOM involvement. This is verified behaviour, not an assumption.
//
// NOTE on the import shape: `barcodes.CODE128B` is itself a constructor
// function. Writing `barcodes.CODE128.CODE128B` yields undefined — a subtle
// trap that silently breaks Code 128. Always index the top-level object.
// =============================================================================

import { createRequire } from "node:module";

import { BarcodeSymbology } from "../../../../generated/prisma";
import type {
  BarcodeEncodeOptions,
  EncodedBarcode,
  SymbologyEncoder,
} from "./barcode.types";

// jsbarcode ships CommonJS without type declarations for its internal barcode
// classes. createRequire keeps this working under both CJS and ESM resolution
// without adding a @types shim for a path the library does not publicly type.
const require_ = createRequire(import.meta.url);

interface JsBarcodeEncoding {
  data: string;
  text?: string;
}

interface JsBarcodeInstance {
  encode(): JsBarcodeEncoding | JsBarcodeEncoding[];
  valid(): boolean;
  /**
   * The complete human-readable value, with any check digit already appended.
   * Authoritative — see the note on flatten() for why segment text is not.
   */
  text?: string;
}

type JsBarcodeCtor = new (
  value: string,
  options: Record<string, unknown>
) => JsBarcodeInstance;

const barcodeClasses: Record<string, JsBarcodeCtor> = (() => {
  const mod = require_("jsbarcode/bin/barcodes/index.js");
  return (mod.default ?? mod) as Record<string, JsBarcodeCtor>;
})();

/**
 * Flattens jsbarcode's output into one module string plus display text, so
 * downstream renderers never branch on symbology internals.
 *
 * IMPORTANT — why `instance.text` wins over segment text:
 * EAN/UPC encode as an ARRAY of segments (start guard, left half, centre guard,
 * right half, end guard). The guard segments carry no text, and the leading
 * digit of an EAN-13 is not drawn as its own segment at all — it is encoded in
 * the PARITY pattern of the left half. Concatenating segment text therefore
 * yields a value missing its first digit ("901234123457" for "5901234123457"),
 * which would print a human-readable number that disagrees with the bars.
 *
 * The instance exposes the complete, check-digit-corrected value on `.text`,
 * so we take that whenever present and fall back to segment concatenation only
 * for symbologies that do not set it.
 */
function flatten(
  instance: JsBarcodeInstance,
  encoded: JsBarcodeEncoding | JsBarcodeEncoding[]
): { modules: string; text: string } {
  const modules = Array.isArray(encoded)
    ? encoded.map((segment) => segment.data).join("")
    : encoded.data;

  const segmentText = Array.isArray(encoded)
    ? encoded.map((segment) => segment.text ?? "").join("")
    : (encoded.text ?? "");

  return { modules, text: instance.text ?? segmentText };
}

/**
 * Builds a SymbologyEncoder from a jsbarcode class.
 *
 * @param symbology      The Prisma enum member this encoder serves.
 * @param className      Key into jsbarcode's barcode class map.
 * @param displayName    Label shown in the settings/template UI.
 * @param quietZone      Required quiet zone in modules (spec-defined per symbology).
 * @param normalise      Optional input cleanup applied before encoding.
 */
function makeEncoder(
  symbology: BarcodeSymbology,
  className: string,
  displayName: string,
  quietZone: number,
  normalise?: (value: string) => string
): SymbologyEncoder {
  const Ctor = barcodeClasses[className];

  return {
    symbology,
    displayName,
    isTwoDimensional: false,

    validate(value: string) {
      if (!Ctor) {
        return { valid: false, reason: `Encoder "${className}" is unavailable.` };
      }
      const input = normalise ? normalise(value) : value;
      if (!input) return { valid: false, reason: "Barcode value is empty." };
      try {
        const ok = new Ctor(input, {}).valid();
        return ok
          ? { valid: true }
          : { valid: false, reason: `"${value}" is not a valid ${displayName} value.` };
      } catch (err) {
        return {
          valid: false,
          reason: err instanceof Error ? err.message : "Barcode encoding failed.",
        };
      }
    },

    encode(value: string, options?: BarcodeEncodeOptions): EncodedBarcode {
      if (!Ctor) {
        throw new Error(`Barcode encoder "${className}" is unavailable.`);
      }
      const input = normalise ? normalise(value) : value;
      const instance = new Ctor(input, {});

      // valid() must be consulted before encode(): jsbarcode's encode() on an
      // invalid value can return a malformed pattern rather than throwing,
      // which would print a barcode no scanner can read — worse than failing.
      if (!instance.valid()) {
        throw new Error(`"${value}" is not a valid ${displayName} value.`);
      }

      const { modules, text } = flatten(instance, instance.encode());
      void options;

      return {
        symbology,
        // `text` is the authoritative encoded value (EAN-13 appends its check
        // digit here), so it — not the raw input — is what was actually
        // encoded. Callers persist this so a reprint reproduces the same code.
        value: text || input,
        text: text || input,
        modules,
        moduleCount: modules.length,
        matrix: null,
        quietZoneModules: quietZone,
      };
    },
  };
}

// ── 1D symbologies ────────────────────────────────────────────────────────────
// Quiet zones follow each symbology's specification: EAN/UPC require 9–11
// modules, Code 128 and Code 39 require 10. Getting these wrong is the single
// most common cause of "the printed label will not scan".

export const ean13Encoder = makeEncoder(
  BarcodeSymbology.EAN13,
  "EAN13",
  "EAN-13",
  11,
  // EAN-13 accepts either 12 digits (it computes the 13th check digit itself)
  // or a full 13-digit code. Strip non-digits so a value pasted with spaces or
  // dashes still works.
  //
  // Only truncate when the input is LONGER than 13: slicing a 12-digit value to
  // 13 is a no-op, but blindly slicing after the library appends its check
  // digit would drop the leading digit and silently produce a barcode for a
  // different product. Length is otherwise left alone so jsbarcode's own
  // validation decides what is acceptable.
  (value) => {
    const digits = value.replace(/\D/g, "");
    return digits.length > 13 ? digits.slice(0, 13) : digits;
  }
);

export const upcEncoder = makeEncoder(
  BarcodeSymbology.UPC,
  "UPC",
  "UPC-A",
  9,
  (value) => value.replace(/\D/g, "").slice(0, 12)
);

export const code128Encoder = makeEncoder(
  BarcodeSymbology.CODE128,
  // CODE128 (auto) picks the optimal subset per run, which yields the shortest
  // symbol for mixed SKU strings like "BG-TSH-BLK-L-0001".
  "CODE128",
  "Code 128",
  10
);

export const code39Encoder = makeEncoder(
  BarcodeSymbology.CODE39,
  "CODE39",
  "Code 39",
  10,
  // Code 39's standard charset is uppercase only; lowercase silently fails to
  // encode on many scanners, so normalise rather than reject.
  (value) => value.toUpperCase()
);

export const itf14Encoder = makeEncoder(
  BarcodeSymbology.ITF14,
  "ITF14",
  "ITF-14",
  10,
  (value) => value.replace(/\D/g, "").slice(0, 14)
);

// ── 2D symbologies (future) ───────────────────────────────────────────────────
// QR and DataMatrix are declared in the schema and surfaced in the UI, but no
// matrix encoder is bundled yet. They fail loudly with an actionable message
// rather than silently printing a blank label. Implementing them means
// replacing ONLY this object — the registry, templates, renderers, drivers and
// UI already route 2D codes correctly via `isTwoDimensional`.

function makeUnimplemented2D(
  symbology: BarcodeSymbology,
  displayName: string
): SymbologyEncoder {
  const reason =
    `${displayName} is not implemented yet. The Label Engine is wired for 2D ` +
    `symbologies end-to-end — add a matrix encoder here to enable it.`;

  return {
    symbology,
    displayName,
    isTwoDimensional: true,
    validate: () => ({ valid: false, reason }),
    encode(): EncodedBarcode {
      throw new Error(reason);
    },
  };
}

export const qrEncoder = makeUnimplemented2D(BarcodeSymbology.QR, "QR Code");
export const dataMatrixEncoder = makeUnimplemented2D(
  BarcodeSymbology.DATA_MATRIX,
  "DataMatrix"
);

/**
 * NONE is a first-class symbology, not an error case: price tags, shelf labels
 * and sale tags legitimately carry no barcode. Returning an empty encoding lets
 * renderers skip the element without every caller null-checking.
 */
export const noneEncoder: SymbologyEncoder = {
  symbology: BarcodeSymbology.NONE,
  displayName: "No Barcode",
  isTwoDimensional: false,
  validate: () => ({ valid: true }),
  encode: (value: string): EncodedBarcode => ({
    symbology: BarcodeSymbology.NONE,
    value,
    text: "",
    modules: "",
    moduleCount: 0,
    matrix: null,
    quietZoneModules: 0,
  }),
};
