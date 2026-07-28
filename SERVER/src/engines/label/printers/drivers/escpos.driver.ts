// =============================================================================
// ESC/POS DRIVER  (XPrinter, Epson, and most generic thermal printers)
//
// ESC/POS is a RECEIPT language, not a label language: it has no concept of
// absolute x/y positioning. Content flows line by line. That is a genuine
// mismatch with our coordinate-based layout, and how we bridge it matters.
//
// Approach: rasterise the label to a 1-bit bitmap and send it with GS v 0
// (print raster bit image). This is the only way to reproduce a coordinate
// layout faithfully on ESC/POS, and it is what commercial POS software does
// for logos and barcodes. The cost is a larger command stream than TSPL/ZPL;
// the benefit is that the SAME layout renders identically across all three
// dialects, which is the invariant the whole engine is built on.
//
// Rasterising here (rather than emitting ESC/POS text commands) is a deliberate
// trade-off: text commands would be smaller but would silently ignore element
// positions, so a 50×25mm label designed in the template editor would come out
// as a stack of left-aligned lines. Correctness wins.
// =============================================================================

import { PrinterDriverType } from "../../../../../generated/prisma";
import type { LabelDocument } from "../../label.types";
import { layoutElements } from "../../templates/template.engine";
import type {
  PrinterCapabilities,
  PrinterDriver,
  PrintPayload,
} from "../driver.types";
import { MonoBitmap } from "../raster/monoBitmap";

const ESC = 0x1b;
const GS = 0x1d;

export const escPosDriver: PrinterDriver = {
  type: PrinterDriverType.ESC_POS,
  displayName: "ESC/POS (XPrinter, Epson & compatible)",
  knownDevices: [
    "XPrinter XP-365B",
    "XPrinter XP-420B",
    "Epson TM-T88",
    "Generic ESC/POS",
  ],
  isDocumentDriver: false,

  build(
    documents: LabelDocument[],
    capabilities: PrinterCapabilities,
    copies: number
  ): PrintPayload {
    const { dpi } = capabilities;
    const chunks: Buffer[] = [];
    const previewLines: string[] = [];

    // ESC @ — initialise printer (clears any state left by a previous job).
    chunks.push(Buffer.from([ESC, 0x40]));
    previewLines.push("ESC @            ; initialise");

    for (const document of documents) {
      const layout = layoutElements(document);

      // Rasterise the shared layout into a monochrome bitmap at head
      // resolution. This is the step that preserves element positioning.
      const bitmap = MonoBitmap.fromLayout(layout, dpi);
      const raster = bitmap.toEscPosRaster();

      for (let copy = 0; copy < Math.max(1, copies); copy += 1) {
        chunks.push(raster);
        // GS V 66 — partial cut with feed. Label printers that lack a cutter
        // ignore this, so it is safe to always send.
        chunks.push(Buffer.from([GS, 0x56, 0x42, 0x03]));
      }

      previewLines.push(
        `GS v 0           ; raster ${bitmap.width}×${bitmap.height}px (${layout.widthMm}×${layout.heightMm}mm @ ${dpi}dpi) ×${copies}`
      );
      previewLines.push("GS V 66          ; feed & cut");
    }

    return {
      bytes: Buffer.concat(chunks),
      preview: previewLines.join("\n"),
      contentType: "application/octet-stream",
    };
  },
};
