// =============================================================================
// DEVICE AUTHENTICATION  (cloud side)
//
// Guards the two machine-to-machine sync endpoints. These cannot use the normal
// `authenticate` JWT middleware: an edge node drains its queue at 2am with
// nobody logged in, and parking a long-lived staff token on a shop-floor PC to
// work around that would be strictly worse than a purpose-built device
// credential.
//
// Three checks, in the cheapest-first order that also fails safest:
//
//   1. Signature      HMAC-SHA256 over method, path, body hash and timestamp.
//      + freshness    Pure computation; no database round trip for a request
//                     that was never going to be valid.
//   2. Nonce          Single-use, enforced by a UNIQUE primary key. This is the
//                     database round trip, so it runs only on requests that
//                     already proved they hold the secret.
//   3. Device status  A deactivated device (stolen till, decommissioned store)
//                     is refused even with a valid signature.
//
// ── Why a valid signature is not enough on its own ───────────────────────────
// A signature proves the request was authored by someone holding the secret. It
// does NOT prove the request is new — an attacker who captured one upload can
// resend those bytes verbatim and the signature still verifies. The nonce is
// what makes each request usable exactly once. The freshness window bounds how
// long a captured request is worth anything, and bounds how many nonces the
// cloud has to remember.
//
// The idempotency ledger would make a replayed BATCH harmless at the data
// layer even if this whole middleware were bypassed. That redundancy is
// deliberate: these two defend against different mistakes, and neither is asked
// to be the only one.
// =============================================================================

import type { NextFunction, Request, Response } from "express";

import { logger } from "../../config/logger";
import { getCloudClient } from "../../config/prisma";
import { HTTP_STATUS } from "../../constants/httpStatus";
import { offlineConfig } from "../config";
import { describeFailure, verifyRequest } from "../security/requestSignature";

// =============================================================================
// REQUEST AUGMENTATION
// =============================================================================

declare module "express-serve-static-core" {
  interface Request {
    /** Set by `authenticateDevice` once a request is proven authentic. */
    syncDeviceId?: string;
    /** Raw request body, captured before JSON parsing. Needed to verify. */
    rawSyncBody?: string;
  }
}

// =============================================================================
// RAW BODY CAPTURE
// =============================================================================

/**
 * `verify` hook for the JSON body parser on the sync router.
 *
 * The signature is computed over the exact bytes the edge node serialized. By
 * the time `req.body` exists it has been through JSON.parse and re-serializing
 * it would not reproduce those bytes — key order and number formatting are not
 * guaranteed to survive the round trip, and a single reordered key breaks every
 * signature.
 *
 * body-parser inflates gzip BEFORE calling this, so what lands here is the
 * uncompressed JSON the device signed, regardless of transfer encoding.
 */
export function captureRawSyncBody(
  req: Request,
  _res: Response,
  buffer: Buffer
): void {
  req.rawSyncBody = buffer.toString("utf8");
}

// =============================================================================
// NONCE STORE
// =============================================================================

/**
 * Consumes a nonce, returning false if it has been seen before.
 *
 * Correctness rests on the PRIMARY KEY, not on a preceding SELECT: two copies
 * of a replayed request arriving concurrently would both pass a read check, and
 * exactly one can win the insert.
 */
async function consumeNonce(nonce: string, deviceId: string): Promise<boolean> {
  const prisma = getCloudClient();
  const expiresAt = new Date(Date.now() + offlineConfig().signatureToleranceMs);

  try {
    await prisma.syncNonce.create({ data: { nonce, deviceId, expiresAt } });
    return true;
  } catch (error) {
    // P2002 — unique violation. That is a replay, which is the expected
    // failure here rather than an exceptional one.
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P2002"
    ) {
      return false;
    }

    throw error;
  }
}

/**
 * Deletes expired nonces.
 *
 * Called opportunistically rather than on a timer: the table only ever needs to
 * hold one replay window, and a sweep on a fraction of requests keeps it that
 * size without another background job to operate and monitor.
 */
async function pruneNoncesOccasionally(): Promise<void> {
  if (Math.random() > 0.02) return;

  try {
    const prisma = getCloudClient();
    await prisma.syncNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch (err) {
    logger.warn({ err }, "offline: nonce prune failed (non-fatal)");
  }
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

function refuse(res: Response, message: string): void {
  // Every failure returns the SAME status and the SAME body. Distinguishing
  // "bad signature" from "unknown device" from "replayed nonce" would tell an
  // attacker which half of the credential they got right, and turn blind
  // guessing into a guided search.
  res.status(HTTP_STATUS.UNAUTHORIZED).json({
    success: false,
    message: "Sync authentication failed",
  });

  logger.warn({ reason: message }, "offline: rejected sync request");
}

export async function authenticateDevice(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const config = offlineConfig();

  if (!config.enabled) {
    res.status(HTTP_STATUS.NOT_FOUND).json({
      success: false,
      message: "Synchronization is not enabled on this server",
    });
    return;
  }

  if (!config.deviceSecret) {
    logger.error("offline: SYNC_DEVICE_SECRET is unset; refusing all sync requests");
    refuse(res, "server has no device secret configured");
    return;
  }

  // `req.originalUrl` is the path the client actually signed, including the
  // query string. `req.path` is stripped of the router mount prefix, so using
  // it would compute a different canonical string and fail every signature.
  const verification = verifyRequest(
    {
      headers: req.headers as Record<string, string | string[] | undefined>,
      method: req.method,
      path: req.originalUrl,
      body: req.rawSyncBody ?? "",
    },
    config.deviceSecret,
    config.signatureToleranceMs
  );

  if (!verification.ok) {
    refuse(res, describeFailure(verification.reason));
    return;
  }

  try {
    const fresh = await consumeNonce(verification.nonce, verification.deviceId);

    if (!fresh) {
      refuse(res, `replayed nonce from device ${verification.deviceId}`);
      return;
    }

    const device = await getCloudClient().syncDevice.findUnique({
      where: { deviceId: verification.deviceId },
    });

    // An UNKNOWN device is allowed through — that is how a till enrolls on its
    // first sync, and it already had to hold the shared secret to get here. A
    // device explicitly DEACTIVATED is not: that is the kill switch for a
    // stolen or decommissioned machine, and it must beat a valid signature.
    if (device !== null && !device.isActive) {
      refuse(res, `device ${verification.deviceId} is deactivated`);
      return;
    }

    req.syncDeviceId = verification.deviceId;

    void pruneNoncesOccasionally();

    next();
  } catch (err) {
    logger.error({ err }, "offline: device authentication failed unexpectedly");
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Sync authentication error",
    });
  }
}
