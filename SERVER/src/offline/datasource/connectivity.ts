// =============================================================================
// CONNECTIVITY MONITOR
//
// Answers exactly one question for the rest of the offline layer: "can this
// edge node reach the cloud right now?"
//
// ── What this deliberately does NOT do ───────────────────────────────────────
// It does not switch which database the POS reads and writes. On an edge node
// that is ALWAYS local SQLite, online or offline — see router.ts for why.
// Connectivity only gates whether the sync engine may run. Keeping those two
// concerns apart is what stops a flapping link from splitting one business
// day's sales across two databases.
//
// ── Hysteresis ───────────────────────────────────────────────────────────────
// A retail broadband link drops packets. Flipping state on a single failure would
// spam the cashier's indicator, restart sync runs constantly, and fill the
// event log with noise. So a transition requires N consecutive probes agreeing
// (configurable; default 2 each way).
//
// ── Why probe the cloud's /health/live rather than a generic internet check ──
// Reaching 8.8.8.8 proves nothing useful: the store can have working internet
// while the cloud server is down or its certificate has expired. The only
// signal that matters is whether the endpoint we must upload to is answering.
// =============================================================================

import { EventEmitter } from "node:events";

import { logger } from "../../config/logger";
import { offlineConfig } from "../config";

// =============================================================================
// TYPES
// =============================================================================

export type ConnectivityState = "online" | "offline" | "unknown";

export interface ConnectivitySnapshot {
  readonly state: ConnectivityState;
  /** Last time a probe succeeded, or null if never in this process. */
  readonly lastOnlineAt: Date | null;
  /** Last time a probe failed. */
  readonly lastOfflineAt: Date | null;
  readonly lastProbeAt: Date | null;
  /** Round-trip time of the last successful probe, in ms. */
  readonly latencyMs: number | null;
  /** Consecutive failures since the last success. */
  readonly consecutiveFailures: number;
  /** Why the last probe failed, if it did. */
  readonly lastError: string | null;
}

export interface ConnectivityChange {
  readonly previous: ConnectivityState;
  readonly current: ConnectivityState;
  readonly at: Date;
}

// =============================================================================
// STATE
// =============================================================================

const emitter = new EventEmitter();

let state: ConnectivityState = "unknown";
let lastOnlineAt: Date | null = null;
let lastOfflineAt: Date | null = null;
let lastProbeAt: Date | null = null;
let latencyMs: number | null = null;
let lastError: string | null = null;

let consecutiveFailures = 0;
let consecutiveSuccesses = 0;

let timer: NodeJS.Timeout | undefined;
/** Guards against overlapping probes when the network is slow. */
let probeInFlight: Promise<boolean> | undefined;

// =============================================================================
// PROBE
// =============================================================================

async function runProbe(): Promise<boolean> {
  const config = offlineConfig();

  if (!config.cloudBaseUrl) {
    lastError = "SYNC_CLOUD_URL is not configured";
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, config.connectivityTimeoutMs);

  const startedAt = Date.now();

  try {
    const response = await fetch(`${config.cloudBaseUrl}/health/live`, {
      method: "GET",
      signal: controller.signal,
      headers: { "x-no-compression": "1" },
    });

    if (!response.ok) {
      lastError = `cloud responded ${response.status}`;
      return false;
    }

    latencyMs = Date.now() - startedAt;
    lastError = null;
    return true;
  } catch (error) {
    // An abort is a timeout, which is the normal offline signal — not a bug.
    lastError = error instanceof Error ? error.message : String(error);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// =============================================================================
// STATE MACHINE
// =============================================================================

function transitionTo(next: ConnectivityState): void {
  if (next === state) return;

  const change: ConnectivityChange = { previous: state, current: next, at: new Date() };
  state = next;

  logger.info(
    { from: change.previous, to: change.current, latencyMs, lastError },
    "offline: connectivity changed"
  );

  emitter.emit("change", change);
}

function recordSuccess(): void {
  const config = offlineConfig();

  lastOnlineAt = new Date();
  consecutiveFailures = 0;
  consecutiveSuccesses += 1;

  if (consecutiveSuccesses >= config.connectivitySuccessThreshold) {
    transitionTo("online");
  }
}

function recordFailure(): void {
  const config = offlineConfig();

  lastOfflineAt = new Date();
  consecutiveSuccesses = 0;
  consecutiveFailures += 1;
  latencyMs = null;

  if (consecutiveFailures >= config.connectivityFailureThreshold) {
    transitionTo("offline");
  }
}

/**
 * Runs one probe and folds the result into the state machine.
 *
 * Concurrent callers share the in-flight probe rather than piling requests onto
 * a link that is already struggling.
 */
export async function probeConnectivity(): Promise<ConnectivityState> {
  probeInFlight ??= (async () => {
    const ok = await runProbe();
    lastProbeAt = new Date();

    if (ok) {
      recordSuccess();
    } else {
      recordFailure();
    }

    return ok;
  })().finally(() => {
    probeInFlight = undefined;
  });

  await probeInFlight;
  return state;
}

// =============================================================================
// LIFECYCLE
// =============================================================================

/** Starts periodic probing. Safe to call twice. */
export function startConnectivityMonitor(): void {
  if (timer !== undefined) return;

  const { connectivityProbeIntervalMs } = offlineConfig();

  // Probe immediately so the first status response after boot is meaningful
  // rather than "unknown", then settle into the interval.
  void probeConnectivity();

  timer = setInterval(() => {
    void probeConnectivity();
  }, connectivityProbeIntervalMs);

  // Do not hold the process open purely to keep probing.
  timer.unref();

  logger.info(
    { intervalMs: connectivityProbeIntervalMs },
    "offline: connectivity monitor started"
  );
}

export function stopConnectivityMonitor(): void {
  if (timer === undefined) return;
  clearInterval(timer);
  timer = undefined;
}

// =============================================================================
// ACCESS
// =============================================================================

export function connectivitySnapshot(): ConnectivitySnapshot {
  return {
    state,
    lastOnlineAt,
    lastOfflineAt,
    lastProbeAt,
    latencyMs,
    consecutiveFailures,
    lastError,
  };
}

export function isOnline(): boolean {
  return state === "online";
}

/** Subscribes to connectivity transitions. Returns an unsubscribe function. */
export function onConnectivityChange(
  listener: (change: ConnectivityChange) => void
): () => void {
  emitter.on("change", listener);
  return () => {
    emitter.off("change", listener);
  };
}

/** Test seam: resets the monitor to a pristine state. */
export function __resetConnectivityForTesting(): void {
  stopConnectivityMonitor();
  state = "unknown";
  lastOnlineAt = null;
  lastOfflineAt = null;
  lastProbeAt = null;
  latencyMs = null;
  lastError = null;
  consecutiveFailures = 0;
  consecutiveSuccesses = 0;
  probeInFlight = undefined;
  emitter.removeAllListeners();
}

/** Test seam: forces a state without probing. */
export function __setConnectivityForTesting(next: ConnectivityState): void {
  transitionTo(next);
}
