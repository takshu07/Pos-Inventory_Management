// =============================================================================
// SYNC ENGINE — orchestration
//
// Ties download, upload and bookkeeping into runs, and decides when they
// happen. Everything below is edge-node behavior; a cloud node has no engine,
// it only answers requests.
//
// ── One run at a time ────────────────────────────────────────────────────────
// A single in-process lock serializes runs. Two concurrent drains would claim
// overlapping batches and send the same sales twice — harmless thanks to the
// idempotency ledger, but it doubles the traffic on the link that was already
// the bottleneck, and it makes the progress numbers on the cashier's screen
// nonsense.
//
// ── Background sync must never block the cashier ─────────────────────────────
// Every path here is fire-and-forget from the request's point of view. Nothing
// in a checkout waits on the network — that is the entire promise of
// offline-first, and it would be quietly broken by a single `await` in the
// wrong place.
// =============================================================================

import { logger } from "../../config/logger";
import { isEdgeNode, offlineConfig } from "../config";
import {
  isOnline,
  onConnectivityChange,
  probeConnectivity,
} from "../datasource/connectivity";
import { getLocalClient, type LocalClient } from "../datasource/localClient";

import { repairCaptureFlag, verifyChangeCapture } from "./changeCapture";
import { downloadMasterData, isMirrorEmpty, type DownloadOutcome } from "./download";
import { finishRun, pruneLogs, reconcileInterruptedRuns, recordEvent, startRun, type SyncTrigger } from "./runLog";
import { recoverStalledItems, uploadPendingChanges, type UploadOutcome } from "./upload";

// =============================================================================
// TYPES
// =============================================================================

export interface SyncRunResult {
  readonly runId: string;
  readonly status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
  readonly download?: DownloadOutcome;
  readonly upload?: UploadOutcome;
  readonly skippedBecause?: string;
  readonly durationMs: number;
}

// =============================================================================
// LOCK
// =============================================================================

let activeRun: Promise<SyncRunResult> | null = null;

export function isSyncing(): boolean {
  return activeRun !== null;
}

/**
 * Runs `work` under the sync lock.
 *
 * A caller arriving while a run is in progress gets a SKIPPED result rather
 * than queuing. Queuing would mean the cashier's third impatient click on "Sync
 * Now" schedules three more full drains after the one already running.
 */
async function withSyncLock(
  work: () => Promise<SyncRunResult>
): Promise<SyncRunResult> {
  if (activeRun !== null) {
    return {
      runId: "",
      status: "SKIPPED",
      skippedBecause: "a sync run is already in progress",
      durationMs: 0,
    };
  }

  activeRun = work().finally(() => {
    activeRun = null;
  });

  return activeRun;
}

// =============================================================================
// RUNS
// =============================================================================

/**
 * Morning sync — refresh master data from the cloud.
 *
 * Ordering note: the cashier cannot sell what is not in the catalog, so a
 * download is what makes a node ready for the day. It is safe to run at any
 * time; nothing here touches the queue.
 */
