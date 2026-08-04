// =============================================================================
// SYNC CONTROLLER
//
// Thin HTTP adapter over the sync engine. No business logic, no authorization
// decisions — the router tree is where those live.
//
// Handlers split by which side of the protocol they serve:
//   CLOUD  download / upload      authenticated by device signature
//   EDGE   status / run / retry   authenticated by staff JWT
// =============================================================================

import type { Request, Response } from "express";
import { z } from "zod";

import { HTTP_STATUS } from "../../constants/httpStatus";
import { asyncHandler } from "../../utils/asyncHandler";
import { offlineConfig } from "../config";
import { probeConnectivity } from "../datasource/connectivity";
import { applyUploadBatch } from "../sync/cloudApply";
import { serveDownload, UnknownSyncEntityError } from "../sync/cloudServe";
import { runDownload, runFullSync, runUpload } from "../sync/engine";
import { SYNC_PROTOCOL_VERSION } from "../sync/protocol";
import type { UploadRequest, UploadResponse } from "../sync/protocol";
import { retryFailedItems } from "../sync/upload";
import * as syncStatus from "./syncStatus.service";

// =============================================================================
// VALIDATION
// =============================================================================

const downloadQuery = z.object({
  entity: z.string().min(1),
  since: z.string().optional(),
  sinceId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(2000).optional(),
});

const uploadItem = z.object({
  queueId: z.number().int(),
  idempotencyKey: z.string().min(1).max(200),
  entity: z.string().min(1).max(100),
  entityId: z.string().min(1).max(200),
  operation: z.enum(["CREATE", "UPDATE", "DELETE"]),
  payload: z.string().nullable(),
  beforeData: z.string().nullable(),
  localTimestamp: z.string(),
});

const uploadBody = z.object({
  protocolVersion: z.number().int(),
  deviceId: z.string().min(1).max(100),
  batchId: z.string().min(1).max(100),
  // Bounded so one request cannot ask the cloud to hold an unbounded batch in
  // a single transaction; an edge node that wants to send more simply sends
  // more batches.
  items: z.array(uploadItem).min(1).max(1000),
});

const retryBody = z.object({
  ids: z.array(z.number().int()).max(1000).optional(),
});

const runBody = z.object({
  direction: z.enum(["UPLOAD", "DOWNLOAD", "FULL"]).default("FULL"),
  entities: z.array(z.string()).max(100).optional(),
});

// =============================================================================
// CLOUD SIDE
// =============================================================================

/**
 * GET /sync/download — a page of master data.
 *
 * Device-authenticated. The entity name is checked against the sync policy, so
 * a device cannot name an arbitrary table and read it wholesale.
 */
export const download = asyncHandler(async (req: Request, res: Response) => {
  const query = downloadQuery.parse(req.query);

  try {
    const page = await serveDownload({
      entity: query.entity,
      since: query.since,
      sinceId: query.sinceId,
      limit: query.limit,
      deviceId: req.syncDeviceId ?? "unknown",
    });

    return res.status(HTTP_STATUS.OK).json(page);
  } catch (error) {
    if (error instanceof UnknownSyncEntityError) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: error.message,
      });
    }
    throw error;
  }
});

/**
 * POST /sync/upload — apply a batch of queued changes.
 *
 * Always 200 with per-item outcomes, even when some items were rejected. A
 * blanket 4xx would tell the till nothing about WHICH items failed, so it would
 * have to re-send the whole batch forever — including the ones that were
 * applied successfully.
 */
export const upload = asyncHandler(async (req: Request, res: Response) => {
  const body = uploadBody.parse(req.body) as UploadRequest;

  // The signature already proved which device this is. If the body claims to be
  // a different one, something is impersonating — refuse rather than trust the
  // payload over the credential.
  if (req.syncDeviceId !== undefined && body.deviceId !== req.syncDeviceId) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({
      success: false,
      message: "Device id in the body does not match the authenticated device",
    });
  }

  if (body.protocolVersion !== SYNC_PROTOCOL_VERSION) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      message:
        `Unsupported sync protocol version ${body.protocolVersion}; ` +
        `this server speaks ${SYNC_PROTOCOL_VERSION}`,
    });
  }

  const result = await applyUploadBatch(body);

  const response: UploadResponse = {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    batchId: body.batchId,
    results: result.results,
    applied: result.applied,
    duplicates: result.duplicates,
    conflicts: result.conflicts,
    rejected: result.rejected,
    serverTime: new Date().toISOString(),
  };

  return res.status(HTTP_STATUS.OK).json(response);
});

/** GET /sync/devices — the fleet view. OWNER-only. */
export const listDevices = asyncHandler(async (_req: Request, res: Response) => {
  const { getCloudClient } = await import("../../config/prisma");

  const devices = await getCloudClient().syncDevice.findMany({
    orderBy: { lastSeenAt: "desc" },
  });

  return res.status(HTTP_STATUS.OK).json({ success: true, data: devices });
});

