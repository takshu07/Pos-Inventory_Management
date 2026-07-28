// =============================================================================
// TEMPLATE ENGINE
//
// Turns a stored LabelTemplate row (or a built-in registry entry) into a
// ResolvedTemplate, and resolves each element's bound field against LabelData
// into a flat list of drawable primitives.
//
// This is the layer that guarantees "PDF and thermal never maintain separate
// layouts": both call resolveDocument()/layoutElements() and receive the same
// geometry. A renderer's only job is to translate primitives into its own
// output format — it makes no layout decisions of its own.
// =============================================================================

import type { LabelTemplate } from "../../../../generated/prisma";
import { BarcodeSymbology } from "../../../../generated/prisma";
import { barcodeEngine } from "../barcode/barcode.engine";
import type { EncodedBarcode } from "../barcode/barcode.types";
import type {
  LabelData,
  LabelDocument,
  LabelElement,
  LabelFieldKey,
  LabelTextAlign,
  ResolvedTemplate,
} from "../label.types";
import { BUILTIN_TEMPLATES, type BuiltinTemplate } from "./builtinTemplates";

// ─── Template resolution ──────────────────────────────────────────────────────

/** Prisma Decimal | number | string → number, without importing Decimal here. */
function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Normalises the `elements` JSON column into typed LabelElements.
 *
 * The column is Json so new element types need no migration; the cost is that
 * it must be defensively parsed. A malformed element is DROPPED rather than
 * throwing — one bad element must never make an entire template unprintable.
 */
export function parseElements(raw: unknown): LabelElement[] {
  if (!Array.isArray(raw)) return [];

  const elements: LabelElement[] = [];
  for (const [index, candidate] of raw.entries()) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const element = candidate as Record<string, unknown>;

    const type = element["type"];
    if (typeof type !== "string") continue;

    const x = toNumber(element["x"], Number.NaN);
    const y = toNumber(element["y"], Number.NaN);
    if (Number.isNaN(x) || Number.isNaN(y)) continue;

    // Built with conditional spreads so an absent key stays ABSENT rather than
    // becoming `undefined` — required under exactOptionalPropertyTypes.
    const parsed: LabelElement = {
      id: typeof element["id"] === "string" ? element["id"] : `el-${index}`,
      type: type as LabelElement["type"],
      x,
      y,
      ...(element["width"] !== undefined && { width: toNumber(element["width"]) }),
      ...(element["height"] !== undefined && { height: toNumber(element["height"]) }),
      // Cast to LabelFieldKey (not LabelElement["field"], which includes
      // `undefined`) so the spread contributes a defined value.
      ...(typeof element["field"] === "string" && {
        field: element["field"] as LabelFieldKey,
      }),
      ...(typeof element["text"] === "string" && { text: element["text"] }),
      ...(element["fontSize"] !== undefined && { fontSize: toNumber(element["fontSize"], 7) }),
      ...(typeof element["bold"] === "boolean" && { bold: element["bold"] }),
      ...(typeof element["italic"] === "boolean" && { italic: element["italic"] }),
      ...(typeof element["align"] === "string" && {
        align: element["align"] as LabelTextAlign,
      }),
      ...(element["maxLines"] !== undefined && { maxLines: toNumber(element["maxLines"], 1) }),
      ...(element["letterSpacing"] !== undefined && {
        letterSpacing: toNumber(element["letterSpacing"]),
      }),
      ...(typeof element["symbology"] === "string" && {
        symbology: element["symbology"] as BarcodeSymbology,
      }),
      ...(typeof element["showBarcodeText"] === "boolean" && {
        showBarcodeText: element["showBarcodeText"],
      }),
      ...(typeof element["strikeThrough"] === "boolean" && {
        strikeThrough: element["strikeThrough"],
      }),
      ...(typeof element["showCurrency"] === "boolean" && {
        showCurrency: element["showCurrency"],
      }),
      ...(element["thickness"] !== undefined && { thickness: toNumber(element["thickness"], 0.3) }),
      ...(typeof element["filled"] === "boolean" && { filled: element["filled"] }),
      ...(typeof element["hideWhenEmpty"] === "boolean" && {
        hideWhenEmpty: element["hideWhenEmpty"],
      }),
    };

    elements.push(parsed);
  }
  return elements;
}

