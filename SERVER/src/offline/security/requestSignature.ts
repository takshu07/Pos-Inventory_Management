// =============================================================================
// SYNC REQUEST SIGNING
//
// Sync is machine-to-machine. An edge node must be able to drain its queue at
// 2am with nobody logged in, so these requests cannot ride on a cashier's JWT —
// which is also why they need their own, narrower credential rather than a
// long-lived staff token sitting on a shop-floor machine.
//
// ── What a signature covers ──────────────────────────────────────────────────
//     device ‖ timestamp ‖ nonce ‖ method ‖ path ‖ sha256(body)
//
// Binding the METHOD and PATH stops a captured upload signature being replayed
// against a different endpoint. Binding a hash of the BODY stops the payload
// being edited in flight — without it, an attacker who could see one signed
// request could rewrite the sales in it and keep the signature valid.
//
// ── Replay protection is two independent mechanisms ──────────────────────────
//   1. A freshness window (default 5 minutes). Bounds how long a captured
//      request is worth anything at all, and bounds how many nonces the server
//      must remember.
//   2. A single-use nonce. Inside that window, each nonce is accepted exactly
//      once. The window alone is not enough: a five-minute replay of a batch of
//      sales would otherwise be accepted twice.
//
// Idempotency keys make a replayed batch harmless at the DATA layer even if
// both of these failed. That redundancy is deliberate — the two mechanisms
// protect against different mistakes.
//
// This module is pure: it computes and compares. Nonce storage lives with the
// cloud verifier, which has a database to remember them in.
// =============================================================================

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// =============================================================================
// TYPES
// =============================================================================

export interface SignatureHeaders {
  readonly "x-sync-device": string;
  readonly "x-sync-timestamp": string;
  readonly "x-sync-nonce": string;
  readonly "x-sync-signature": string;
}

export interface SignatureInput {
  readonly deviceId: string;
  readonly timestamp: number;
  readonly nonce: string;
  readonly method: string;
  readonly path: string;
  readonly body: string;
}

export type VerificationFailure =
  | "MISSING_HEADERS"
  | "MALFORMED_TIMESTAMP"
  | "EXPIRED"
  | "FUTURE_DATED"
  | "BAD_SIGNATURE";

export type VerificationResult =
  | { readonly ok: true; readonly deviceId: string; readonly nonce: string }
  | { readonly ok: false; readonly reason: VerificationFailure };

// =============================================================================
// CANONICALIZATION
// =============================================================================

export function hashBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/**
 * The exact string both sides sign.
 *
 * Newline-delimited with no escaping, which is safe here only because every
 * component is constrained: the device id and nonce are hex/identifier
 * charsets, the timestamp is digits, and the body appears as a hex digest.
 * None can contain a newline, so no field can be made to look like two.
 */
function canonicalString(input: SignatureInput): string {
  return [
    input.deviceId,
    String(input.timestamp),
    input.nonce,
    input.method.toUpperCase(),
    input.path,
    hashBody(input.body),
  ].join("\n");
}

export function computeSignature(input: SignatureInput, secret: string): string {
  return createHmac("sha256", secret).update(canonicalString(input), "utf8").digest("hex");
}

export function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

// =============================================================================
// SIGNING (edge side)
// =============================================================================

export function signRequest(
  params: {
    readonly deviceId: string;
    readonly method: string;
    readonly path: string;
    readonly body: string;
  },
  secret: string,
  now: number = Date.now()
): SignatureHeaders {
  const nonce = generateNonce();

  const signature = computeSignature(
    { ...params, timestamp: now, nonce },
    secret
  );

  return {
    "x-sync-device": params.deviceId,
    "x-sync-timestamp": String(now),
    "x-sync-nonce": nonce,
    "x-sync-signature": signature,
  };
}

// =============================================================================
// VERIFICATION (cloud side)
// =============================================================================

/**
 * Compares two hex signatures without leaking their contents through timing.
 *
 * A plain `===` on a signature is a genuine vulnerability: it returns as soon
 * as two bytes differ, so response time reveals how many leading bytes were
 * correct, and an attacker can recover the signature one byte at a time.
 */
function signaturesMatch(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");

  // timingSafeEqual throws on a length mismatch, which would itself be a timing
  // signal. Length is not secret, so check it separately and cheaply.
  if (expectedBuffer.length !== providedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function verifyRequest(
  params: {
    readonly headers: Record<string, string | string[] | undefined>;
    readonly method: string;
    readonly path: string;
    readonly body: string;
  },
  secret: string,
  toleranceMs: number,
  now: number = Date.now()
): VerificationResult {
  const read = (name: string): string | undefined => {
    const value = params.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };

  const deviceId = read("x-sync-device");
  const timestampRaw = read("x-sync-timestamp");
  const nonce = read("x-sync-nonce");
  const signature = read("x-sync-signature");

  if (!deviceId || !timestampRaw || !nonce || !signature) {
    return { ok: false, reason: "MISSING_HEADERS" };
  }

  const timestamp = Number.parseInt(timestampRaw, 10);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: "MALFORMED_TIMESTAMP" };
  }

  const drift = now - timestamp;

  if (drift > toleranceMs) {
    return { ok: false, reason: "EXPIRED" };
  }

  // A future-dated request is rejected with the same tolerance. Allowing
  // arbitrary future timestamps would let an attacker mint a signature today
  // that stays valid indefinitely — clock skew needs a window, not a door.
  if (drift < -toleranceMs) {
    return { ok: false, reason: "FUTURE_DATED" };
  }

  const expected = computeSignature(
    {
      deviceId,
      timestamp,
      nonce,
      method: params.method,
      path: params.path,
      body: params.body,
    },
    secret
  );

  if (!signaturesMatch(expected, signature)) {
    return { ok: false, reason: "BAD_SIGNATURE" };
  }

  return { ok: true, deviceId, nonce };
}

/** Human-readable reason, for the audit log. Never returned to the caller. */
export function describeFailure(reason: VerificationFailure): string {
  switch (reason) {
    case "MISSING_HEADERS":
      return "one or more x-sync-* headers were absent";
    case "MALFORMED_TIMESTAMP":
      return "x-sync-timestamp was not an integer";
    case "EXPIRED":
      return "request timestamp is older than the replay window";
    case "FUTURE_DATED":
      return "request timestamp is further ahead than clock skew allows";
    case "BAD_SIGNATURE":
      return "signature did not match the request";
  }
}
