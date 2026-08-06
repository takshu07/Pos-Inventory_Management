// =============================================================================
// TILL PROVISIONING — building a verified mirror on a brand-new cashier PC
//
// One command takes a machine with nothing on it to a till that is proven ready
// for Offline Mode:
//
//   PREFLIGHT   may we destroy what is here?          (preflight.ts)
//   QUARANTINE  move the old mirror aside, not delete it
//   BUILD       push the generated schema into a NEW file
//   IDENTITY    seed node state, cursors, device id
//   DOWNLOAD    pull the complete master data from the cloud
//   VERIFY      prove the result is fit to sell from   (verify.ts)
//
// ── The rule that shapes everything: never delete, always quarantine ─────────
// A failed provisioning must leave the operator with the old database still in
// their hands. So the existing mirror is RENAMED, never unlinked, and on failure
// it is renamed back. The cost is disk space on a machine that has plenty; the
// benefit is that the worst outcome of a bad run is "we are back where we
// started" rather than "the queue is gone".
//
// ── Why a subprocess builds the schema ───────────────────────────────────────
// `prisma db push` is the only supported way to materialize the generated
// mirror, and it is a CLI. Shelling out is not elegant, but reimplementing DDL
// generation here would create a second source of truth for the schema — which
// is precisely the drift `generate-local-schema.ts` exists to prevent.
//
// ── Idempotency ──────────────────────────────────────────────────────────────
// Safe to retry from any point. Every step is either a no-op when already done
// or is redone from scratch against the quarantined-and-replaced file, so an
// interrupted run is recovered by running the command again.
// =============================================================================

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { logger } from "../../config/logger";
import { offlineConfig, type OfflineConfig } from "../config";
import {
  __setLocalClientForTesting,
  closeLocalClient,
  type LocalClient,
} from "../datasource/localClient";
import { installChangeCapture } from "../sync/changeCapture";
import { downloadMasterData, type DownloadOutcome } from "../sync/download";

import { runPreflight, type PreflightResult } from "./preflight";
import { verifyMirror, type VerificationResult } from "./verify";

// =============================================================================
// TYPES
// =============================================================================

export type ProvisionStage =
  | "PREFLIGHT"
  | "QUARANTINE"
  | "BUILD"
  | "IDENTITY"
  | "DOWNLOAD"
  | "VERIFY";

export interface ProvisionOptions {
  /** --i-understand-this-destroys-the-mirror */
  readonly confirmed: boolean;
  /** Stop after preflight and report. Nothing is written. */
  readonly dryRun?: boolean;
  /** Skip the cloud download — for testing the build/verify path offline. */
  readonly skipDownload?: boolean;
  /** Re-page the cloud during verification to reconcile row counts. */
  readonly compareWithCloud?: boolean;
  readonly config?: OfflineConfig;
  /**
   * Test seam. When set, the schema is built by this function instead of by
   * `prisma db push`, so suites do not pay a 30s subprocess per case.
   */
  readonly buildSchema?: (databasePath: string) => Promise<void> | void;
}

export interface ProvisionResult {
  readonly ok: boolean;
  /** The stage that failed, or undefined on success. */
  readonly failedStage?: ProvisionStage;
  readonly preflight: PreflightResult;
  readonly download?: DownloadOutcome;
  readonly verification?: VerificationResult;
  /** Where the previous mirror was moved, if there was one. */
  readonly quarantinePath?: string;
  /** True when a failure was rolled back and the old mirror restored. */
  readonly rolledBack: boolean;
  readonly messages: readonly string[];
  readonly durationMs: number;
}

// =============================================================================
// FILE HANDLING
//
// SQLite in WAL mode is THREE files. Moving only the .db leaves the -wal and
// -shm behind, and the next process to open that path picks up a WAL belonging
// to a database that is no longer there — which SQLite reports as corruption.
// =============================================================================

const SQLITE_SIDECARS = ["", "-wal", "-shm"] as const;

