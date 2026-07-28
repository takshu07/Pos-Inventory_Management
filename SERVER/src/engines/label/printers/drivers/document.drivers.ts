// =============================================================================
// DOCUMENT & VIRTUAL DRIVERS  (PDF, Preview, Null)
//
// These are what make the three development modes work without the rest of the
// application knowing which is active:
//
//   Development → PREVIEW  (renders SVG, prints nothing)
//   Testing     → PDF      (real bytes, no hardware)
//   Production  → THERMAL  (ESC/POS / TSPL / ZPL)
//
// They implement the SAME PrinterDriver interface as the thermal drivers, so
// the print queue, services, controllers and UI treat "print to PDF" and
// "print to a Zebra" identically. Only the driver differs — which is exactly
// the "only PrinterService changes" requirement.
// =============================================================================

import { PrinterDriverType } from "../../../../../generated/prisma";
import type { LabelDocument } from "../../label.types";
import { pdfRenderer } from "../../renderers/pdf.renderer";
import { svgRenderer } from "../../renderers/svg.renderer";
import type {
  PrinterCapabilities,
  PrinterDriver,
  PrintPayload,
} from "../driver.types";

/**
 * Produces a real PDF. Used for fallback printing, bulk downloads, testing,
 * and any user without a thermal printer.
 */
export const pdfDriver: PrinterDriver = {
  type: PrinterDriverType.PDF,
  displayName: "PDF Document",
  knownDevices: ["Any PDF viewer", "Desktop printer with label media"],
  isDocumentDriver: true,

  async build(
    documents: LabelDocument[],
    _capabilities: PrinterCapabilities,
    copies: number
  ): Promise<PrintPayload> {
    const result = await pdfRenderer.renderLabelsToPdf(documents, { copies });
    return {
      bytes: result.buffer,
      preview: null, // binary — the UI renders it in a PDF viewer instead
      contentType: "application/pdf",
    };
  },
};

/**
 * Renders SVG previews and prints nothing. The default in development so a
 * developer never accidentally burns a roll of labels.
 */
export const previewDriver: PrinterDriver = {
  type: PrinterDriverType.PREVIEW,
  displayName: "Preview Only (no physical output)",
  knownDevices: ["On-screen preview"],
  isDocumentDriver: true,

  build(
    documents: LabelDocument[],
    _capabilities: PrinterCapabilities,
    copies: number
  ): PrintPayload {
    const svgs = documents.map(
      (document) => svgRenderer.renderLabelToSvg(document, { showBoundary: true }).svg
    );

    // The payload carries the SVG markup so the print-job inspector can show
    // exactly what "would have" printed.
    const combined = svgs.join("\n");
    return {
      bytes: Buffer.from(combined, "utf8"),
      preview: `PREVIEW MODE — ${documents.length} label(s) × ${copies} cop${copies === 1 ? "y" : "ies"}; nothing was sent to a printer.`,
      contentType: "image/svg+xml",
    };
  },
};

/**
 * Accepts and discards. Used to keep a decommissioned printer's history intact
 * without failing new jobs, and as a safe target in automated tests.
 */
export const nullDriver: PrinterDriver = {
  type: PrinterDriverType.NULL,
  displayName: "Null (discard output)",
  knownDevices: ["Test sink"],
  isDocumentDriver: true,

  build(
    documents: LabelDocument[],
    _capabilities: PrinterCapabilities,
    copies: number
  ): PrintPayload {
    return {
      bytes: Buffer.alloc(0),
      preview: `NULL DRIVER — discarded ${documents.length} label(s) × ${copies}.`,
      contentType: "application/octet-stream",
    };
  },
};

/**
 * DYMO label writers speak their own driver protocol rather than a text
 * dialect. Declared so the enum, UI and registry are complete; emits PDF so
 * the job still produces usable output instead of failing.
 */
export const dymoDriver: PrinterDriver = {
  type: PrinterDriverType.DYMO,
  displayName: "DYMO LabelWriter (via PDF)",
  knownDevices: ["DYMO LabelWriter 450", "DYMO LabelWriter 550"],
  isDocumentDriver: true,

  async build(
    documents: LabelDocument[],
    capabilities: PrinterCapabilities,
    copies: number
  ): Promise<PrintPayload> {
    return pdfDriver.build(documents, capabilities, copies);
  },
};
