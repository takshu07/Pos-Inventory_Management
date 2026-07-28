// =============================================================================
// PRINTER SERVICE
//
// The ONE place that decides how a job physically reaches the world:
//
//   PREVIEW → render SVG, send nothing
//   PDF     → produce a real document
//   THERMAL → driver + transport to a device
//
// "The rest of the application must not know which mode is active. Only
// PrinterService changes." — this file is that seam. The queue asks it to
// execute a job; it resolves driver, transport and capabilities and reports a
// typed result. No caller branches on output mode.
// =============================================================================

import {
  PrinterConnectionType,
  PrinterDriverType,
  PrinterStatus,
  PrintOutputMode,
} from "../../generated/prisma";
import { logger } from "../config/logger";
import { getDriver } from "../engines/label/printers/driver.registry";
import type {
  PrintErrorCode,
  PrinterCapabilities,
  PrintPayload,
  TransportTarget,
} from "../engines/label/printers/driver.types";
import { getTransport } from "../engines/label/printers/transports";
import type { LabelDocument } from "../engines/label/label.types";
import {
  printerRepository,
  type PrinterRow,
} from "../repositories/printer.repository";

/** Maps the persisted connection enum onto a transport registry key. */
function transportKindFor(connection: PrinterConnectionType): string {
  switch (connection) {
    case PrinterConnectionType.NETWORK:
      return "network";
    case PrinterConnectionType.USB:
      return "usb";
    case PrinterConnectionType.BLUETOOTH:
      return "bluetooth";
    case PrinterConnectionType.CLOUD:
      return "cloud";
    case PrinterConnectionType.VIRTUAL:
    default:
      return "virtual";
  }
}

function toNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function capabilitiesFor(printer: PrinterRow | null): PrinterCapabilities {
  return {
    dpi: printer?.dpi ?? 203,
    widthMm: toNumber(printer?.defaultWidthMm, 50),
    heightMm: toNumber(printer?.defaultHeightMm, 25),
    darkness: printer?.darkness ?? 8,
    printSpeed: printer?.printSpeed ?? 4,
  };
}

export interface ExecuteResult {
  ok: boolean;
  bytesWritten: number;
  /** Populated for PDF/preview output so the caller can stream it. */
  payload?: PrintPayload;
  error?: string;
  errorCode?: PrintErrorCode;
  /** False for errors that retrying cannot fix (bad template, bad symbology). */
  retryable: boolean;
}

/**
 * Resolves the driver to use for a job.
 *
 * Output mode WINS over the printer's configured driver: a PDF job must produce
 * a PDF even when it targets a Zebra, which is what makes the same job
 * definition work in development, testing and production unchanged.
 */
function resolveDriverType(
  output: PrintOutputMode,
  printer: PrinterRow | null
): PrinterDriverType {
  if (output === PrintOutputMode.PDF) return PrinterDriverType.PDF;
  if (output === PrintOutputMode.PREVIEW) return PrinterDriverType.PREVIEW;
  // THERMAL — use the device's own dialect, defaulting to the most common.
  return printer?.driver ?? PrinterDriverType.ESC_POS;
}

/**
 * Builds and delivers a print job.
 *
 * Never throws: every failure is returned as a typed ExecuteResult so the queue
 * can decide retry vs. fail without a try/catch around business logic.
 */
