// =============================================================================
// SVG PREVIEW RENDERER
//
// Produces the on-screen preview. SVG (not PNG) because:
//   • It is resolution-independent — the zoom control is a viewBox change, so
//     a 400% zoom stays razor-sharp instead of showing interpolated pixels.
//   • Barcode bars stay geometrically exact. A rasterised preview can imply a
//     scannability problem that does not exist on the actual printer, or hide
//     one that does.
//   • It is text, so it compresses well and needs no image pipeline.
//
// The preview is deliberately rendered from the SAME layout pass as the PDF and
// thermal output, so "preview must match printer output" is structural rather
// than a thing we periodically re-check by eye.
// =============================================================================

import type { LabelDocument, RenderOptions } from "../label.types";
import {
  layoutElements,
  type BarcodePrimitive,
  type BoxPrimitive,
  type LinePrimitive,
  type TextPrimitive,
} from "../templates/template.engine";

/** Escapes text for safe inclusion in SVG markup. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Points → millimetres. Font sizes are authored in points (typographic
 * convention) but the SVG coordinate system here is millimetres, so every font
 * size must be converted or text renders ~2.8× too large.
 */
const PT_TO_MM = 25.4 / 72;

/**
 * Approximate width of a string in mm.
 *
 * Server-side we have no font metrics without loading a font file, so we use a
 * calibrated average character-width ratio for Helvetica. This is only used for
 * truncation decisions and centring, where being a few percent off is
 * invisible; the browser and pdfkit do the real glyph layout.
 */
function approximateTextWidthMm(
  text: string,
  fontSizePt: number,
  bold: boolean
): number {
  const ratio = bold ? 0.58 : 0.52;
  return text.length * fontSizePt * PT_TO_MM * ratio;
}

/** Truncates with an ellipsis when a string cannot fit its element box. */
function fitText(
  text: string,
  widthMm: number,
  fontSizePt: number,
  bold: boolean
): string {
  if (approximateTextWidthMm(text, fontSizePt, bold) <= widthMm) return text;

  let result = text;
  while (
    result.length > 1 &&
    approximateTextWidthMm(`${result}…`, fontSizePt, bold) > widthMm
  ) {
    result = result.slice(0, -1);
  }
  return `${result.trimEnd()}…`;
}

function renderText(primitive: TextPrimitive): string {
  const fontSizeMm = primitive.fontSize * PT_TO_MM;

  // SVG text anchors on the BASELINE, whereas templates position from the
  // element's top edge. Without this offset every string sits one line too
  // high — and would differ from the PDF, which we cannot allow.
  const baselineY = primitive.yMm + fontSizeMm * 0.8;

  const anchor =
    primitive.align === "center" ? "middle" : primitive.align === "right" ? "end" : "start";
  const anchorX =
    primitive.align === "center"
      ? primitive.xMm + primitive.widthMm / 2
      : primitive.align === "right"
        ? primitive.xMm + primitive.widthMm
        : primitive.xMm;

  const display = fitText(
    primitive.text,
    primitive.widthMm,
    primitive.fontSize,
    primitive.bold
  );

  const attributes = [
    `x="${anchorX.toFixed(3)}"`,
    `y="${baselineY.toFixed(3)}"`,
    `font-family="Helvetica, Arial, sans-serif"`,
    `font-size="${fontSizeMm.toFixed(3)}"`,
    `text-anchor="${anchor}"`,
    primitive.bold ? `font-weight="bold"` : "",
    primitive.italic ? `font-style="italic"` : "",
    primitive.letterSpacing
      ? `letter-spacing="${(primitive.letterSpacing).toFixed(3)}"`
      : "",
    `fill="#000000"`,
  ]
    .filter(Boolean)
    .join(" ");

  const textNode = `<text ${attributes}>${escapeXml(display)}</text>`;

  if (!primitive.strikeThrough) return textNode;

  // Strike-through for a struck MRP next to a sale price. Drawn as a rule at
  // mid-x-height so it reads as "was this price".
  const textWidth = approximateTextWidthMm(
    display,
    primitive.fontSize,
    primitive.bold
  );
  const lineX =
    primitive.align === "center"
      ? anchorX - textWidth / 2
      : primitive.align === "right"
        ? anchorX - textWidth
        : anchorX;
  const lineY = baselineY - fontSizeMm * 0.28;

  return `${textNode}<rect x="${lineX.toFixed(3)}" y="${lineY.toFixed(3)}" width="${textWidth.toFixed(3)}" height="${(fontSizeMm * 0.07).toFixed(3)}" fill="#000000" />`;
}

/**
 * Renders a 1D barcode as one <rect> per contiguous bar run.
 *
 * Emitting a rect per RUN rather than per module keeps the markup small — an
 * EAN-13 becomes ~30 rects instead of 95 — which matters when a batch preview
 * shows dozens of labels at once.
 */