function quarantineMirror(databasePath: string): string | undefined {
  if (!fs.existsSync(databasePath)) return undefined;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = `${databasePath}.superseded-${stamp}`;

  for (const suffix of SQLITE_SIDECARS) {
    const from = `${databasePath}${suffix}`;
    if (fs.existsSync(from)) fs.renameSync(from, `${target}${suffix}`);
  }

  return target;
}

function restoreMirror(databasePath: string, quarantinePath: string): void {
  // Clear whatever the failed run left at the live path first, or the rename
  // fails on Windows and the operator is left with neither database in place.
  for (const suffix of SQLITE_SIDECARS) {
    const live = `${databasePath}${suffix}`;
    if (fs.existsSync(live)) fs.rmSync(live, { force: true });
  }

  for (const suffix of SQLITE_SIDECARS) {
    const from = `${quarantinePath}${suffix}`;
    if (fs.existsSync(from)) fs.renameSync(from, `${databasePath}${suffix}`);
  }
}

function discardPartialMirror(databasePath: string): void {
  for (const suffix of SQLITE_SIDECARS) {
    const file = `${databasePath}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
}

// =============================================================================
// SCHEMA BUILD
// =============================================================================

const SERVER_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/**
 * Materializes the generated mirror schema into a NEW SQLite file.
 *
 * Runs `prisma db push` against `prisma/local/prisma.config.ts` — the same
 * command `npm run db:local:push` runs, so a provisioned till and a
 * developer-built mirror are byte-identical in structure.
 */
function buildMirrorSchema(databasePath: string): void {
  execFileSync(
    "npx",
    ["prisma", "db", "push", "--accept-data-loss", "--config", "prisma/local/prisma.config.ts"],
    {
      cwd: SERVER_ROOT,
      // Prisma's SQLite connector wants `file:` + a NATIVE absolute path; the
      // RFC-8089 `file:///D:/…` form is rejected on Windows.
      env: { ...process.env, LOCAL_DATABASE_URL: `file:${databasePath}` },
      stdio: "pipe",
      timeout: 180_000,
      // Required on Windows: since the Node 18.20/20.12 security fix, spawning
      // a .cmd shim (npx.cmd) without a shell fails with EINVAL.
      shell: true,
    }
  );
}

// =============================================================================
// IDENTITY
// =============================================================================

/**
 * Seeds everything the sync engine needs before it may run.
 *
 * Cursors are deliberately NOT pre-seeded with rows. An absent cursor means
 * "pull from the beginning", which is exactly right for a fresh mirror; writing
 * a zero-valued cursor row would be equivalent but adds a way to be subtly
 * wrong (a cursor of epoch-0 that some entity's comparison treats as "already
 * synced"). `download.ts` creates each cursor as it completes an entity.
 */
async function initializeIdentity(local: LocalClient, config: OfflineConfig): Promise<void> {
  // `installChangeCapture` seeds the singleton node-state row from
  // OFFLINE_DEVICE_ID and installs all 102 triggers. Running it here rather
  // than relying on the next boot means the mirror is capture-ready BEFORE the
  // download runs — which matters, because the download's suppression logic
  // reads the flag this creates.
  await installChangeCapture(local);

  await local.syncNodeState.update({
    where: { id: "singleton" },
    data: {
      deviceId: config.deviceId,
      captureEnabled: true,
      lastMode: "local",
      // A fresh till has never synced or held a lock. Explicit nulls rather
      // than defaults, so a re-provisioned file cannot inherit stale watermarks
      // from the row it replaced.
      activeRunId: null,
      lastDownloadAt: null,
      lastUploadAt: null,
      lastOnlineAt: null,
    },
  });
}

// =============================================================================
// ORCHESTRATION
// =============================================================================

/**
 * Provisions this node's local mirror from scratch.
 *
 * Returns a result rather than throwing on an expected failure — the CLI needs
 * the full report to print, and a preflight refusal is a normal outcome, not an
 * exception. Genuine faults (a disk that will not accept writes) still throw.
 */