export async function execute(
  documents: LabelDocument[],
  options: {
    printer: PrinterRow | null;
    output: PrintOutputMode;
    copies: number;
  }
): Promise<ExecuteResult> {
  const { printer, output, copies } = options;

  if (documents.length === 0) {
    return {
      ok: false,
      bytesWritten: 0,
      error: "Nothing to print — the job has no resolvable labels.",
      retryable: false,
    };
  }

  const driverType = resolveDriverType(output, printer);
  const capabilities = capabilitiesFor(printer);

  // ── Build the payload ──────────────────────────────────────────────────────
  let payload: PrintPayload;
  try {
    payload = await getDriver(driverType).build(documents, capabilities, copies);
  } catch (err) {
    // A build failure is a template/data problem. Retrying is pointless.
    return {
      ok: false,
      bytesWritten: 0,
      error: err instanceof Error ? err.message : "Failed to build print payload.",
      errorCode: "DRIVER_ERROR",
      retryable: false,
    };
  }

  // ── PREVIEW / PDF: no device involved ──────────────────────────────────────
  // The payload IS the deliverable; the caller streams or stores it.
  if (output === PrintOutputMode.PREVIEW || output === PrintOutputMode.PDF) {
    return { ok: true, bytesWritten: payload.bytes.length, payload, retryable: false };
  }

  // ── THERMAL: deliver to hardware ───────────────────────────────────────────
  if (!printer) {
    return {
      ok: false,
      bytesWritten: 0,
      error: "No printer selected for a thermal print job.",
      errorCode: "PRINTER_OFFLINE",
      // Retryable: the user can assign a printer and retry the same job.
      retryable: true,
    };
  }

  const transport = getTransport(transportKindFor(printer.connection));

  if (!transport.isAvailable) {
    return {
      ok: false,
      bytesWritten: 0,
      error: transport.unavailableReason ?? `${transport.displayName} is unavailable.`,
      errorCode: "TRANSPORT_UNSUPPORTED",
      // No retry will make an uninstalled transport work.
      retryable: false,
    };
  }

  const target: TransportTarget = {
    kind: transport.kind,
    host: printer.host,
    port: printer.port,
    devicePath: printer.devicePath,
    vendorId: printer.vendorId,
    productId: printer.productId,
    endpointUrl: printer.endpointUrl,
    timeoutMs: 10000,
  };

  const result = await transport.send(payload, target);

  // Keep the printer's status fresh from real outcomes — this is what drives
  // the online/offline indicator without a separate polling loop.
  await printerRepository
    .recordStatus(
      printer.id,
      result.ok ? PrinterStatus.ONLINE : PrinterStatus.OFFLINE,
      result.error ?? null
    )
    .catch((err) =>
      logger.warn({ err, printerId: printer.id }, "[PrinterService] Status update failed")
    );

  return {
    ok: result.ok,
    bytesWritten: result.bytesWritten,
    ...(result.error !== undefined && { error: result.error }),
    ...(result.errorCode !== undefined && { errorCode: result.errorCode }),
    // Connectivity problems are worth retrying; configuration errors are not.
    retryable:
      result.errorCode === "PRINTER_OFFLINE" ||
      result.errorCode === "PRINTER_TIMEOUT" ||
      result.errorCode === "PRINTER_UNREACHABLE" ||
      result.errorCode === "TRANSPORT_ERROR",
  };
}

/**
 * Probes a printer and records the result.
 *
 * Used by the printer-management screen's status column and the "Test
 * connection" button. Never throws.
 */
export async function probe(
  printer: PrinterRow
): Promise<{ online: boolean; error?: string }> {
  const transport = getTransport(transportKindFor(printer.connection));

  if (!transport.isAvailable) {
    await printerRepository
      .recordStatus(printer.id, PrinterStatus.ERROR, transport.unavailableReason)
      .catch(() => {});
    return {
      online: false,
      ...(transport.unavailableReason !== undefined && {
        error: transport.unavailableReason,
      }),
    };
  }

  const result = await transport.probe({
    kind: transport.kind,
    host: printer.host,
    port: printer.port,
    devicePath: printer.devicePath,
    endpointUrl: printer.endpointUrl,
    timeoutMs: 3000,
  });

  await printerRepository
    .recordStatus(
      printer.id,
      result.online ? PrinterStatus.ONLINE : PrinterStatus.OFFLINE,
      result.error ?? null
    )
    .catch(() => {});

  return result;
}

export const printerService = { execute, probe } as const;