/** Converts a persisted template row into renderer-ready geometry. */
export function resolveTemplate(template: LabelTemplate): ResolvedTemplate {
  return {
    id: template.id,
    code: template.code,
    name: template.name,
    kind: template.kind,
    widthMm: toNumber(template.widthMm, 50),
    heightMm: toNumber(template.heightMm, 25),
    margins: {
      top: toNumber(template.marginTopMm, 1),
      right: toNumber(template.marginRightMm, 1),
      bottom: toNumber(template.marginBottomMm, 1),
      left: toNumber(template.marginLeftMm, 1),
    },
    elements: parseElements(template.elements),
    barcodeSymbology: template.barcodeSymbology,
    rotation: template.rotation,
  };
}

/**
 * Converts a built-in registry entry into the same shape.
 *
 * Used for previewing a template that has not been seeded yet, and as the
 * in-memory fallback if the DB has no system templates — the engine always has
 * a working layout to fall back on.
 */
export function resolveBuiltinTemplate(builtin: BuiltinTemplate): ResolvedTemplate {
  return {
    id: `builtin:${builtin.code}`,
    code: builtin.code,
    name: builtin.name,
    kind: builtin.kind,
    widthMm: builtin.widthMm,
    heightMm: builtin.heightMm,
    margins: builtin.margins,
    elements: builtin.elements,
    barcodeSymbology: builtin.barcodeSymbology,
    rotation: builtin.rotation,
  };
}

// ─── Field formatting ─────────────────────────────────────────────────────────