export async function provisionTill(options: ProvisionOptions): Promise<ProvisionResult> {
  const started = Date.now();
  const config = options.config ?? offlineConfig();
  const messages: string[] = [];

  const say = (message: string): void => {
    messages.push(message);
    logger.info({ provisioning: true }, message);
  };

  // ── 1. PREFLIGHT ──────────────────────────────────────────────────────────
  // Opens the existing mirror READ-ONLY to inspect its queue and identity. It
  // is closed before anything is moved, because Windows will not rename a file
  // with an open handle — and a rename that fails halfway leaves the till with
  // no database at all.
  let existing: LocalClient | null = null;
  let openError: string | undefined;
  // Tracks whether a handle was OPENED, independently of whether it turned out
  // to be usable. A corrupt file still leaves a live better-sqlite3 handle
  // behind — the constructor succeeds and only the first query fails — and
  // Windows refuses to rename a file with an open handle. Keying the cleanup on
  // `existing !== null` would therefore skip the close for exactly the case
  // that needs it, and quarantine would fail with "file is not a database".
  let handleOpened = false;

  if (fs.existsSync(config.localDatabasePath)) {
    try {
      existing = __setLocalClientForTesting(config.localDatabasePath);
      handleOpened = true;
      await existing.$queryRawUnsafe("SELECT 1");
    } catch (error) {
      openError = error instanceof Error ? error.message : String(error);
      existing = null;
    }
  }

  const preflight = await runPreflight({
    confirmed: options.confirmed,
    existing,
    openError,
    config,
  });

  // Release the handle before any rename. `closeLocalClient` also clears the
  // module singleton, so the post-build client is built fresh against the new
  // file rather than handed the stale one.
  if (handleOpened) {
    try {
      await closeLocalClient();
    } catch {
      // A handle on a corrupt file can fail to disconnect cleanly. The rename
      // below is what actually matters, and it reports its own failure.
    }
  }

  if (!preflight.mayProceed) {
    return {
      ok: false,
      failedStage: "PREFLIGHT",
      preflight,
      rolledBack: false,
      messages,
      durationMs: Date.now() - started,
    };
  }

  if (options.dryRun === true) {
    say("Dry run: preflight passed, nothing was written.");
    return {
      ok: true,
      preflight,
      rolledBack: false,
      messages,
      durationMs: Date.now() - started,
    };
  }

  // ── 2. QUARANTINE ─────────────────────────────────────────────────────────
  let quarantinePath: string | undefined;
  try {
    quarantinePath = quarantineMirror(config.localDatabasePath);
    if (quarantinePath !== undefined) {
      say(`Existing mirror moved aside → ${path.basename(quarantinePath)} (not deleted).`);
    } else {
      say("No existing mirror — this is a first-time provisioning.");
    }
  } catch (error) {
    return {
      ok: false,
      failedStage: "QUARANTINE",
      preflight,
      rolledBack: false,
      messages: [
        ...messages,
        `Could not move the existing mirror aside: ${
          error instanceof Error ? error.message : String(error)
        }. Nothing was changed.`,
      ],
      durationMs: Date.now() - started,
    };
  }

  // Every stage past this point can leave a partial mirror behind, so they all
  // share one rollback path: discard what we built, put the old file back.
  const rollback = (stage: ProvisionStage, reason: string): ProvisionResult => {
    discardPartialMirror(config.localDatabasePath);

    let rolledBack = false;
    if (quarantinePath !== undefined) {
      try {
        restoreMirror(config.localDatabasePath, quarantinePath);
        rolledBack = true;
      } catch (error) {
        messages.push(
          `⚠ ROLLBACK FAILED: the previous mirror is still at ${quarantinePath} and must ` +
            `be restored by hand (${error instanceof Error ? error.message : String(error)}).`
        );
      }
    }

    return {
      ok: false,
      failedStage: stage,
      preflight,
      ...(quarantinePath === undefined ? {} : { quarantinePath }),
      rolledBack,
      messages: [
        ...messages,
        reason,
        rolledBack
          ? "Rolled back: the previous mirror has been restored and this till is " +
            "exactly as it was before the command ran."
          : "Nothing to roll back to — this was a first-time provisioning, so the " +
            "partial mirror was discarded and no database is present.",
      ],
      durationMs: Date.now() - started,
    };
  };

  // ── 3. BUILD ──────────────────────────────────────────────────────────────
  let local: LocalClient;
  try {
    if (options.buildSchema !== undefined) {
      await options.buildSchema(config.localDatabasePath);
    } else {
      buildMirrorSchema(config.localDatabasePath);
    }

    local = __setLocalClientForTesting(config.localDatabasePath);

    // The same PRAGMAs `prepareLocalDatabase` sets at boot. Applied here too
    // because provisioning writes a full catalog through this handle, and doing
    // that without foreign_keys ON would let orphans land in the very database
    // whose FK integrity we are about to certify.
    for (const pragma of [
      "PRAGMA journal_mode = WAL",
      "PRAGMA synchronous = FULL",
      "PRAGMA foreign_keys = ON",
      "PRAGMA busy_timeout = 5000",
    ]) {
      await local.$executeRawUnsafe(pragma);
    }

    say("Fresh SQLite mirror created and durability PRAGMAs applied.");
  } catch (error) {
    return rollback(
      "BUILD",
      `Schema build failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // ── 4. IDENTITY ───────────────────────────────────────────────────────────
  try {
    await initializeIdentity(local, config);
    say(`Sync metadata initialized: device "${config.deviceId}", capture enabled, cursors cleared.`);
  } catch (error) {
    await closeLocalClient();
    return rollback(
      "IDENTITY",
      `Sync metadata initialization failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // ── 5. DOWNLOAD ───────────────────────────────────────────────────────────
  let download: DownloadOutcome | undefined;

  if (options.skipDownload !== true) {
    try {
      const runId = `provision-${Date.now().toString(36)}`;
      download = await downloadMasterData(runId, { client: local });

      if (download.failedEntities.length > 0) {
        await closeLocalClient();
        return rollback(
          "DOWNLOAD",
          `Download incomplete: ${download.failedEntities.length} entity/entities failed ` +
            `(${download.failedEntities.slice(0, 5).join(", ")}). A till with a partial ` +
            "catalog must not open for business — barcodes in the missing range simply " +
            "would not scan."
        );
      }

      say(
        `Downloaded ${download.totalRows} row(s) across ${download.entities.length} ` +
          `entities (${Math.round(download.bytesReceived / 1024)} KiB).`
      );
    } catch (error) {
      await closeLocalClient();
      return rollback(
        "DOWNLOAD",
        `Download failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else {
    say("Download skipped (--skip-download).");
  }

  // ── 6. VERIFY ─────────────────────────────────────────────────────────────
  const downloaded = new Map<string, number>(
    (download?.entities ?? []).map((entity) => [entity.entity, entity.rows])
  );

  let verification: VerificationResult;
  try {
    verification = await verifyMirror({
      client: local,
      downloaded,
      // The SAME config the mirror was just built under — not the ambient
      // environment, which may differ in any process that injects one.
      config,
      ...(options.compareWithCloud === true ? { compareWithCloud: true } : {}),
    });
  } catch (error) {
    await closeLocalClient();
    return rollback(
      "VERIFY",
      `Verification could not complete: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!verification.passed) {
    const failed = verification.checks.filter((c) => !c.passed && c.advisory !== true);
    await closeLocalClient();

    const result = rollback(
      "VERIFY",
      `Mirror verification FAILED (${failed.length} check(s)): ${failed
        .map((c) => c.name)
        .join(", ")}. The mirror was rejected rather than handed to a cashier.`
    );

    return { ...result, verification };
  }

  await closeLocalClient();
  say("Mirror verified. This till is ready for Offline Mode.");

  return {
    ok: true,
    preflight,
    ...(download === undefined ? {} : { download }),
    verification,
    ...(quarantinePath === undefined ? {} : { quarantinePath }),
    rolledBack: false,
    messages,
    durationMs: Date.now() - started,
  };
}
