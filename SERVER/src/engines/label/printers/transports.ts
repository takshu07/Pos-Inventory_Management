// =============================================================================
// PRINTER TRANSPORTS
//
// The ONLY layer permitted to perform device I/O. Drivers build bytes;
// transports deliver them.
//
// NetworkTransport is fully operational — virtually every commercial thermal
// label printer exposes a raw TCP socket on port 9100 (the JetDirect/RAW
// standard), so this covers real hardware today with no native dependencies.
//
// UsbTransport is a declared SEAM, not a stub-by-omission: it implements the
// interface, reports isAvailable=false with an actionable reason, and returns
// a typed TRANSPORT_UNSUPPORTED failure. The UI greys it out rather than
// letting a user queue a job that can never succeed. Wiring real USB means
// implementing send()/probe() here — nothing else in the system changes.
// =============================================================================

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { logger } from "../../../config/logger";
import type {
  PrinterTransport,
  PrintPayload,
  TransportResult,
  TransportTarget,
} from "./driver.types";

/** Default raw-printing port (JetDirect / RAW), used by nearly all label printers. */
const DEFAULT_RAW_PORT = 9100;
const DEFAULT_TIMEOUT_MS = 8000;

// ─── Network (real) ───────────────────────────────────────────────────────────

export const networkTransport: PrinterTransport = {
  kind: "network",
  displayName: "Network (TCP/IP)",
  isAvailable: true,

  async send(payload: PrintPayload, target: TransportTarget): Promise<TransportResult> {
    const host = target.host;
    if (!host) {
      return {
        ok: false,
        bytesWritten: 0,
        error: "No host configured for this network printer.",
        errorCode: "TRANSPORT_ERROR",
      };
    }

    const port = target.port ?? DEFAULT_RAW_PORT;
    const timeoutMs = target.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<TransportResult>((resolve) => {
      // settle() guarantees exactly one resolution and one socket teardown no
      // matter which event fires first — without it a printer that errors
      // *after* connecting would resolve twice and leak the socket.
      let settled = false;
      const socket = new net.Socket();

      const settle = (result: TransportResult) => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);

      socket.on("timeout", () =>
        settle({
          ok: false,
          bytesWritten: 0,
          error: `Printer at ${host}:${port} did not respond within ${timeoutMs}ms.`,
          errorCode: "PRINTER_TIMEOUT",
        })
      );

      socket.on("error", (err: NodeJS.ErrnoException) => {
        // Map the OS error to our taxonomy so the UI can offer the right fix.
        const errorCode =
          err.code === "ECONNREFUSED" || err.code === "EHOSTUNREACH"
            ? "PRINTER_OFFLINE"
            : err.code === "ETIMEDOUT"
              ? "PRINTER_TIMEOUT"
              : "PRINTER_UNREACHABLE";
        settle({
          ok: false,
          bytesWritten: 0,
          error: `${err.code ?? "ERROR"}: could not reach printer at ${host}:${port}.`,
          errorCode,
        });
      });

      socket.connect(port, host, () => {
        socket.write(payload.bytes, (writeError) => {
          if (writeError) {
            settle({
              ok: false,
              bytesWritten: 0,
              error: `Write failed: ${writeError.message}`,
              errorCode: "TRANSPORT_ERROR",
            });
            return;
          }
          // end() flushes before FIN; the printer buffers the job internally,
          // so a successful flush is our completion signal (raw TCP printing
          // has no application-level acknowledgement).
          socket.end(() =>
            settle({ ok: true, bytesWritten: payload.bytes.length })
          );
        });
      });
    });
  },

  async probe(target: TransportTarget): Promise<{ online: boolean; error?: string }> {
    const host = target.host;
    if (!host) return { online: false, error: "No host configured." };

    const port = target.port ?? DEFAULT_RAW_PORT;
    // Probes must stay snappy — this runs for every printer on the status grid.
    const timeoutMs = Math.min(target.timeoutMs ?? 3000, 5000);

    return new Promise((resolve) => {
      let settled = false;
      const socket = new net.Socket();
      const settle = (result: { online: boolean; error?: string }) => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);
      socket.on("timeout", () => settle({ online: false, error: "Timed out." }));
      socket.on("error", (err) => settle({ online: false, error: err.message }));
      socket.connect(port, host, () => settle({ online: true }));
    });
  },
};

// ─── USB (seam) ───────────────────────────────────────────────────────────────

const USB_UNAVAILABLE_REASON =
  "USB printing requires a native USB bridge (e.g. node-usb or a local print " +
  "agent), which is not installed in this deployment. Use a network printer, " +
  "or connect this printer via its network interface.";

export const usbTransport: PrinterTransport = {
  kind: "usb",
  displayName: "USB",
  isAvailable: false,
  unavailableReason: USB_UNAVAILABLE_REASON,

  async send(): Promise<TransportResult> {
    return {
      ok: false,
      bytesWritten: 0,
      error: USB_UNAVAILABLE_REASON,
      errorCode: "TRANSPORT_UNSUPPORTED",
    };
  },

  async probe(): Promise<{ online: boolean; error?: string }> {
    return { online: false, error: USB_UNAVAILABLE_REASON };
  },
};