function formatDate(value: Date): string {
  // Fixed dd/mm/yyyy — label real estate is measured in millimetres, so a
  // locale-expanded month name would overflow the element box.
  const day = String(value.getDate()).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${value.getFullYear()}`;
}

function formatMoney(value: number, symbol: string, showCurrency: boolean): string {
  const amount = value.toFixed(2);
  return showCurrency ? `${symbol}${amount}` : amount;
}

/**
 * Resolves one element's bound field into display text.
 *
 * Returns null when the element should be omitted entirely (empty value +
 * hideWhenEmpty), which is how one template serves products that do and do not
 * carry optional data like batch numbers.
 */
export function resolveElementText(
  element: LabelElement,
  data: LabelData
): string | null {
  // Static text with no binding.
  if (!element.field) return element.text ?? null;

  const raw = data[element.field];

  const isEmpty =
    raw === null ||
    raw === undefined ||
    (typeof raw === "string" && raw.trim() === "");

  if (isEmpty) return element.hideWhenEmpty ? null : (element.text ?? "");

  let formatted: string;
  if (raw instanceof Date) {
    formatted = formatDate(raw);
  } else if (typeof raw === "number") {
    // Money fields get currency formatting; counts and percentages do not.
    const isMoney =
      element.field === "mrp" ||
      element.field === "sellingPrice" ||
      element.field === "discountAmount";
    formatted = isMoney
      ? formatMoney(raw, data.currencySymbol, element.showCurrency !== false)
      : String(raw);

    // A zero discount is not worth the label space.
    if (
      (element.field === "discountPercent" || element.field === "discountAmount") &&
      raw <= 0 &&
      element.hideWhenEmpty
    ) {
      return null;
    }
  } else {
    formatted = String(raw);
  }

  // `text` acts as a prefix/suffix around a bound value ("Rack A-3", "20%").
  if (element.text) {
    return element.text.endsWith(" ") || /^[A-Za-z]/.test(element.text)
      ? `${element.text}${formatted}`
      : `${formatted}${element.text}`;
  }
  return formatted;
}

// ─── Layout primitives ────────────────────────────────────────────────────────
//
// The renderers consume these. Positions are absolute millimetres from the
// label's top-left corner (margins already applied), so a renderer only has to
// convert mm → its own unit and draw.

export interface TextPrimitive {
  kind: "text";
  text: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  align: LabelTextAlign;
  maxLines: number;
  letterSpacing: number;
  strikeThrough: boolean;
}

export interface BarcodePrimitive {
  kind: "barcode";
  encoded: EncodedBarcode;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  showText: boolean;
  textFontSize: number;
}

export interface LinePrimitive {
  kind: "line";
  xMm: number;
  yMm: number;
  widthMm: number;
  thicknessMm: number;
}

export interface BoxPrimitive {
  kind: "box";
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  filled: boolean;
}

export type LabelPrimitive =
  | TextPrimitive
  | BarcodePrimitive
  | LinePrimitive
  | BoxPrimitive;

export interface LayoutResult {
  primitives: LabelPrimitive[];
  /** Physical size including margins — the renderer's canvas size. */
  widthMm: number;
  heightMm: number;
  warnings: string[];
}

/**
 * The single layout pass shared by SVG preview, PDF and thermal rendering.
 *
 * Every consumer calls this. If layout logic ever needs to change (a new
 * element type, better text fitting), it changes here once and all three
 * outputs stay identical — which is precisely the requirement that PDF and
 * thermal never diverge.
 */
export function layoutElements(document: LabelDocument): LayoutResult {
  const { template, data } = document;
  const warnings: string[] = [...document.warnings];
  const primitives: LabelPrimitive[] = [];

  const offsetX = template.margins.left;
  const offsetY = template.margins.top;
  const contentWidth = template.widthMm - template.margins.left - template.margins.right;

  for (const element of template.elements) {
    const x = offsetX + element.x;
    const y = offsetY + element.y;
    const width = element.width ?? contentWidth - element.x;

    switch (element.type) {
      case "line": {
        primitives.push({
          kind: "line",
          xMm: x,
          yMm: y,
          widthMm: width,
          thicknessMm: element.thickness ?? 0.3,
        });
        break;
      }

      case "box": {
        primitives.push({
          kind: "box",
          xMm: x,
          yMm: y,
          widthMm: width,
          heightMm: element.height ?? 5,
          thicknessMm: element.thickness ?? 0.3,
          filled: element.filled ?? false,
        });
        break;
      }

      case "barcode":
      case "qr": {
        const value = element.field ? data[element.field] : data.barcode;
        const stringValue = value == null ? "" : String(value);

        if (!stringValue) {
          if (!element.hideWhenEmpty) {
            warnings.push(`No barcode value available for element "${element.id}".`);
          }
          break;
        }

        // The element may pin a symbology; otherwise the template default is
        // adapted to the actual value (a non-numeric SKU cannot be EAN-13).
        const requested =
          element.symbology ??
          (element.type === "qr" ? BarcodeSymbology.QR : template.barcodeSymbology);
        const symbology =
          element.symbology != null
            ? requested
            : barcodeEngine.resolveSymbologyForValue(stringValue, requested);

        const { barcode, error } = barcodeEngine.tryEncode(symbology, stringValue);
        if (!barcode) {
          // Non-fatal: the label still prints with its text fields intact.
          warnings.push(error ?? `Could not encode barcode "${stringValue}".`);
          break;
        }

        primitives.push({
          kind: "barcode",
          encoded: barcode,
          xMm: x,
          yMm: y,
          widthMm: width,
          heightMm: element.height ?? 10,
          showText: element.showBarcodeText ?? true,
          textFontSize: element.fontSize ?? 5.5,
        });
        break;
      }

      case "image": {
        // Store logos are resolved by the caller (asset service) and drawn by
        // the PDF/SVG renderers only. Thermal printers need a rasterised,
        // dithered bitmap, which the drivers handle. Nothing to lay out here
        // beyond reserving the box.
        primitives.push({
          kind: "box",
          xMm: x,
          yMm: y,
          widthMm: width,
          heightMm: element.height ?? 8,
          thicknessMm: 0,
          filled: false,
        });
        break;
      }

      case "text":
      case "price":
      default: {
        const text = resolveElementText(element, data);
        if (text === null || text === "") break;

        primitives.push({
          kind: "text",
          text,
          xMm: x,
          yMm: y,
          widthMm: width,
          fontSize: element.fontSize ?? 7,
          bold: element.bold ?? false,
          italic: element.italic ?? false,
          align: element.align ?? "left",
          maxLines: element.maxLines ?? 1,
          letterSpacing: element.letterSpacing ?? 0,
          strikeThrough: element.strikeThrough ?? false,
        });
        break;
      }
    }
  }

  return {
    primitives,
    widthMm: template.widthMm,
    heightMm: template.heightMm,
    warnings,
  };
}

// ─── Template validation ──────────────────────────────────────────────────────

export interface TemplateValidationIssue {
  elementId: string | null;
  severity: "error" | "warning";
  message: string;
}

/**
 * Validates a template's geometry before it is saved.
 *
 * Errors block the save; warnings do not. An element that overflows the label
 * is a warning rather than an error because thermal media tolerance varies —
 * the owner may know their stock is oversized.
 */
export function validateTemplate(
  template: Pick<ResolvedTemplate, "widthMm" | "heightMm" | "margins" | "elements">
): TemplateValidationIssue[] {
  const issues: TemplateValidationIssue[] = [];

  if (template.widthMm <= 0 || template.heightMm <= 0) {
    issues.push({
      elementId: null,
      severity: "error",
      message: "Label width and height must be greater than zero.",
    });
  }

  const contentWidth =
    template.widthMm - template.margins.left - template.margins.right;
  const contentHeight =
    template.heightMm - template.margins.top - template.margins.bottom;

  if (contentWidth <= 0 || contentHeight <= 0) {
    issues.push({
      elementId: null,
      severity: "error",
      message: "Margins exceed the label size, leaving no printable area.",
    });
  }

  if (template.elements.length === 0) {
    issues.push({
      elementId: null,
      severity: "warning",
      message: "This template has no elements and will print a blank label.",
    });
  }

  const seenIds = new Set<string>();
  for (const element of template.elements) {
    if (seenIds.has(element.id)) {
      issues.push({
        elementId: element.id,
        severity: "error",
        message: `Duplicate element id "${element.id}".`,
      });
    }
    seenIds.add(element.id);

    if (element.x < 0 || element.y < 0) {
      issues.push({
        elementId: element.id,
        severity: "error",
        message: `Element "${element.id}" has a negative position.`,
      });
    }

    const right = element.x + (element.width ?? 0);
    const bottom = element.y + (element.height ?? 0);
    if (right > contentWidth + 0.01) {
      issues.push({
        elementId: element.id,
        severity: "warning",
        message: `Element "${element.id}" extends ${(right - contentWidth).toFixed(1)}mm beyond the printable width.`,
      });
    }
    if (bottom > contentHeight + 0.01) {
      issues.push({
        elementId: element.id,
        severity: "warning",
        message: `Element "${element.id}" extends ${(bottom - contentHeight).toFixed(1)}mm beyond the printable height.`,
      });
    }

    if ((element.type === "barcode" || element.type === "qr") && !element.height) {
      issues.push({
        elementId: element.id,
        severity: "warning",
        message: `Barcode "${element.id}" has no height; a default of 10mm will be used.`,
      });
    }
  }

  return issues;
}

export const templateEngine = {
  resolveTemplate,
  resolveBuiltinTemplate,
  parseElements,
  layoutElements,
  resolveElementText,
  validateTemplate,
  builtins: BUILTIN_TEMPLATES,
} as const;
