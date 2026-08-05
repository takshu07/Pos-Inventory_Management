// =============================================================================
// OFFLINE RUNTIME LIFECYCLE
//
// One place that starts and stops everything the offline layer owns, so
// server.ts gains two calls rather than a dozen.
//
// ── Failure policy ───────────────────────────────────────────────────────────
// Startup failures are NOT uniform, because the consequences are not uniform:
//
//   EDGE node, local database unusable    → FATAL. This node's only operational
//                                           database is missing. Serving would
//                                           mean every request 500s; better to
//                                           fail the deploy loudly.
//   EDGE node, cloud unreachable          → fine. That is the entire point of
//                                           the feature. Start, serve, queue.
//   CLOUD node, anything offline-related  → non-fatal. The cloud's job is to
//                                           serve the API and accept uploads;
//                                           a broken sync scheduler must never
//                                           stop it answering requests.
//
// That asymmetry is deliberate: the common cause of an edge node failing to
// start is a forgotten `npm run db:local:setup`, and that must be impossible to
// miss.
// =============================================================================

import { logger } from "../config/logger";

import { assertOfflineConfigValid, offlineConfig } from "./config";
import {
  startConnectivityMonitor,
  stopConnectivityMonitor,
} from "./datasource/connectivity";
import { closeLocalClient, prepareLocalDatabase } from "./datasource/localClient";
import { getDataSourceMode } from "./datasource/router";
import { installChangeCapture, repairCaptureFlag } from "./sync/changeCapture";
import { startSyncEngine, stopBackgroundSync } from "./sync/engine";

// =============================================================================
// STARTUP
// =============================================================================

/**
 * Brings the offline subsystem up.
 *
 * Called from server.ts BEFORE `app.listen()`, so a node that cannot serve
 * never binds a port.
 */
export async function initializeOfflineRuntime(): Promise<void> {
  const config = offlineConfig();

  if (!config.enabled) {
    // The default path. Nothing initializes, and the process is byte-for-byte
    // the server that existed before this feature was added.
    //
    // The one thing it does do is state the resolved gate, because "did the
    // rollback actually take effect?" is otherwise unanswerable from the logs.
    // The config is memoized and the SQLite handle is parked on `globalThis`,
    // so a `tsx watch` reload does NOT re-read the flag — an operator can flip
    // it, see the process reload, and believe a rollback happened when the old
    // value is still live. This line is what they grep for to confirm.
    //
    // `staleRole` surfaces the rollback-hygiene trap: offline is off, but an
    // edge role was left behind. Harmless now that the endpoints gate on
    // `enabled`, still worth clearing before it confuses the next person.
    logger.info(
      {
        enabled: false,
        role: config.role,
        dataSource: "cloud",
        staleRole: config.role === "edge" ? true : undefined,
      },
      "offline: disabled — this node runs entirely on the cloud database"
    );
    return;
  }

  assertOfflineConfigValid(config);

  logger.info(
    {
      role: config.role,
      deviceId: config.deviceId || undefined,
      dataSource: getDataSourceMode(),
    },
    "offline: initializing"
  );

  if (config.role === "edge") {
    // Fatal on purpose — see the failure policy above.
    await prepareLocalDatabase();

    // Reinstalled on EVERY boot, not just the first. `db push` recreates tables
    // and SQLite drops their triggers along with them, so a node that came up
    // after a schema refresh would otherwise run all day capturing nothing —
    // silently, with a perfectly healthy-looking queue of zero.
    await installChangeCapture();

    // A node found with capture disabled was interrupted mid-download. Repair
    // it before serving, and log loudly: writes in that window went uncaptured.
    await repairCaptureFlag();

    startConnectivityMonitor();

    // Startup recovery + background scheduling. Deliberately NOT awaited past
    // its recovery phase: a node whose cloud is unreachable must still finish
    // booting and open for business — that is the entire point of the feature.
    await startSyncEngine();
  }
}

// =============================================================================
// SHUTDOWN
// =============================================================================

/**
 * Takes the offline subsystem down.
 *
 * Called from the graceful-shutdown path. Ordering matters: the connectivity
 * monitor stops first so nothing schedules new work, then the local database
 * handle closes, checkpointing the WAL.
 *
 * Never throws — a shutdown that fails here must not prevent the process from
 * exiting.
 */
export async function shutdownOfflineRuntime(): Promise<void> {
  if (!offlineConfig().enabled) return;

  try {
    // Order matters: stop scheduling new work, stop probing, then close the
    // handle. Closing first would fail an in-flight batch's bookkeeping write
    // and leave its items stranded IN_FLIGHT for the next boot to recover.
    stopBackgroundSync();
    stopConnectivityMonitor();
    await closeLocalClient();
    logger.info("offline: runtime stopped");
  } catch (err) {
    logger.error({ err }, "offline: error during shutdown (continuing)");
  }
}
