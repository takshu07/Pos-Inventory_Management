// =============================================================================
// ZPL II DRIVER  (Zebra, and the many ZPL-compatible label printers)
//
// ZPL wraps each label in ^XA … ^XZ. Elements are positioned in dots via ^FO
// (field origin), and content is delimited by ^FD … ^FS (field data/separator).
//
// Like TSPL this uses the printer's native text and barcode rendering, so the
// output is as sharp as the head allows and the command stream stays compact
// even for a 500-label batch.
// =============================================================================

import { PrinterDriverType } from "../../../../../generated/prisma";
import type { LabelDocument } from "../../label.types";
import { layoutElements } from "../../templates/template.engine";
import type {
  PrinterCapabilities,
  PrinterDriver,
  PrintPayload,
} from "../driver.types";

function toDots(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

/**
 * ZPL's scalable font "0" takes an explicit height in dots, so unlike TSPL we
 * can honour the template's point size closely rather than snapping to a
 * firmware font.
 */
function fontHeightDots(fontSizePt: number, dpi: number): number {
  return Math.max(8, Math.round((fontSizePt / 72) * dpi));
}

/**
 * ^FD is terminated by ^FS, so a caret or tilde inside user data would corrupt
 * the command stream. ZPL's ^FH lets us hex-escape those bytes.
 */
function escapeZpl(text: string): string {
  return text.replace(/[\^~]/g, (char) =>
    `_${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
  );
}

/** ZPL barcode command prefixes per symbology. */
const ZPL_BARCODE: Record<string, string> = {
  EAN13: "^BE",
  UPC: "^BU",
  CODE128: "^BC",
  CODE39: "^B3",
  ITF14: "^B2",
};

export const zplDriver: PrinterDriver = {
  type: PrinterDriverType.ZPL,
  displayName: "ZPL II (Zebra)",
  knownDevices: ["Zebra ZD220", "Zebra ZD421", "Zebra GK420d", "Generic ZPL II"],
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

      commands.push("^XA");
      // ^PW = print width, ^LL = label length, both in dots.
      commands.push(`^PW${toDots(layout.widthMm, dpi)}`);
      commands.push(`^LL${toDots(layout.heightMm, dpi)}`);
      commands.push(`^MD${Math.max(0, Math.min(30, capabilities.darkness))}`);
      commands.push(`^PR${Math.max(1, Math.min(14, capabilities.printSpeed))}`);
      // ^CI28 selects UTF-8 so non-ASCII product names and the ₹ symbol print
      // correctly instead of as mojibake.
      commands.push("^CI28");
      commands.push("^LH0,0");

      for (const primitive of layout.primitives) {
        switch (primitive.kind) {
          case "text": {
            const height = fontHeightDots(primitive.fontSize, dpi);
            const width = Math.round(height * (primitive.bold ? 0.62 : 0.55));
            const blockWidth = toDots(primitive.widthMm, dpi);
            const alignCode =
              primitive.align === "center" ? "C" : primitive.align === "right" ? "R" : "L";

            commands.push(`^FO${toDots(primitive.xMm, dpi)},${toDots(primitive.yMm, dpi)}`);
            commands.push(`^A0N,${height},${width}`);
            // ^FB gives us a text block with real alignment and line limiting,
            // so long product names wrap or truncate instead of overrunning.
            commands.push(`^FB${blockWidth},${Math.max(1, primitive.maxLines)},0,${alignCode},0`);
            commands.push("^FH");
            commands.push(`^FD${escapeZpl(primitive.text)}^FS`);

            if (primitive.strikeThrough) {
              // ^GB draws a filled box — used as the strike-through rule.
              const textWidth = Math.min(
                blockWidth,
                primitive.text.length * width
              );
              const strikeX =
                primitive.align === "center"
                  ? toDots(primitive.xMm, dpi) + (blockWidth - textWidth) / 2
                  : primitive.align === "right"
                    ? toDots(primitive.xMm, dpi) + blockWidth - textWidth
                    : toDots(primitive.xMm, dpi);
              const strikeY = toDots(primitive.yMm, dpi) + Math.round(height * 0.45);
              const thickness = Math.max(1, Math.round(height * 0.08));
              commands.push(
                `^FO${Math.round(strikeX)},${strikeY}^GB${Math.round(textWidth)},${thickness},${thickness}^FS`
              );
            }
            break;
          }

          case "barcode": {
            const symbology = primitive.encoded.symbology;
            const zplCommand = ZPL_BARCODE[symbology];
            const textHeight = primitive.showText
              ? fontHeightDots(primitive.textFontSize, dpi)
              : 0;
            const barHeight = Math.max(
              10,
              toDots(primitive.heightMm, dpi) - textHeight
            );

            commands.push(`^FO${toDots(primitive.xMm, dpi)},${toDots(primitive.yMm, dpi)}`);

            if (zplCommand) {
              // ^BY sets module width; deriving it from the available width
              // keeps the symbol inside its element box on any head resolution.
              const totalModules =
                primitive.encoded.moduleCount + primitive.encoded.quietZoneModules * 2;
              const moduleWidth = Math.max(
                1,
                Math.min(10, Math.floor(toDots(primitive.widthMm, dpi) / totalModules))
              );
              commands.push(`^BY${moduleWidth},2.0,${barHeight}`);
              commands.push(
                `${zplCommand}N,${barHeight},${primitive.showText ? "Y" : "N"},N`
              );
              commands.push(`^FD${escapeZpl(primitive.encoded.value)}^FS`);
            } else {
              // Unsupported symbology → draw the module pattern with ^GB bars.
              const totalModules =
                primitive.encoded.moduleCount + primitive.encoded.quietZoneModules * 2;
              const moduleWidth = Math.max(
                1,
                Math.round(toDots(primitive.widthMm, dpi) / totalModules)
              );
              const startX =
                toDots(primitive.xMm, dpi) +
                primitive.encoded.quietZoneModules * moduleWidth;
              const yDots = toDots(primitive.yMm, dpi);

              let index = 0;
              while (index < primitive.encoded.modules.length) {
                if (primitive.encoded.modules[index] === "1") {
                  let run = 1;
                  while (primitive.encoded.modules[index + run] === "1") run += 1;
                  const barWidth = run * moduleWidth;
                  commands.push(
                    `^FO${startX + index * moduleWidth},${yDots}^GB${barWidth},${barHeight},${barWidth}^FS`
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
            const thickness = Math.max(1, toDots(primitive.thicknessMm, dpi));
            commands.push(
              `^FO${toDots(primitive.xMm, dpi)},${toDots(primitive.yMm, dpi)}^GB${toDots(primitive.widthMm, dpi)},${thickness},${thickness}^FS`
            );
            break;
          }

          case "box": {
            const thickness = primitive.filled
              ? toDots(primitive.heightMm, dpi)
              : Math.max(1, toDots(primitive.thicknessMm, dpi));
            commands.push(
              `^FO${toDots(primitive.xMm, dpi)},${toDots(primitive.yMm, dpi)}^GB${toDots(primitive.widthMm, dpi)},${toDots(primitive.heightMm, dpi)},${thickness}^FS`
            );
            break;
          }
        }
      }

      // ^PQ = print quantity; the printer repeats the label internally.
      commands.push(`^PQ${Math.max(1, copies)},0,0,N`);
      commands.push("^XZ");
    }

    const text = commands.join("\n");
    return {
      bytes: Buffer.from(text, "utf8"),
      preview: text,
      contentType: "application/octet-stream",
    };
  },
};
