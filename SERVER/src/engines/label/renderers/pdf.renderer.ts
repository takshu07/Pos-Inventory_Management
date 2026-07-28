// =============================================================================
// PDF RENDERER
//
// Generates real PDF bytes for: development, testing, fallback printing, bulk
// downloads, and users without a thermal printer.
//
// CRITICAL INVARIANT: this renderer calls the SAME layoutElements() pass as the
// SVG preview and the thermal drivers. There is no PDF-specific layout code —
// only PDF-specific *drawing*. That is what makes "PDF must use the exact same
// template engine as thermal printing; never maintain separate layouts" true by
// construction rather than by discipline.
// =============================================================================

import PDFDocument from "pdfkit";

import type { LabelDocument, RenderOptions } from "../label.types";
import {
  layoutElements,
  type BarcodePrimitive,
  type BoxPrimitive,
  type LinePrimitive,
  type TextPrimitive,
} from "../templates/template.engine";

/**
 * Millimetres → PDF points (1pt = 1/72"). PDF's native unit is points, while
 * templates are authored in millimetres because labels are physical objects.
 */
const MM_TO_PT = 72 / 25.4;

function mm(value: number): number {
  return value * MM_TO_PT;
}

type Doc = InstanceType<typeof PDFDocument>;

function drawText(doc: Doc, primitive: TextPrimitive): void {
  doc
    .font(primitive.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(primitive.fontSize)
    .fillColor("#000000");

  const x = mm(primitive.xMm);
  const y = mm(primitive.yMm);
  const width = mm(primitive.widthMm);

  doc.text(primitive.text, x, y, {
    width,
    align: primitive.align,
    // ellipsis + a fixed line budget stops a long product name from pushing the
    // barcode off a 25mm label.
    ellipsis: true,
    lineBreak: primitive.maxLines > 1,
    height: primitive.maxLines * primitive.fontSize * 1.15,
    ...(primitive.letterSpacing
      ? { characterSpacing: primitive.letterSpacing * MM_TO_PT }
      : {}),
  });

  if (primitive.strikeThrough) {
    // pdfkit measures the actual glyph width, so unlike the SVG preview this
    // strike-through is exact rather than approximated.
    const textWidth = doc.widthOfString(primitive.text);
    const lineY = y + primitive.fontSize * 0.62;
    const lineX =
      primitive.align === "center"
        ? x + (width - textWidth) / 2
        : primitive.align === "right"
          ? x + width - textWidth
          : x;

    doc
      .save()
      .rect(lineX, lineY, textWidth, Math.max(0.4, primitive.fontSize * 0.06))
      .fill("#000000")
      .restore();
  }
}

/**
 * Draws a 1D barcode as filled rectangles, one per contiguous bar run.
 *
 * Vector rects — never a rasterised image — so the barcode stays sharp at any
 * printer resolution and the PDF remains small even for a 500-label batch.
 */
function drawBarcode(doc: Doc, primitive: BarcodePrimitive): void {
  const { encoded } = primitive;
  if (!encoded.modules || encoded.moduleCount === 0) return;

  const textHeight = primitive.showText ? primitive.textFontSize * 1.2 : 0;
  const barsHeight = Math.max(1, mm(primitive.heightMm) - textHeight);

  const totalModules = encoded.moduleCount + encoded.quietZoneModules * 2;
  const moduleWidth = mm(primitive.widthMm) / totalModules;
  const startX = mm(primitive.xMm) + encoded.quietZoneModules * moduleWidth;
  const y = mm(primitive.yMm);

  doc.save().fillColor("#000000");

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
      doc.rect(startX + index * moduleWidth, y, moduleWidth * runLength, barsHeight).fill();
      index += runLength;
    } else {
      index += 1;
    }
  }

  doc.restore();

  if (primitive.showText && encoded.text) {
    doc
      .font("Helvetica")
      .fontSize(primitive.textFontSize)
      .fillColor("#000000")
      .text(encoded.text, mm(primitive.xMm), y + barsHeight + 1, {
        width: mm(primitive.widthMm),
        align: "center",
        lineBreak: false,
      });
  }
}

function drawLine(doc: Doc, primitive: LinePrimitive): void {
  doc
    .save()
    .rect(
      mm(primitive.xMm),
      mm(primitive.yMm),
      mm(primitive.widthMm),
      Math.max(0.3, mm(primitive.thicknessMm))
    )
    .fill("#000000")
    .restore();
}

function drawBox(doc: Doc, primitive: BoxPrimitive): void {
  if (primitive.thicknessMm === 0 && !primitive.filled) return;

  doc.save();
  const rect = doc.rect(
    mm(primitive.xMm),
    mm(primitive.yMm),
    mm(primitive.widthMm),
    mm(primitive.heightMm)
  );

  if (primitive.filled) {
    rect.fill("#000000");
  } else {
    rect.lineWidth(Math.max(0.3, mm(primitive.thicknessMm))).stroke("#000000");
  }
  doc.restore();
}

/** Draws one label at the current page origin. */
function drawLabel(doc: Doc, document: LabelDocument): string[] {
  const layout = layoutElements(document);

  for (const primitive of layout.primitives) {
    switch (primitive.kind) {
      case "text":
        drawText(doc, primitive);
        break;
      case "barcode":
        drawBarcode(doc, primitive);
        break;
      case "line":
        drawLine(doc, primitive);
        break;
      case "box":
        drawBox(doc, primitive);
        break;
    }
  }

  return layout.warnings;
}

export interface PdfRenderResult {
  buffer: Buffer;
  pageCount: number;
  warnings: string[];
}

/**
 * Renders one or more labels into a single PDF.
 *
 * One label per page, sized to the physical label — so sending the PDF to a
 * thermal printer's own driver produces correctly sized output, and a desktop
 * printer with label media does too.
 *
 * @param documents Labels to render, already resolved.
 * @param options   `copies` repeats every label; used by the queue for
 *                  multi-copy jobs so copy handling lives in one place.
 */
export async function renderLabelsToPdf(
  documents: LabelDocument[],
  options: RenderOptions = {}
): Promise<PdfRenderResult> {
  if (documents.length === 0) {
    throw new Error("Cannot generate a PDF with no labels.");
  }

  const copies = Math.max(1, options.copies ?? 1);
  const warnings: string[] = [];
  let pageCount = 0;

  const first = documents[0];
  if (!first) throw new Error("Cannot generate a PDF with no labels.");

  const doc = new PDFDocument({
    size: [mm(first.template.widthMm), mm(first.template.heightMm)],
    margin: 0,
    // Rendered labels are never stored, but the document metadata makes a
    // downloaded batch self-describing in a file manager.
    info: {
      Title: `Labels — ${first.template.name}`,
      Creator: "POS Label Engine",
      Producer: "POS Label Engine",
      CreationDate: new Date(),
    },
    autoFirstPage: false,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  for (const document of documents) {
    for (let copy = 0; copy < copies; copy += 1) {
      // Page size is per-label: a batch may mix templates (a shelf label and a
      // price tag), and each must come out at its own physical size.
      doc.addPage({
        size: [mm(document.template.widthMm), mm(document.template.heightMm)],
        margin: 0,
      });
      pageCount += 1;

      const labelWarnings = drawLabel(doc, document);
      // Only record each distinct warning once — a 200-label batch with the
      // same missing barcode should not emit 200 identical strings.
      for (const warning of labelWarnings) {
        if (!warnings.includes(warning)) warnings.push(warning);
      }
    }
  }

  doc.end();
  await finished;

  return { buffer: Buffer.concat(chunks), pageCount, warnings };
}

export const pdfRenderer = { renderLabelsToPdf } as const;