function renderBarcode(primitive: BarcodePrimitive): string {
  const { encoded } = primitive;
  if (!encoded.modules || encoded.moduleCount === 0) return "";

  const textHeightMm = primitive.showText ? primitive.textFontSize * PT_TO_MM * 1.2 : 0;
  const barsHeight = Math.max(0.5, primitive.heightMm - textHeightMm);

  // The quiet zone is part of the symbol: without it scanners fail to acquire
  // the code, so it is reserved from the available width rather than ignored.
  const totalModules = encoded.moduleCount + encoded.quietZoneModules * 2;
  const moduleWidth = primitive.widthMm / totalModules;
  const startX = primitive.xMm + encoded.quietZoneModules * moduleWidth;

  const rects: string[] = [];
  let index = 0;
  while (index < encoded.modules.length) {
    if (encoded.modules[index] === "1") {
      let runLength = 1;
      while (
        index + runLength < encoded.modules.length &&
        encoded.modules[index + runLength] === "1"
      ) {
        runLength += 1;
      }
      const x = startX + index * moduleWidth;
      rects.push(
        `<rect x="${x.toFixed(4)}" y="${primitive.yMm.toFixed(3)}" width="${(moduleWidth * runLength).toFixed(4)}" height="${barsHeight.toFixed(3)}" fill="#000000" shape-rendering="crispEdges" />`
      );
      index += runLength;
    } else {
      index += 1;
    }
  }

  if (primitive.showText && encoded.text) {
    const fontSizeMm = primitive.textFontSize * PT_TO_MM;
    rects.push(
      `<text x="${(primitive.xMm + primitive.widthMm / 2).toFixed(3)}" y="${(primitive.yMm + barsHeight + fontSizeMm).toFixed(3)}" font-family="Helvetica, Arial, sans-serif" font-size="${fontSizeMm.toFixed(3)}" text-anchor="middle" fill="#000000" letter-spacing="0.15">${escapeXml(encoded.text)}</text>`
    );
  }

  return rects.join("");
}

function renderLine(primitive: LinePrimitive): string {
  return `<rect x="${primitive.xMm.toFixed(3)}" y="${primitive.yMm.toFixed(3)}" width="${primitive.widthMm.toFixed(3)}" height="${primitive.thicknessMm.toFixed(3)}" fill="#000000" />`;
}

function renderBox(primitive: BoxPrimitive): string {
  if (primitive.thicknessMm === 0 && !primitive.filled) return "";
  const fill = primitive.filled ? "#000000" : "none";
  const stroke = primitive.filled ? "none" : "#000000";
  return `<rect x="${primitive.xMm.toFixed(3)}" y="${primitive.yMm.toFixed(3)}" width="${primitive.widthMm.toFixed(3)}" height="${primitive.heightMm.toFixed(3)}" fill="${fill}" stroke="${stroke}" stroke-width="${primitive.thicknessMm.toFixed(3)}" />`;
}

export interface SvgRenderResult {
  svg: string;
  widthMm: number;
  heightMm: number;
  warnings: string[];
}

/**
 * Renders one label to a standalone SVG string.
 *
 * The viewBox is in millimetres and width/height are declared in mm, so the
 * browser renders it at true physical size at 100% zoom — what the user sees
 * is literally the size of the sticker that comes out of the printer.
 */
export function renderLabelToSvg(
  document: LabelDocument,
  options: RenderOptions = {}
): SvgRenderResult {
  const layout = layoutElements(document);
  const { widthMm, heightMm } = layout;

  const body: string[] = [];

  // White background so a dark-themed UI does not show a black label.
  body.push(
    `<rect x="0" y="0" width="${widthMm}" height="${heightMm}" fill="#ffffff" />`
  );

  if (options.showBoundary) {
    body.push(
      `<rect x="0.1" y="0.1" width="${(widthMm - 0.2).toFixed(3)}" height="${(heightMm - 0.2).toFixed(3)}" fill="none" stroke="#cbd5e1" stroke-width="0.2" stroke-dasharray="0.8 0.8" />`
    );
  }

  for (const primitive of layout.primitives) {
    switch (primitive.kind) {
      case "text":
        body.push(renderText(primitive));
        break;
      case "barcode":
        body.push(renderBarcode(primitive));
        break;
      case "line":
        body.push(renderLine(primitive));
        break;
      case "box":
        body.push(renderBox(primitive));
        break;
    }
  }

  // Rotation is applied as a transform around the centre so a 90° label
  // previews exactly as it will feed through the printer.
  const rotation = document.template.rotation % 360;
  const content =
    rotation === 0
      ? body.join("")
      : `<g transform="rotate(${rotation} ${(widthMm / 2).toFixed(3)} ${(heightMm / 2).toFixed(3)})">${body.join("")}</g>`;

  const scale = options.scale ?? 1;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${(widthMm * scale).toFixed(3)}mm" height="${(heightMm * scale).toFixed(3)}mm" ` +
    `viewBox="0 0 ${widthMm} ${heightMm}" ` +
    `role="img" aria-label="Label preview for ${escapeXml(document.data.productName)}">` +
    content +
    `</svg>`;

  return { svg, widthMm, heightMm, warnings: layout.warnings };
}

export const svgRenderer = { renderLabelToSvg } as const;
