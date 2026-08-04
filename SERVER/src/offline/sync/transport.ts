// =============================================================================
// SYNC TRANSPORT
//
// The edge node's HTTP client for talking to the cloud. Signs every request,
// compresses bodies worth compressing, and distinguishes the two kinds of
// failure that matter.
//
// ── Retryable vs terminal, and why the difference is load-bearing ────────────
// Retrying a TIMEOUT is correct: the link is bad, try later.
// Retrying a 400 is not: the payload is malformed and will be malformed forever,
// so a retry loop would hammer the cloud until someone notices.
//
// Getting this wrong in the other direction is worse. A 5xx or a dropped socket
// is AMBIGUOUS — the write may well have landed, and only the response was
// lost. Those are retried, and it is the idempotency ledger on the cloud that
// makes the retry safe. Transport is allowed to be optimistic precisely because
// the data layer is not.
//
// ── Compression ──────────────────────────────────────────────────────────────
// Upload bodies are gzipped above a threshold. A day of sales is highly
// repetitive JSON and compresses ~8-10x, which on a rural 3G link is the
// difference between a sync that completes and one that times out. Express's
// body parser inflates transparently on the far side, and the SIGNATURE is
// computed over the uncompressed bytes so the two sides agree on what was
// signed regardless of encoding.
// =============================================================================

import { gzip } from "node:zlib";
import { promisify } from "node:util";

import { logger } from "../../config/logger";
import { offlineConfig } from "../config";
import { signRequest } from "../security/requestSignature";

const gzipAsync = promisify(gzip);

// =============================================================================
// ERRORS
// =============================================================================

export class SyncTransportError extends Error {
  constructor(
    message: string,
    /** True when trying again later could plausibly succeed. */
    readonly retryable: boolean,
    readonly status?: number,
    readonly responseBody?: string
  ) {
    super(message);
    this.name = "SyncTransportError";
  }
}

/**
 * Classifies an HTTP status.
 *
 *   408 Request Timeout, 429 Too Many Requests, 5xx  → retryable
 *   401/403                                          → terminal; the device
 *                                                      credential is wrong and
 *                                                      no amount of retrying
 *                                                      fixes it. Surfacing it
 *                                                      immediately is what gets
 *                                                      it noticed.
 *   Other 4xx                                        → terminal
 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

// =============================================================================
// REQUEST
// =============================================================================

interface RequestOptions {
  readonly method: "GET" | "POST";
  /** Path under the cloud base URL, e.g. "/api/v1/sync/upload". */
  readonly path: string;
  readonly query?: Record<string, string | number | undefined>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
}

interface TransportResult<T> {
  readonly data: T;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly durationMs: number;
}

function buildUrl(base: string, path: string, query?: RequestOptions["query"]): string {
  const url = new URL(`${base}${path}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  return url.toString();
}

/**
 * Performs one signed request. Does NOT retry — retry policy belongs to the
 * caller, which knows whether the operation is safe to repeat and how it wants
 * to record the attempt.
 */
export async function syncRequest<T>(options: RequestOptions): Promise<TransportResult<T>> {
  const config = offlineConfig();

  if (!config.cloudBaseUrl) {
    throw new SyncTransportError("SYNC_CLOUD_URL is not configured", false);
  }

  const url = buildUrl(config.cloudBaseUrl, options.path, options.query);
  const bodyText = options.body === undefined ? "" : JSON.stringify(options.body);

  // The signature covers the path WITH its query string, so a download cursor
  // cannot be rewritten in flight to make a till skip rows.
  const signedPath = new URL(url).pathname + new URL(url).search;

  const headers: Record<string, string> = {
    ...signRequest(
      {
        deviceId: config.deviceId,
        method: options.method,
        path: signedPath,
        body: bodyText,
      },
      config.deviceSecret
    ),
    accept: "application/json",
  };

  let payload: Buffer | undefined;

  if (bodyText !== "") {
    headers["content-type"] = "application/json";

    const raw = Buffer.from(bodyText, "utf8");

    if (raw.byteLength >= config.compressionThresholdBytes) {
      payload = await gzipAsync(raw);
      headers["content-encoding"] = "gzip";
    } else {
      payload = raw;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? 60_000);

  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: options.method,
      headers,
      ...(payload === undefined ? {} : { body: new Uint8Array(payload) }),
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new SyncTransportError(
        `cloud responded ${response.status}`,
        isRetryableStatus(response.status),
        response.status,
        text.slice(0, 2000)
      );
    }

    return {
      data: JSON.parse(text) as T,
      bytesSent: payload?.byteLength ?? 0,
      bytesReceived: Buffer.byteLength(text, "utf8"),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof SyncTransportError) throw error;

    // AbortError (timeout) and every network-level failure land here. All are
    // ambiguous — the request may have been applied — so all are retryable.
    const message = error instanceof Error ? error.message : String(error);
    throw new SyncTransportError(`sync request failed: ${message}`, true);
  } finally {
    clearTimeout(timeout);
  }
}

// =============================================================================
// BACKOFF
// =============================================================================

/**
 * Exponential backoff with full jitter.
 *
 * The jitter is not cosmetic. When a store's link returns, every queued item
 * becomes eligible at once; without jitter their retries stay in lockstep and
 * arrive as a synchronized burst, which is exactly the shape of traffic that
 * knocks the cloud over just as it is most needed.
 */
export function backoffDelayMs(attempt: number): number {
  const { baseBackoffMs, maxBackoffMs } = offlineConfig().retry;

  const exponential = Math.min(baseBackoffMs * 2 ** Math.max(0, attempt - 1), maxBackoffMs);

  return Math.floor(Math.random() * exponential);
}

/** True when an item has exhausted its attempts and should be parked. */
export function isExhausted(attempts: number): boolean {
  return attempts >= offlineConfig().retry.maxAttempts;
}

export function logTransportFailure(context: string, error: unknown): void {
  if (error instanceof SyncTransportError) {
    logger.warn(
      { context, status: error.status, retryable: error.retryable, body: error.responseBody },
      `offline: ${context} failed — ${error.message}`
    );
    return;
  }

  logger.error({ context, err: error }, `offline: ${context} failed unexpectedly`);
}