export async function runDownload(
  trigger: SyncTrigger = "MANUAL",
  options: { entities?: string[] } = {}
): Promise<SyncRunResult> {
  return withSyncLock(async () => {
    const startedAt = Date.now();
    const local = getLocalClient();

    if (!(await ensureOnline())) {
      return offlineResult(startedAt);
    }

    const runId = await startRun("DOWNLOAD", trigger, local);

    try {
      const outcome = await downloadMasterData(runId, {
        client: local,
        ...(options.entities === undefined ? {} : { entities: options.entities }),
      });

      const status = outcome.failedEntities.length === 0 ? "SUCCESS" : "PARTIAL";

      await finishRun(
        runId,
        status,
        {
          itemsTotal: outcome.totalRows,
          itemsSucceeded: outcome.totalRows,
          itemsFailed: outcome.failedEntities.length,
          itemsConflicted: outcome.totalConflicts,
          bytesTransferred: outcome.bytesReceived,
        },
        { detail: outcome.entities, client: local }
      );

      return {
        runId,
        status,
        download: outcome,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishRun(runId, "FAILED", {}, { error: message, client: local });

      logger.error({ err: error }, "offline: download run failed");
      return { runId, status: "FAILED", durationMs: Date.now() - startedAt };
    }
  });
}

/**
 * Night sync — drain the queue to the cloud.
 */
export async function runUpload(trigger: SyncTrigger = "MANUAL"): Promise<SyncRunResult> {
  return withSyncLock(async () => {
    const startedAt = Date.now();
    const local = getLocalClient();

    if (!(await ensureOnline())) {
      return offlineResult(startedAt);
    }

    const runId = await startRun("UPLOAD", trigger, local);

    try {
      const outcome = await uploadPendingChanges(runId, { client: local });

      const status =
        outcome.drained && outcome.rejected === 0 && outcome.failed === 0
          ? "SUCCESS"
          : outcome.applied + outcome.duplicates > 0
            ? "PARTIAL"
            : "FAILED";

      await finishRun(
        runId,
        status,
        {
          itemsTotal: outcome.itemsSent,
          itemsSucceeded: outcome.applied + outcome.duplicates,
          itemsFailed: outcome.rejected + outcome.failed,
          itemsConflicted: outcome.conflicts,
          bytesTransferred: outcome.bytesSent,
        },
        {
          ...(outcome.stoppedBecause === undefined ? {} : { error: outcome.stoppedBecause }),
          detail: outcome,
          client: local,
        }
      );

      await local.syncNodeState.updateMany({
        where: { id: "singleton" },
        data: { lastUploadAt: new Date() },
      });

      return { runId, status, upload: outcome, durationMs: Date.now() - startedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishRun(runId, "FAILED", {}, { error: message, client: local });

      logger.error({ err: error }, "offline: upload run failed");
      return { runId, status: "FAILED", durationMs: Date.now() - startedAt };
    }
  });
}

/**
 * Full sync — upload first, then download.
 *
 * Upload leads deliberately. The till's un-uploaded sales are the only copy of
 * that data anywhere in the world; the catalog refresh is a convenience that
 * can be repeated any time. If only one of the two can complete before the link
 * drops again, it must be the one that protects data.
 */
export async function runFullSync(trigger: SyncTrigger = "MANUAL"): Promise<SyncRunResult> {
  const upload = await runUpload(trigger);

  if (upload.status === "SKIPPED") return upload;

  const download = await runDownload(trigger);

  const status: SyncRunResult["status"] =
    upload.status === "SUCCESS" && download.status === "SUCCESS"
      ? "SUCCESS"
      : upload.status === "FAILED" && download.status === "FAILED"
        ? "FAILED"
        : "PARTIAL";

  return {
    runId: upload.runId,
    status,
    ...(upload.upload === undefined ? {} : { upload: upload.upload }),
    ...(download.download === undefined ? {} : { download: download.download }),
    durationMs: upload.durationMs + download.durationMs,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

async function ensureOnline(): Promise<boolean> {
  if (isOnline()) return true;

  // One fresh probe before giving up: the periodic monitor may be up to its
  // interval out of date, and a cashier who just plugged the router back in
  // should not have to wait 15 seconds for "Sync Now" to believe them.
  return (await probeConnectivity()) === "online";
}

function offlineResult(startedAt: number): SyncRunResult {
  return {
    runId: "",
    status: "SKIPPED",
    skippedBecause: "no connection to the cloud",
    durationMs: Date.now() - startedAt,
  };
}

// =============================================================================
// BACKGROUND SCHEDULING
// =============================================================================

let autoTimer: NodeJS.Timeout | undefined;
let unsubscribeConnectivity: (() => void) | undefined;

/**
 * Starts background synchronization.
 *
 * Two triggers, and they cover different failures:
 *
 *   Connectivity restored  Drains promptly when the link comes back, which is
 *                          what "synchronize in the background when internet
 *                          becomes available" asks for.
 *   Periodic tick          The safety net. A node that was online the whole
 *                          time never sees a transition, so without the tick it
 *                          would never sync at all.
 */
export function startBackgroundSync(): void {
  const config = offlineConfig();

  if (!config.autoSyncEnabled || autoTimer !== undefined) return;

  unsubscribeConnectivity = onConnectivityChange((change) => {
    if (change.current !== "online") return;

    logger.info("offline: connection restored — starting background sync");

    void runFullSync("AUTO").catch((err: unknown) => {
      logger.error({ err }, "offline: background sync failed");
    });
  });

  autoTimer = setInterval(() => {
    if (!isOnline() || isSyncing()) return;

    void runUpload("AUTO").catch((err: unknown) => {
      logger.error({ err }, "offline: scheduled upload failed");
    });
  }, config.autoSyncIntervalMs);

  autoTimer.unref();

  logger.info(
    { intervalMs: config.autoSyncIntervalMs },
    "offline: background sync started"
  );
}

export function stopBackgroundSync(): void {
  if (autoTimer !== undefined) {
    clearInterval(autoTimer);
    autoTimer = undefined;
  }

  unsubscribeConnectivity?.();
  unsubscribeConnectivity = undefined;
}

// =============================================================================
// STARTUP RECOVERY
// =============================================================================

/**
 * Repairs whatever the last process left behind, then decides what to do first.
 *
 * Called once at boot, after the local database is ready. Every step here
 * addresses a specific way a till can be killed: power cut, forced restart,
 * deploy in the middle of a batch.
 */
export async function recoverAndBootstrap(client?: LocalClient): Promise<void> {
  const local = client ?? getLocalClient();

  // 1. Runs left RUNNING by a killed process, which would otherwise make the
  //    status endpoint report "syncing" forever.
  await reconcileInterruptedRuns(local);

  // 2. Items stranded IN_FLIGHT, which no future drain would look at.
  await recoverStalledItems(local);

  // 3. Capture left disabled by an interrupted download — the one failure that
  //    silently loses data rather than merely delaying it.
  const repaired = await repairCaptureFlag(local);

  // 4. Triggers present and correct. A missing trigger looks like a healthy
  //    empty queue.
  const capture = await verifyChangeCapture(local);

  if (capture.missing.length > 0) {
    logger.error(
      { missing: capture.missing.slice(0, 10), total: capture.missing.length },
      "offline: change-capture triggers are missing — local writes are NOT being queued"
    );
    await recordEvent(
      null,
      "INTEGRITY_CHECK",
      `${capture.missing.length} change-capture triggers are missing`,
      { level: "ERROR", client: local }
    );
  }

  if (repaired) {
    await recordEvent(
      null,
      "INTEGRITY_CHECK",
      "Change capture was disabled at startup and has been re-enabled",
      { level: "ERROR", client: local }
    );
  }

  await pruneLogs({ client: local });

  // 5. First-run bootstrap. An empty mirror means this node has never synced
  //    and cannot trade — a download is not optional, it is the install step.
  if (await isMirrorEmpty(local)) {
    logger.warn(
      "offline: local mirror is empty — attempting an initial download. " +
        "Until it succeeds this node has no catalog and cannot sell."
    );

    void runDownload("STARTUP").catch((err: unknown) => {
      logger.error({ err }, "offline: initial download failed");
    });
  }
}

/** Everything the runtime needs to start on an edge node. */
export async function startSyncEngine(): Promise<void> {
  if (!isEdgeNode()) return;

  await recoverAndBootstrap();
  startBackgroundSync();
}
