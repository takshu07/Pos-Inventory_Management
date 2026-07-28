// =============================================================================
// TSPL DRIVER  (TSC, and the many TSC-compatible label printers)
//
// TSPL is a label-oriented language: you declare the media size, then position
// each element in DOTS from the label origin. That maps almost directly onto
// our layout primitives, which is why label printers produce the sharpest
// output — the printer renders text and barcodes with its own firmware fonts
// rather than receiving a bitmap.
//
// Coordinates are dots: dots = mm / 25.4 * dpi. At 203dpi (the common thermal
// resolution) 1mm ≈ 8 dots.
// =============================================================================

import { PrinterDriverType } from "../../../../../generated/prisma";
import type { LabelDocument } from "../../label.types";
import { layoutElements } from "../../templates/template.engine";
import type {
  PrinterCapabilities,
  PrinterDriver,
  PrintPayload,
} from "../driver.types";

/** Millimetres → printer dots at the given head resolution. */
function toDots(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

/**
 * Maps our point-based font sizes onto TSPL's built-in bitmap font ids.
 *
 * TSPL fonts "1".."5" are fixed sizes, so we pick the closest and let the
 * x/y multiplier handle the rest. Using firmware fonts (rather than sending a
 * rasterised bitmap) keeps text crisp and the command stream tiny.
 */
function fontFor(fontSizePt: number): { font: string; scale: number } {
  if (fontSizePt <= 6) return { font: "1", scale: 1 };
  if (fontSizePt <= 8) return { font: "2", scale: 1 };
  if (fontSizePt <= 11) return { font: "3", scale: 1 };
  if (fontSizePt <= 15) return { font: "3", scale: 2 };
  return { font: "4", scale: 2 };
}

/** TSPL string literals are double-quoted; embedded quotes must be escaped. */
function escapeTspl(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** TSPL barcode type codes for the symbologies we support. */
const TSPL_BARCODE_TYPE: Record<string, string> = {
  EAN13: "EAN13",
  UPC: "UPCA",
  CODE128: "128",
  CODE39: "39",
  ITF14: "EAN14",
};

export const tsplDriver: PrinterDriver = {
  type: PrinterDriverType.TSPL,
  displayName: "TSPL / TSPL2 (TSC)",
  knownDevices: ["TSC TE244", "TSC TTP-244 Pro", "TSC DA210", "Generic TSPL"],
  isDocumentDriver: false,

  build(
    documents: LabelDocument[],
    capabilities: PrinterCapabilities,
    copies: number
  ): PrintPayload {
    const { dpi } = capabilities;
    const commands: string[] = [];

    for (const document of documents) {
      const layout = layoutElements(document);

      // Per-label media setup: a batch may mix a 50×25 price tag with a
      // 100×50 warehouse label, and each must feed at its own size.
      commands.push(`SIZE ${layout.widthMm.toFixed(1)} mm,${layout.heightMm.toFixed(1)} mm`);
      commands.push("GAP 2 mm,0 mm");
      commands.push(`DENSITY ${Math.max(0, Math.min(15, capabilities.darkness))}`);
      commands.push(`SPEED ${Math.max(1, Math.min(6, capabilities.printSpeed))}`);
      commands.push("DIRECTION 1");
      commands.push("CLS");

      for (const primitive of layout.primitives) {
        switch (primitive.kind) {
          case "text": {
            const { font, scale } = fontFor(primitive.fontSize);
            // TSPL has no native alignment, so we resolve the anchor ourselves
            // using an approximate glyph width for the chosen firmware font.
            const charWidthDots = toDots(primitive.fontSize * 0.35, dpi) * scale;
            const textWidthDots = primitive.text.length * charWidthDots;
            const boxWidthDots = toDots(primitive.widthMm, dpi);

            let xDots = toDots(primitive.xMm, dpi);
            if (primitive.align === "center") {
              xDots += Math.max(0, (boxWidthDots - textWidthDots) / 2);
            } else if (primitive.align === "right") {
              xDots += Math.max(0, boxWidthDots - textWidthDots);
            }

            commands.push(
              `TEXT ${Math.round(xDots)},${toDots(primitive.yMm, dpi)},"${font}",0,${scale},${scale},"${escapeTspl(primitive.text)}"`
            );

            // TSPL cannot strike through text; draw an explicit bar over it so
            // a struck MRP still reads correctly on thermal output.
            if (primitive.strikeThrough) {
              const strikeY = toDots(primitive.yMm + primitive.fontSize * 0.0125 * 25.4 * 0.4, dpi);
              commands.push(
                `BAR ${Math.round(xDots)},${strikeY},${Math.round(textWidthDots)},${Math.max(1, toDots(0.25, dpi))}`
              );
            }
            break;
          }

          case "barcode": {
            const symbology = primitive.encoded.symbology;
            const tsplType = TSPL_BARCODE_TYPE[symbology];
            const textHeightDots = primitive.showText ? toDots(primitive.textFontSize * 0.4, dpi) : 0;
            const barHeight = Math.max(
              8,
              toDots(primitive.heightMm, dpi) - textHeightDots
            );

            if (tsplType) {
              // Native barcode command: the printer's firmware generates the
              // bars, guaranteeing correct module widths for its head.
              commands.push(
                `BARCODE ${toDots(primitive.xMm, dpi)},${toDots(primitive.yMm, dpi)},"${tsplType}",${barHeight},${primitive.showText ? 1 : 0},0,2,2,"${escapeTspl(primitive.encoded.value)}"`
              );
            } else {
              // Unsupported symbology (e.g. a future 2D code): fall back to
              // drawing the module pattern as bars so the label still scans.
              const totalModules =
                primitive.encoded.moduleCount + primitive.encoded.quietZoneModules * 2;
              const moduleWidthDots = Math.max(
                1,
                Math.round(toDots(primitive.widthMm, dpi) / totalModules)
              );
              const startX =
                toDots(primitive.xMm, dpi) +
                primitive.encoded.quietZoneModules * moduleWidthDots;
              const yDots = toDots(primitive.yMm, dpi);

              let index = 0;
              while (index < primitive.encoded.modules.length) {
                if (primitive.encoded.modules[index] === "1") {
                  let run = 1;
                  while (primitive.encoded.modules[index + run] === "1") run += 1;
                  commands.push(
                    `BAR ${startX + index * moduleWidthDots},${yDots},${run * moduleWidthDots},${barHeight}`
                  );
                  index += run;
                } else {
                  index += 1;
                }
              }
            }
            break;
          }

          case "line": {
            commands.push(
              `BAR ${toDots(primitive.xMm, dpi)},${toDots(primitive.yMm, dpi)},${toDots(primitive.widthMm, dpi)},${Math.max(1, toDots(primitive.thicknessMm, dpi))}`
            );
            break;
          }

          case "box": {
            if (primitive.filled) {
              commands.push(
                `BAR ${toDots(primitive.xMm, dpi)},${toDots(primitive.yMm, dpi)},${toDots(primitive.widthMm, dpi)},${toDots(primitive.heightMm, dpi)}`
              );
            } else if (primitive.thicknessMm > 0) {
              commands.push(
                `BOX ${toDots(primitive.xMm, dpi)},${toDots(primitive.yMm, dpi)},${toDots(primitive.xMm + primitive.widthMm, dpi)},${toDots(primitive.yMm + primitive.heightMm, dpi)},${Math.max(1, toDots(primitive.thicknessMm, dpi))}`
              );
            }
            break;
          }
        }
      }

      // PRINT <sets>,<copies> — the printer repeats internally, which is far
      // faster than re-sending the whole label N times.
      commands.push(`PRINT 1,${Math.max(1, copies)}`);
    }

    const text = `${commands.join("\r\n")}\r\n`;
    return {
      bytes: Buffer.from(text, "latin1"),
      preview: text,
      contentType: "application/octet-stream",
    };
  },
};
