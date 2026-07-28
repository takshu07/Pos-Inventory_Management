// =============================================================================
// PRINTER DRIVER & TRANSPORT CONTRACTS
//
// Two independent axes, deliberately kept separate:
//
//   DRIVER    what bytes to send   (ESC/POS, TSPL, ZPL, PDF, …)
//   TRANSPORT how to deliver them  (network socket, USB, file, in-memory)
//
// Splitting them means a Zebra printer on the network and a Zebra printer on
// USB share one driver, and an ESC/POS and a TSPL printer on the same network
// share one transport. Without the split you get a combinatorial explosion of
// "ZebraNetworkPrinter", "ZebraUsbPrinter", … classes.
//
// Consequence, and the point of the whole design: adding a manufacturer means
// adding ONE driver object to the registry. No route, controller, service,
// queue, component or frontend file changes. That is the "changing printer
// brands should never require frontend changes" requirement, enforced by the
// type system rather than by convention.
// =============================================================================

import type { PrinterDriverType } from "../../../../generated/prisma";
import type { LabelDocument } from "../label.types";

/** Everything a driver needs to know about the target device. */
export interface PrinterCapabilities {
  /** Dots per inch of the print head — drives mm → dots conversion. */
  dpi: number;
  /** Media width in millimetres. */
  widthMm: number;
  /** Media height in millimetres. */
  heightMm: number;
  /** Burn/contrast setting, 0–15 on most thermal heads. */
  darkness: number;
  /** Feed speed, 1–6 on most thermal heads (inches/sec). */
  printSpeed: number;
}

/** The payload a driver produces, ready for a transport to deliver. */
export interface PrintPayload {
  /** Raw bytes to write to the device. */
  bytes: Buffer;
  /**
   * Human-readable form of the command stream, for the print-job inspector and
   * for debugging a misbehaving printer without attaching a serial sniffer.
   * Populated for text-based dialects (ESC/POS, TSPL, ZPL); null for PDF.
   */
  preview: string | null;
  /** MIME type — lets the PDF driver stream a downloadable response. */
  contentType: string;
}

/**
 * Translates label documents into a device's command dialect.
 *
 * A driver is PURE: it performs no I/O and holds no connection. That makes
 * every driver trivially unit-testable (assert on the bytes) and means a
 * driver can be exercised with no hardware attached.
 */
export interface PrinterDriver {
  type: PrinterDriverType;
  /** Name shown in the printer-management UI. */
  displayName: string;
  /** Manufacturers/models known to speak this dialect — shown as help text. */
  knownDevices: string[];
  /**
   * True when the driver emits a document (PDF) rather than device commands.
   * The queue uses this to decide whether a transport is needed at all.
   */
  isDocumentDriver: boolean;

  /** Builds the command stream for a batch of labels. */
  build(
    documents: LabelDocument[],
    capabilities: PrinterCapabilities,
    copies: number
  ): Promise<PrintPayload> | PrintPayload;
}

// ─── Transports ───────────────────────────────────────────────────────────────

export type TransportKind = "network" | "usb" | "bluetooth" | "cloud" | "virtual";

/** Coordinates for reaching a device. Which fields matter depends on the kind. */
export interface TransportTarget {
  kind: TransportKind;
  host?: string | null;
  port?: number | null;
  devicePath?: string | null;
  vendorId?: string | null;
  productId?: string | null;
  endpointUrl?: string | null;
  /** Milliseconds before a connection or write attempt is abandoned. */
  timeoutMs?: number;
}

export interface TransportResult {
  ok: boolean;
  /** Bytes actually written — used for the job's completion record. */
  bytesWritten: number;
  error?: string;
  /** Machine-readable failure cause so the UI can offer the right recovery. */
  errorCode?: PrintErrorCode;
}

/**
 * Failure taxonomy. The UI maps these to actions: OFFLINE offers "retry /
 * change printer", MEDIA_OUT tells the user to load labels, UNSUPPORTED
 * indicates a configuration mistake no retry will fix.
 */
export type PrintErrorCode =
  | "PRINTER_OFFLINE"
  | "PRINTER_UNREACHABLE"
  | "PRINTER_TIMEOUT"
  | "MEDIA_OUT"
  | "TRANSPORT_UNSUPPORTED"
  | "TRANSPORT_ERROR"
  | "DRIVER_ERROR";

/** Delivers bytes to a device. The only layer permitted to do device I/O. */
export interface PrinterTransport {
  kind: TransportKind;
  displayName: string;
  /**
   * False for transports that are declared but not operational in this
   * deployment (USB today). Lets the UI grey out the option with a reason
   * instead of failing at print time.
   */
  isAvailable: boolean;
  /** Reason shown when isAvailable is false. */
  unavailableReason?: string;

  /** Writes the payload. Must never throw — returns a typed failure instead. */
  send(payload: PrintPayload, target: TransportTarget): Promise<TransportResult>;

  /**
   * Cheap reachability probe for the printer-status indicator. Must not print
   * anything and must never throw.
   */
  probe(target: TransportTarget): Promise<{ online: boolean; error?: string }>;
}