/** GET /sync/cloud-conflicts — conflicts recorded centrally. OWNER-only. */
export const listCloudConflicts = asyncHandler(async (req: Request, res: Response) => {
  const { getCloudClient } = await import("../../config/prisma");
  const limit = Math.min(Number(req.query["limit"] ?? 50) || 50, 200);

  const conflicts = await getCloudClient().syncConflictRecord.findMany({
    orderBy: { detectedAt: "desc" },
    take: limit,
  });

  return res.status(HTTP_STATUS.OK).json({ success: true, data: conflicts });
});

// =============================================================================
// EDGE SIDE
// =============================================================================

/** GET /sync/status — what the cashier's indicator reads. */
export const status = asyncHandler(async (_req: Request, res: Response) => {
  const config = offlineConfig();

  // A cloud node answers rather than 404s, so one client build works against
  // both deployments without branching on which it is talking to.
  if (config.role !== "edge") {
    return res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        role: "cloud",
        dataSource: "cloud",
        deviceId: "",
        connectivity: { state: "online", lastOnlineAt: null, latencyMs: null },
        queue: {
          pending: 0,
          failed: 0,
          conflicted: 0,
          inFlight: 0,
          oldestPendingAgeSeconds: null,
        },
        lastDownload: null,
        lastUpload: null,
        syncing: false,
        captureHealthy: true,
      },
    });
  }

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: await syncStatus.getSyncStatus(),
  });
});

/**
 * POST /sync/run — the "Sync Now" button.
 *
 * Responds as soon as the run finishes, but the run itself never blocks a
 * checkout: it holds no lock the POS path needs.
 */
export const run = asyncHandler(async (req: Request, res: Response) => {
  const body = runBody.parse(req.body ?? {});

  const result =
    body.direction === "UPLOAD"
      ? await runUpload("MANUAL")
      : body.direction === "DOWNLOAD"
        ? await runDownload("MANUAL", body.entities === undefined ? {} : { entities: body.entities })
        : await runFullSync("MANUAL");

  // A skipped run is not an error — it means "already syncing" or "no
  // connection", both of which the UI shows as information rather than failure.
  return res.status(HTTP_STATUS.OK).json({ success: true, data: result });
});

/** POST /sync/retry — requeue failed items. */
export const retry = asyncHandler(async (req: Request, res: Response) => {
  const body = retryBody.parse(req.body ?? {});

  const requeued = await retryFailedItems(
    body.ids === undefined ? {} : { ids: body.ids }
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: { requeued },
  });
});

/** GET /sync/history — past runs, for the history screen. */
export const history = asyncHandler(async (req: Request, res: Response) => {
  const limit = Number(req.query["limit"] ?? 50) || 50;

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: await syncStatus.getSyncHistory(limit),
  });
});

/** GET /sync/queue — the queue itself, for diagnosis. */
export const queue = asyncHandler(async (req: Request, res: Response) => {
  const result = await syncStatus.getQueueItems({
    status: typeof req.query["status"] === "string" ? req.query["status"] : undefined,
    limit: Number(req.query["limit"] ?? 100) || 100,
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.items,
    meta: { total: result.total },
  });
});

/** GET /sync/conflicts — locally recorded conflicts. */
export const conflicts = asyncHandler(async (req: Request, res: Response) => {
  const limit = Number(req.query["limit"] ?? 50) || 50;

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: await syncStatus.getConflicts(limit),
  });
});

/** GET /sync/events — the append-only breadcrumb trail. */
export const events = asyncHandler(async (req: Request, res: Response) => {
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: await syncStatus.getSyncEvents({
      runId: typeof req.query["runId"] === "string" ? req.query["runId"] : undefined,
      limit: Number(req.query["limit"] ?? 100) || 100,
    }),
  });
});

/**
 * GET /sync/health — the data-integrity self-check.
 *
 * Returns 503 when unhealthy so an uptime monitor treats a till that has
 * silently stopped capturing writes as DOWN. It is still serving sales
 * perfectly; it is just no longer recording them anywhere that survives.
 */
export const health = asyncHandler(async (_req: Request, res: Response) => {
  if (offlineConfig().role !== "edge") {
    return res.status(HTTP_STATUS.OK).json({
      success: true,
      data: { healthy: true, findings: [], role: "cloud" },
    });
  }

  const report = await syncStatus.runConsistencyCheck();

  return res
    .status(report.healthy ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE)
    .json({ success: report.healthy, data: report });
});

/** POST /sync/probe — force a connectivity check. */
export const probe = asyncHandler(async (_req: Request, res: Response) => {
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: { state: await probeConnectivity() },
  });
});