// ─── Bluetooth (seam) ─────────────────────────────────────────────────────────

const BLUETOOTH_UNAVAILABLE_REASON =
  "Bluetooth printing requires a native Bluetooth serial bridge, which is not " +
  "installed in this deployment.";

export const bluetoothTransport: PrinterTransport = {
  kind: "bluetooth",
  displayName: "Bluetooth",
  isAvailable: false,
  unavailableReason: BLUETOOTH_UNAVAILABLE_REASON,

  async send(): Promise<TransportResult> {
    return {
      ok: false,
      bytesWritten: 0,
      error: BLUETOOTH_UNAVAILABLE_REASON,
      errorCode: "TRANSPORT_UNSUPPORTED",
    };
  },

  async probe(): Promise<{ online: boolean; error?: string }> {
    return { online: false, error: BLUETOOTH_UNAVAILABLE_REASON };
  },
};

// ─── Cloud (seam) ─────────────────────────────────────────────────────────────

/**
 * Posts the payload to a remote print endpoint. Implemented against fetch so
 * it works today against any HTTP print relay, which is the common shape for
 * cloud/remote print servers.
 */
export const cloudTransport: PrinterTransport = {
  kind: "cloud",
  displayName: "Cloud / Remote Print Server",
  isAvailable: true,

  async send(payload: PrintPayload, target: TransportTarget): Promise<TransportResult> {
    const endpoint = target.endpointUrl;
    if (!endpoint) {
      return {
        ok: false,
        bytesWritten: 0,
        error: "No endpoint URL configured for this cloud printer.",
        errorCode: "TRANSPORT_ERROR",
      };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        target.timeoutMs ?? DEFAULT_TIMEOUT_MS
      );

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": payload.contentType },
        body: new Uint8Array(payload.bytes),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        return {
          ok: false,
          bytesWritten: 0,
          error: `Print server responded ${response.status} ${response.statusText}.`,
          errorCode: "TRANSPORT_ERROR",
        };
      }
      return { ok: true, bytesWritten: payload.bytes.length };
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return {
        ok: false,
        bytesWritten: 0,
        error: aborted
          ? "Print server did not respond in time."
          : err instanceof Error
            ? err.message
            : "Cloud print failed.",
        errorCode: aborted ? "PRINTER_TIMEOUT" : "TRANSPORT_ERROR",
      };
    }
  },

  async probe(target: TransportTarget): Promise<{ online: boolean; error?: string }> {
    if (!target.endpointUrl) return { online: false, error: "No endpoint URL." };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(target.endpointUrl, {
        method: "HEAD",
        signal: controller.signal,
      });
      clearTimeout(timer);
      return { online: response.ok };
    } catch (err) {
      return {
        online: false,
        error: err instanceof Error ? err.message : "Unreachable.",
      };
    }
  },
};

// ─── Virtual ──────────────────────────────────────────────────────────────────

/**
 * Writes the payload to disk instead of a device.
 *
 * This is what makes the whole pipeline verifiable with no hardware: a job runs
 * through the real queue, the real driver and a real transport, and the bytes
 * land in a file you can inspect. Used by PREVIEW/PDF output modes.
 */
export const virtualTransport: PrinterTransport = {
  kind: "virtual",
  displayName: "Virtual (write to file)",
  isAvailable: true,

  async send(payload: PrintPayload, target: TransportTarget): Promise<TransportResult> {
    // Nothing to write for drivers that produce no bytes (null driver).
    if (payload.bytes.length === 0) {
      return { ok: true, bytesWritten: 0 };
    }

    try {
      const directory = target.devicePath
        ? path.dirname(target.devicePath)
        : path.resolve(process.cwd(), "print-output");
      await mkdir(directory, { recursive: true });

      const extension =
        payload.contentType === "application/pdf"
          ? "pdf"
          : payload.contentType === "image/svg+xml"
            ? "svg"
            : "bin";
      const filePath =
        target.devicePath ??
        path.join(directory, `label-${Date.now()}.${extension}`);

      await new Promise<void>((resolve, reject) => {
        const stream = createWriteStream(filePath);
        stream.on("error", reject);
        stream.on("finish", () => resolve());
        stream.end(payload.bytes);
      });

      logger.debug({ filePath, bytes: payload.bytes.length }, "[LabelEngine] Virtual print written");
      return { ok: true, bytesWritten: payload.bytes.length };
    } catch (err) {
      return {
        ok: false,
        bytesWritten: 0,
        error: err instanceof Error ? err.message : "Failed to write print output.",
        errorCode: "TRANSPORT_ERROR",
      };
    }
  },

  async probe(): Promise<{ online: boolean; error?: string }> {
    return { online: true };
  },
};

// ─── Registry ─────────────────────────────────────────────────────────────────

const TRANSPORTS: Record<string, PrinterTransport> = {
  network: networkTransport,
  usb: usbTransport,
  bluetooth: bluetoothTransport,
  cloud: cloudTransport,
  virtual: virtualTransport,
};

export function getTransport(kind: string): PrinterTransport {
  return TRANSPORTS[kind] ?? virtualTransport;
}

export function listTransports(): PrinterTransport[] {
  return Object.values(TRANSPORTS);
}
