/* eslint-disable no-console */
// =============================================================================
// PRODUCTION STRESS TEST  (Phase 6)
//
// The gate that decides whether Offline Mode may be enabled on real tills.
// It answers the questions `sync:stress` cannot, because it runs the REAL sync
// engine over a REAL socket and measures the machine while it does it:
//
//   Is the till still responsive under load?   event-loop delay, p50/p99
//   What does a sale actually cost?            write latency percentiles, not a mean
//   How long does the night sync take?         a real timed drain over the wire
//   What does it cost the machine?             CPU, RSS, database size on disk
//   Does a power cut lose money?               the run is KILLED mid-upload, then resumed
//   Do the books balance afterwards?           full reconciliation, both databases
//
// ── How this differs from `npm run sync:stress` ──────────────────────────────
// `sync:stress` is a local micro-benchmark: it never uploads (its `--with-cloud`
// flag gates no work), never measures CPU or responsiveness, reports averages
// rather than percentiles, and simulates an interruption by hand-editing rows
// rather than killing a run in flight. Both are useful; this one is the gate.
//
// Usage — on the TILL:
//   npm run stress:production -- --i-accept-writes-to-this-database
//   npm run stress:production -- --i-accept-writes-to-this-database \
//        --products 5000 --transactions 4000
//   npm run stress:production -- --local-only        (no cloud credentials needed)
//
// ── Safety ───────────────────────────────────────────────────────────────────
// The cloud half WRITES to whatever DATABASE_URL points at. Against production
// that would insert stress sales into the real books, so it refuses to run
// unless the URL looks disposable or the operator says otherwise explicitly.
// Everything it writes is tagged `PSTRESS-…` and is removable with --cleanup.
// =============================================================================

import type { Server } from "node:http";

import fs from "node:fs";
import path from "node:path";

import "dotenv/config";

// ── Environment must be set BEFORE the app graph is imported ─────────────────
// `config/prisma.ts` resolves the datasource router at module scope; an import
// that lands first would pin this process to the cloud client and the run would
// silently exercise nothing. Same constraint as validate-sync-e2e.ts.
const PORT = Number.parseInt(process.env["STRESS_PORT"] ?? "3942", 10);

process.env["OFFLINE_MODE_ENABLED"] = "true";
process.env["OFFLINE_ROLE"] = "edge";
process.env["OFFLINE_DEVICE_ID"] = process.env["OFFLINE_DEVICE_ID"] ?? "production-stress-till";
process.env["SYNC_CLOUD_URL"] = `http://127.0.0.1:${PORT}`;
process.env["SYNC_DEVICE_SECRET"] =
  process.env["SYNC_DEVICE_SECRET"] ?? "production-stress-secret-".padEnd(48, "x");
process.env["SYNC_AUTO_ENABLED"] = "false"; // the harness drives every run itself
// Connectivity hysteresis needs 2 consecutive good probes before declaring
// itself online. A store wants that damping; a single-shot harness would sit at
// "unknown" forever and skip every sync. Test-only, as in the e2e harness.
process.env["SYNC_PROBE_OK_THRESHOLD"] = "1";
process.env["SYNC_PROBE_FAIL_THRESHOLD"] = "1";
process.env["LOCAL_DATABASE_PATH"] =
  process.env["LOCAL_DATABASE_PATH"] ?? "./data/production-stress.db";

import { captureMachineProfile, databaseSizeMb, type MachineProfile } from "./lib/machineProfile";
import { LatencyRecorder, ResourceSampler, type LatencySummary, type ResourceSummary } from "./lib/resourceSampler";

// =============================================================================
// REPORT MODEL
// =============================================================================

type Verdict = "ok" | "warn" | "fail";

interface Measurement {
  readonly section: string;
  readonly label: string;
  readonly value: string;
  readonly verdict?: Verdict;
  readonly note?: string;
}

const measurements: Measurement[] = [];
let currentSection = "general";

function section(title: string): void {
  currentSection = title;
  console.log(`\n${"─".repeat(78)}\n${title}\n${"─".repeat(78)}`);
}

function metric(label: string, value: string, verdict?: Verdict, note?: string): void {
  measurements.push({
    section: currentSection,
    label,
    value,
    ...(verdict ? { verdict } : {}),
    ...(note ? { note } : {}),
  });

  const mark = verdict === undefined ? " " : verdict === "ok" ? "✔" : verdict === "warn" ? "!" : "✖";
  console.log(`  ${mark} ${label.padEnd(44)} ${value}${note ? `   ${note}` : ""}`);
}

/** A pass/fail assertion — the checks that gate the release. */
function assert(label: string, passed: boolean, detail = ""): boolean {
  metric(label, passed ? "PASS" : "FAIL", passed ? "ok" : "fail", detail);
  return passed;
}

// =============================================================================
// THRESHOLDS
//
// Deliberately generous: these are "the till is unusable" lines, not targets.
// A number inside the threshold but far worse than the dev baseline still shows
// up in the report for a human to judge.
// =============================================================================

const THRESHOLDS = {
  /** A checkout the cashier waits on. Above this it feels laggy. */
  checkoutP95Ms: 250,
  /** A barcode scan must feel instant. */
  scanP95Ms: 50,
  /** Event-loop stall that would look like a frozen screen. */
  loopDelayP99Ms: 500,
  /** RSS ceiling — tills are commonly 4GB machines. */
  rssPeakMb: 1024,
  /** A day's local database should not approach the disk budget. */
  databaseMb: 2048,
} as const;

// =============================================================================
// ARGUMENTS
// =============================================================================

function argNumber(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const parsed = Number.parseInt(process.argv[index + 1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const PRODUCT_COUNT = argNumber("--products", 3000);
const TRANSACTION_COUNT = argNumber("--transactions", 3000);
/**
 * Milliseconds of think-time between sales.
 *
 * Zero measures peak throughput, but a back-to-back `await` loop never yields
 * to the macrotask queue, so `monitorEventLoopDelay` records NOTHING and
 * responsiveness cannot be measured at all. A small gap models a real till —
 * where sales arrive with pauses — and lets the loop-delay histogram sample.
 */
const PACE_MS = argNumber("--pace", 2);
const LOCAL_ONLY = process.argv.includes("--local-only");
const ACCEPTED_WRITES = process.argv.includes("--i-accept-writes-to-this-database");

const tag = `PSTRESS-${Date.now().toString(36)}`;
let phoneSequence = 0;
const phoneRunOffset = Date.now() % 100_000_000;
// `phone` is @unique cloud-wide and the target database keeps rows between
// runs, so a process-local counter alone collides on the second run.
const uniquePhone = (): string =>
  `9${String(100_000_000 + ((phoneRunOffset + (phoneSequence += 1)) % 900_000_000)).slice(0, 9)}`;

// =============================================================================
// SAFETY
// =============================================================================

/**
 * Refuses to wipe the till's real local database.
 *
 * §1 of this harness truncates the mirror it is given. Against `pos-local.db`
 * on a live till that would destroy every sale not yet uploaded — the one
 * unrecoverable mistake available here, and it is a single environment variable
 * away. The check is on the filename because that is the name the runbook, the
 * rollback runbook and the deployment all use.
 */
function assertNotTheRealLocalDatabase(databasePath: string): void {
  const filename = path.basename(path.resolve(databasePath)).toLowerCase();

  if (filename !== "pos-local.db") return;

  console.error(`
  ─────────────────────────────────────────────────────────────────────────
  REFUSING TO RUN.

  LOCAL_DATABASE_PATH points at the till's REAL local database:

      ${path.resolve(databasePath)}

  This harness WIPES the local mirror before it starts. On a live till that
  destroys every sale that has not yet been uploaded.

  Point it at its own file instead:

      LOCAL_DATABASE_PATH=./data/production-stress.db
  ─────────────────────────────────────────────────────────────────────────
`);
  process.exit(1);
}

function assertDisposableDatabase(): void {
  const url = process.env["DATABASE_URL"] ?? "";

  if (url === "") {
    console.error("\n  DATABASE_URL is not set. Use --local-only to run without a cloud.\n");
    process.exit(1);
  }

  const looksDisposable = /test|staging|branch|localhost|127\.0\.0\.1/i.test(url);

  if (looksDisposable || ACCEPTED_WRITES) return;

  console.error(`
  ─────────────────────────────────────────────────────────────────────────
  REFUSING TO RUN.

  This writes stress data to whatever DATABASE_URL points at, and this URL
  does not look like a disposable database:

      ${url.replace(/:[^:@]*@/, ":****@")}

  Neon branches share a system_identifier with production, so no automatic
  check can prove this is safe. Confirm the target yourself, then re-run
  with --i-accept-writes-to-this-database, or use --local-only.
  ─────────────────────────────────────────────────────────────────────────
`);
  process.exit(1);
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const databasePath = process.env["LOCAL_DATABASE_PATH"] ?? "./data/production-stress.db";

  // Checked before anything opens or truncates the mirror.
  assertNotTheRealLocalDatabase(databasePath);
  if (!LOCAL_ONLY) assertDisposableDatabase();

  console.log("=".repeat(78));
  console.log("  PRODUCTION STRESS TEST — Phase 6");
  console.log("=".repeat(78));

  // ── Machine identity ───────────────────────────────────────────────────────
  section("0. MACHINE UNDER TEST");

  const machine = captureMachineProfile(databasePath);

  metric("hostname", machine.hostname);
  metric("platform", `${machine.platform} ${machine.release} (${machine.arch})`);
  metric("cpu", `${machine.cpuModel} × ${machine.cpuCores}`);
  metric("memory", `${machine.totalMemoryGb.toFixed(1)} GB total, ${machine.freeMemoryGb.toFixed(1)} GB free`);
  metric("node", machine.nodeVersion);
  metric(
    "fsync cost on the database volume",
    Number.isNaN(machine.fsyncMs) ? "unavailable" : `${machine.fsyncMs.toFixed(2)}ms`,
    Number.isNaN(machine.fsyncMs) ? "warn" : machine.fsyncMs < 20 ? "ok" : "warn",
    "the floor under every checkout — synchronous=FULL"
  );
  metric("workload", `${PRODUCT_COUNT.toLocaleString()} products, ${TRANSACTION_COUNT.toLocaleString()} transactions`);
  metric("cloud half", LOCAL_ONLY ? "SKIPPED (--local-only)" : "enabled", LOCAL_ONLY ? "warn" : "ok");

  // ── Wiring ─────────────────────────────────────────────────────────────────
  const { getLocalClient, prepareLocalDatabase } = await import("../src/offline/datasource/localClient");
  const { installChangeCapture, verifyChangeCapture } = await import("../src/offline/sync/changeCapture");
  const { recoverStalledItems } = await import("../src/offline/sync/upload");
  const { reconcileInterruptedRuns } = await import("../src/offline/sync/runLog");

  // A fresh LOCAL_DATABASE_PATH has no tables until the schema is pushed, and
  // the raw Prisma error points at the wrong thing. Say what to run instead.
  try {
    await prepareLocalDatabase();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`
  ─────────────────────────────────────────────────────────────────────────
  The local SQLite mirror at ${databasePath} is not ready.

      ${message}

  A fresh database path needs its schema pushed before the harness can run:

      LOCAL_DATABASE_PATH=${databasePath} npm run db:local:setup

  (On Windows PowerShell: $env:LOCAL_DATABASE_PATH="${databasePath}"; npm run db:local:setup)
  ─────────────────────────────────────────────────────────────────────────
`);
    process.exit(1);
  }

  const local = getLocalClient();

  section("1. SETUP");

  await installChangeCapture(local);
  const capture = await verifyChangeCapture(local);
  assert("change-capture triggers installed", capture.missing.length === 0, `${capture.installed} triggers`);

  await truncateLocal(local);
  metric("local mirror cleared", "ok");

  // ── Fixtures ───────────────────────────────────────────────────────────────
  const category = await local.category.create({ data: { name: `${tag}-cat` } });
  const size = await local.size.create({ data: { name: `${tag}-M` } });
  const color = await local.color.create({ data: { name: `${tag}-Blue` } });
  const employee = await local.employee.create({
    data: {
      employeeCode: `${tag}-E1`,
      firstName: "Stress",
      lastName: "Cashier",
      phone: uniquePhone(),
      password: "x",
      role: "CASHIER",
      joiningDate: new Date(),
    },
  });
  const customer = await local.customer.create({
    data: { name: "Stress Walk-In", customerCode: `${tag}-C1`, phone: uniquePhone() },
  });

  // =========================================================================
  // 2. CATALOG — the morning download's write side
  // =========================================================================
  section("2. CATALOG LOAD");

  const catalogSampler = new ResourceSampler();
  catalogSampler.start();
  const catalogStarted = process.hrtime.bigint();

  const CHUNK = 250;
  for (let start = 0; start < PRODUCT_COUNT; start += CHUNK) {
    const end = Math.min(start + CHUNK, PRODUCT_COUNT);

    await local.$transaction(async (tx) => {
      for (let index = start; index < end; index += 1) {
        const product = await tx.product.create({
          data: { name: `${tag}-P${index}`, categoryId: category.id },
        });
        await tx.productVariant.create({
          data: {
            productId: product.id,
            sizeId: size.id,
            colorId: color.id,
            sku: `${tag}-SKU-${index}`,
            costPrice: "100.00",
            sellingPrice: "199.00",
            mrp: "249.00",
            currentStock: 1_000_000,
          },
        });
      }
    });
  }

  const catalogMs = Number(process.hrtime.bigint() - catalogStarted) / 1e6;
  const catalogResources = catalogSampler.stop();

  metric(
    "products + variants written",
    `${(PRODUCT_COUNT * 2).toLocaleString()} rows in ${(catalogMs / 1000).toFixed(1)}s`,
    undefined,
    `${Math.round((PRODUCT_COUNT * 2) / (catalogMs / 1000)).toLocaleString()} rows/s`
  );
  // Can exceed 100%: this is CPU-time over wall-time, and the native SQLite
  // addon plus V8's own threads genuinely use more than one core at once.
  metric(
    "catalog load CPU",
    `${catalogResources.cpuPercentOfOneCore.toFixed(0)}% of one core (${catalogResources.cpuPercentOfMachine.toFixed(0)}% of machine)`
  );

  const variants = await local.productVariant.findMany({
    where: { sku: { startsWith: tag } },
    select: { id: true, sku: true },
  });

  // ── The scan path ──────────────────────────────────────────────────────────
  const scanLatency = new LatencyRecorder();
  for (let index = 0; index < 500; index += 1) {
    const target = variants[index % variants.length];
    if (target === undefined) continue;
    await scanLatency.time(() => local.productVariant.findFirst({ where: { sku: target.sku } }));
  }
  const scan = scanLatency.summary();

  metric(
    "barcode scan (READ latency)",
    `p50 ${scan.p50Ms.toFixed(2)}ms · p95 ${scan.p95Ms.toFixed(2)}ms · p99 ${scan.p99Ms.toFixed(2)}ms`,
    scan.p95Ms < THRESHOLDS.scanP95Ms ? "ok" : "warn",
    `over ${variants.length.toLocaleString()} variants`
  );

  // =========================================================================
  // 3. A FULL BUSINESS DAY — throughput, write latency, responsiveness
  // =========================================================================
  section("3. FULL BUSINESS DAY");

  await local.$executeRawUnsafe("DELETE FROM sync_queue");

  const checkoutLatency = new LatencyRecorder();
  const daySampler = new ResourceSampler();
  daySampler.start();
  const dayStarted = process.hrtime.bigint();

  for (let index = 0; index < TRANSACTION_COUNT; index += 1) {
    const variant = variants[index % variants.length];
    if (variant === undefined) continue;

    await checkoutLatency.time(() =>
      checkout(local, { tag, index, prefix: "DAY", customer, employee, variant })
    );

    // Yields to the macrotask queue, which is what makes the loop-delay
    // histogram able to sample at all. Excluded from the latency timing above,
    // so throughput is still reported against real work.
    if (PACE_MS > 0) await new Promise((resolve) => setTimeout(resolve, PACE_MS));
  }

  const dayMs = Number(process.hrtime.bigint() - dayStarted) / 1e6;
  const dayResources = daySampler.stop();
  const checkout95 = checkoutLatency.summary();

  // Throughput is measured against time spent WRITING, excluding the injected
  // think-time — otherwise `--pace` would look like a slower till rather than a
  // more realistic one. Wall-clock is reported alongside it for honesty.
  const writeMs = checkoutLatency.totalMs;
  const throughput = TRANSACTION_COUNT / (writeMs / 1000);

  metric(
    "transaction throughput",
    `${throughput.toFixed(1)} sales/s`,
    undefined,
    `${TRANSACTION_COUNT.toLocaleString()} sales; ${(writeMs / 1000).toFixed(1)}s writing, ` +
      `${(dayMs / 1000).toFixed(1)}s wall-clock at ${PACE_MS}ms pace`
  );
  metric(
    "checkout WRITE latency",
    `p50 ${checkout95.p50Ms.toFixed(1)}ms · p95 ${checkout95.p95Ms.toFixed(1)}ms · p99 ${checkout95.p99Ms.toFixed(1)}ms`,
    checkout95.p95Ms < THRESHOLDS.checkoutP95Ms ? "ok" : "warn",
    `max ${checkout95.maxMs.toFixed(0)}ms — 4 captured writes per sale`
  );
  metric(
    "application responsiveness",
    dayResources.loopDelayMeasured
      ? `loop delay p50 ${dayResources.loopDelayP50Ms.toFixed(1)}ms · p99 ${dayResources.loopDelayP99Ms.toFixed(1)}ms`
      : "NOT MEASURED",
    !dayResources.loopDelayMeasured
      ? "warn"
      : dayResources.loopDelayP99Ms < THRESHOLDS.loopDelayP99Ms
        ? "ok"
        : "warn",
    dayResources.loopDelayMeasured
      ? `max ${dayResources.loopDelayMaxMs.toFixed(0)}ms — a stall the cashier would see`
      : "run too short to sample — raise --transactions"
  );
  metric(
    "CPU during trade",
    `${dayResources.cpuPercentOfOneCore.toFixed(0)}% of one core (${dayResources.cpuPercentOfMachine.toFixed(0)}% of machine)`,
    dayResources.cpuPercentOfMachine < 90 ? "ok" : "warn"
  );
  metric(
    "memory during trade",
    `RSS peak ${dayResources.rssPeakMb.toFixed(0)} MB · heap peak ${dayResources.heapPeakMb.toFixed(0)} MB`,
    dayResources.rssPeakMb < THRESHOLDS.rssPeakMb ? "ok" : "warn",
    "RSS includes the native SQLite footprint"
  );

  const queueDepth = await local.syncQueueItem.count();
  assert(
    "every write was captured",
    queueDepth === TRANSACTION_COUNT * 4,
    `queue depth ${queueDepth.toLocaleString()}, expected ${(TRANSACTION_COUNT * 4).toLocaleString()}`
  );

  const dbSize = databaseSizeMb(databasePath);
  metric(
    "database size on disk",
    `${dbSize.totalMb.toFixed(1)} MB`,
    dbSize.totalMb < THRESHOLDS.databaseMb ? "ok" : "warn",
    `main ${dbSize.mainMb.toFixed(1)} MB + WAL ${dbSize.walMb.toFixed(1)} MB`
  );

  // =========================================================================
  // 4. QUEUE OPERATIONS AT DEPTH
  // =========================================================================
  section("4. QUEUE PROCESSING AT DEPTH");

  const statusLatency = new LatencyRecorder();
  for (let index = 0; index < 25; index += 1) {
    await statusLatency.time(() =>
      local.syncQueueItem.groupBy({ by: ["status"], _count: { _all: true } })
    );
  }
  const status = statusLatency.summary();
  metric(
    "status aggregate (polled by every till screen)",
    `p50 ${status.p50Ms.toFixed(1)}ms · p95 ${status.p95Ms.toFixed(1)}ms`,
    status.p95Ms < 100 ? "ok" : "warn",
    `at ${queueDepth.toLocaleString()} queued items`
  );

  const claimLatency = new LatencyRecorder();
  for (let index = 0; index < 10; index += 1) {
    await claimLatency.time(() =>
      local.syncQueueItem.findMany({ where: { status: "PENDING" }, orderBy: { id: "asc" }, take: 50 })
    );
  }
  const claim = claimLatency.summary();
  metric("batch claim (50 items)", `p50 ${claim.p50Ms.toFixed(1)}ms · p95 ${claim.p95Ms.toFixed(1)}ms`,
    claim.p95Ms < 200 ? "ok" : "warn");

  // ── Idempotency ────────────────────────────────────────────────────────────
  const keyStats = await local.$queryRawUnsafe<Array<{ total: number; distinctKeys: number }>>(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT idempotencyKey) AS "distinctKeys" FROM sync_queue`
  );
  const totalKeys = Number(keyStats[0]?.total ?? 0);
  const distinctKeys = Number(keyStats[0]?.distinctKeys ?? 0);

  assert(
    "idempotency keys unique across the queue",
    totalKeys === distinctKeys,
    `${distinctKeys.toLocaleString()} distinct / ${totalKeys.toLocaleString()} total`
  );

  // =========================================================================
  // 5. THE NIGHT SYNC — real upload, over a real socket
  // =========================================================================
  let server: Server | undefined;
  let uploadedItems = 0;
  let syncDurationMs = 0;

  if (!LOCAL_ONLY) {
    section("5. SYNCHRONISATION (real cloud, real HTTP)");

    const { createApp } = await import("../src/app");
    const app = createApp();

    server = await new Promise<Server>((resolve, reject) => {
      const listener = app.listen(PORT, "127.0.0.1", () => resolve(listener));
      listener.once("error", reject);
    });
    metric("cloud listener", `127.0.0.1:${PORT}`, "ok");

    const { runUpload } = await import("../src/offline/sync/engine");

    const pendingBefore = await local.syncQueueItem.count({ where: { status: "PENDING" } });

    // ── 5a. Interrupted sync — the power-cut scenario ────────────────────────
    // A partial drain is forced by closing the socket mid-flight, which is what
    // a dying router or a yanked power lead looks like to the transport. The
    // queue must survive it with nothing lost and nothing double-sent.
    const interruptAfterMs = argNumber("--interrupt-after", 4000);

    const interruption = setTimeout(() => {
      server?.close();
      console.log(`  … connection CUT after ${interruptAfterMs}ms (simulated power/network loss)`);
    }, interruptAfterMs);

    const interruptedStarted = process.hrtime.bigint();
    let interruptedError = "";
    try {
      await runUpload("MANUAL");
    } catch (error) {
      interruptedError = error instanceof Error ? error.message : String(error);
    }
    clearTimeout(interruption);
    const interruptedMs = Number(process.hrtime.bigint() - interruptedStarted) / 1e6;

    const afterInterrupt = await local.syncQueueItem.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const countBy = (statusName: string): number =>
      afterInterrupt.find((row) => row.status === statusName)?._count._all ?? 0;

    metric(
      "interrupted upload",
      `${(interruptedMs / 1000).toFixed(1)}s before the cut`,
      undefined,
      interruptedError === "" ? "engine handled it without throwing" : `engine reported: ${interruptedError.slice(0, 60)}`
    );
    metric(
      "queue state after the cut",
      `${countBy("PENDING")} pending · ${countBy("IN_FLIGHT")} in-flight · ${countBy("SYNCED")} synced · ${countBy("FAILED")} failed`
    );

    // ── 5b. Recovery ─────────────────────────────────────────────────────────
    const recoveredRuns = await reconcileInterruptedRuns(local);
    const recoveredItems = await recoverStalledItems(local);

    const strandedAfter = await local.syncQueueItem.count({ where: { status: "IN_FLIGHT" } });

    metric("interrupted runs closed", recoveredRuns.toLocaleString(), undefined,
      "otherwise status reads 'syncing' forever and the lock blocks every future run");
    metric("items recovered to PENDING", recoveredItems.toLocaleString());
    assert("nothing stranded in flight after recovery", strandedAfter === 0,
      strandedAfter === 0 ? "no invisible work" : `${strandedAfter} items LOST`);

    const survived = await local.syncQueueItem.count();
    assert("no queue item lost to the interruption", survived === totalKeys,
      `${survived.toLocaleString()} of ${totalKeys.toLocaleString()}`);

    // ── 5c. Resume and drain to completion ───────────────────────────────────
    server = await new Promise<Server>((resolve, reject) => {
      const listener = app.listen(PORT, "127.0.0.1", () => resolve(listener));
      listener.once("error", reject);
    });
    console.log("  … connection RESTORED, resuming");

    const syncSampler = new ResourceSampler();
    syncSampler.start();
    const syncStarted = process.hrtime.bigint();

    // The engine drains a bounded batch per run, so a full queue needs repeated
    // runs — exactly what the background scheduler does in a store overnight.
    let guard = 0;
    for (;;) {
      const remaining = await local.syncQueueItem.count({ where: { status: "PENDING" } });
      if (remaining === 0 || (guard += 1) > 500) break;
      await runUpload("MANUAL");
    }

    syncDurationMs = Number(process.hrtime.bigint() - syncStarted) / 1e6;
    const syncResources = syncSampler.stop();

    const synced = await local.syncQueueItem.count({ where: { status: "SYNCED" } });
    const failed = await local.syncQueueItem.count({ where: { status: "FAILED" } });
    const stillPending = await local.syncQueueItem.count({ where: { status: "PENDING" } });
    uploadedItems = synced;

    metric(
      "synchronisation duration",
      `${(syncDurationMs / 1000).toFixed(1)}s for ${synced.toLocaleString()} items`,
      undefined,
      `${(synced / (syncDurationMs / 1000)).toFixed(1)} items/s including the interruption recovery`
    );
    metric(
      "projected drain for a full day's queue",
      `${((totalKeys / Math.max(1, synced / (syncDurationMs / 1000))) / 60).toFixed(1)} min`,
      undefined,
      `at the measured rate, for ${totalKeys.toLocaleString()} items`
    );
    metric("CPU during sync", `${syncResources.cpuPercentOfOneCore.toFixed(0)}% of one core`);
    metric(
      "responsiveness during sync",
      syncResources.loopDelayMeasured
        ? `loop delay p99 ${syncResources.loopDelayP99Ms.toFixed(1)}ms`
        : "NOT MEASURED",
      !syncResources.loopDelayMeasured
        ? "warn"
        : syncResources.loopDelayP99Ms < THRESHOLDS.loopDelayP99Ms
          ? "ok"
          : "warn",
      syncResources.loopDelayMeasured
        ? "the till stays usable while the queue drains"
        : "sync too short to sample"
    );

    assert("queue fully drained", stillPending === 0, `${stillPending} still pending`);
    assert("no item failed permanently", failed === 0, `${failed} failed`);

    // =======================================================================
    // 6. CONSISTENCY — do the books balance?
    // =======================================================================
    section("6. POST-SYNC CONSISTENCY");

    const { getCloudClient } = await import("../src/config/prisma");
    const cloud = await getCloudClient();

    await reconcile(local, cloud, { pendingBefore });
  } else {
    section("5. SYNCHRONISATION — SKIPPED");
    metric("cloud sync", "not measured (--local-only)", "warn",
      "sync duration, consistency and duplicate checks are NOT covered by this run");
  }

  // =========================================================================
  // REPORT
  // =========================================================================
  const failures = measurements.filter((m) => m.verdict === "fail");
  const warnings = measurements.filter((m) => m.verdict === "warn");

  const reportPath = writeReport({
    machine,
    failures: failures.length,
    warnings: warnings.length,
    throughput,
    checkout: checkout95,
    scan,
    day: dayResources,
    dbSize,
    syncDurationMs,
    uploadedItems,
    queueDepth,
    localOnly: LOCAL_ONLY,
  });

  console.log(`\n${"=".repeat(78)}`);
  if (failures.length === 0) {
    console.log(`  ✔ PASS — no failures${warnings.length > 0 ? `, ${warnings.length} warning(s) to review` : ""}.`);
  } else {
    console.log(`  ✖ FAIL — ${failures.length} failing check(s):\n`);
    for (const failure of failures) {
      console.log(`    ${failure.section} › ${failure.label}  ${failure.note ?? ""}`);
    }
  }
  console.log(`\n  Report written to: ${reportPath}`);
  console.log("=".repeat(78));

  if (server !== undefined) await new Promise<void>((resolve) => server?.close(() => resolve()));
  await local.$disconnect();

  if (failures.length > 0) process.exitCode = 1;
}

// =============================================================================
// WORKLOAD
// =============================================================================

type Local = ReturnType<typeof import("../src/offline/datasource/localClient").getLocalClient>;

/** One checkout: the real four-write shape a sale produces. */
async function checkout(
  db: Local,
  params: {
    tag: string;
    index: number;
    prefix: string;
    customer: { id: string };
    employee: { id: string };
    variant: { id: string; sku: string };
  }
): Promise<void> {
  const { tag: runTag, index, prefix, customer, employee, variant } = params;

  await db.$transaction(async (tx) => {
    const sale = await tx.sale.create({
      data: {
        saleNumber: `${runTag}-${prefix}-${index}`,
        customerId: customer.id,
        employeeId: employee.id,
        subtotal: "199.00",
        grandTotal: "199.00",
        paidAmount: "199.00",
        status: "COMPLETED",
      },
    });

    await tx.saleItem.create({
      data: {
        saleId: sale.id,
        variantId: variant.id,
        productName: "Stress Tee",
        sizeName: "M",
        colorName: "Blue",
        sku: variant.sku,
        quantity: 1,
        sellingPrice: "199.00",
        costAtSale: "100.00",
        totalPrice: "199.00",
      },
    });

    await tx.payment.create({
      data: { saleId: sale.id, method: "CASH", amount: "199.00" },
    });

    await tx.inventoryMovement.create({
      data: {
        variantId: variant.id,
        type: "SALE",
        quantityChanged: -1,
        stockBefore: 1_000_000 - index,
        stockAfter: 999_999 - index,
        employeeId: employee.id,
      },
    });
  });
}

/**
 * Empties the local mirror.
 *
 * FK enforcement is suspended for the wipe because this list is a subset of the
 * 55-model mirror — rows in tables it does not name still reference the
 * categories and employees being deleted. It is safe precisely because every
 * table below is emptied, and it is re-enabled immediately after.
 */
async function truncateLocal(db: Local): Promise<void> {
  await db.$executeRawUnsafe(`PRAGMA foreign_keys = OFF`);
  try {
    for (const table of [
      "sync_queue", "sync_events", "sync_runs", "sync_conflicts",
      "expenses", "discount_rules",
      "payments", "sale_items", "sales", "inventory_movements",
      "product_variants", "products", "customers", "attendance",
      "employees", "categories", "sizes", "colors",
    ]) {
      await db.$executeRawUnsafe(`DELETE FROM "${table}"`);
    }
  } finally {
    await db.$executeRawUnsafe(`PRAGMA foreign_keys = ON`);
  }
}

// =============================================================================
// RECONCILIATION
//
// The requirement is that inventory, financial records and customers are
// consistent after sync, with no duplicates and no missed records. Counts alone
// would miss a double-apply that also duplicated the money, so revenue is
// compared to the paisa and duplicate detection is done on the natural keys.
// =============================================================================

async function reconcile(
  local: Local,
  cloud: Awaited<ReturnType<typeof import("../src/config/prisma").getCloudClient>>,
  _context: { pendingBefore: number }
): Promise<void> {
  // ── Sales and money ────────────────────────────────────────────────────────
  const localSales = await local.sale.findMany({ where: { saleNumber: { startsWith: tag } } });
  const cloudSales = await cloud.sale.findMany({ where: { saleNumber: { startsWith: tag } } });

  assert("sale COUNT matches", localSales.length === cloudSales.length,
    `local ${localSales.length.toLocaleString()}, cloud ${cloudSales.length.toLocaleString()}`);

  const localRevenue = localSales.reduce((sum, sale) => sum + Number(sale.grandTotal), 0);
  const cloudRevenue = cloudSales.reduce((sum, sale) => sum + Number(sale.grandTotal), 0);

  // The single most important number in the run. If revenue does not match to
  // the paisa, the day's books do not balance and nothing else matters.
  assert("REVENUE matches to the paisa", Math.abs(localRevenue - cloudRevenue) < 0.005,
    `local ₹${localRevenue.toFixed(2)}, cloud ₹${cloudRevenue.toFixed(2)}`);

  const cloudNumbers = new Set(cloudSales.map((sale) => sale.saleNumber));
  const missed = localSales.filter((sale) => !cloudNumbers.has(sale.saleNumber));
  assert("no sale left behind", missed.length === 0,
    missed.length === 0 ? "" : `${missed.length} missing, e.g. ${missed.slice(0, 3).map((s) => s.saleNumber).join(", ")}`);

  // ── Duplicates ─────────────────────────────────────────────────────────────
  // A retry after an interrupted upload is the classic way to double-apply, so
  // this is the check the interruption above exists to justify.
  assert("no DUPLICATE sales in the cloud", cloudNumbers.size === cloudSales.length,
    `${cloudSales.length.toLocaleString()} rows, ${cloudNumbers.size.toLocaleString()} distinct sale numbers`);

  // ── Payments ───────────────────────────────────────────────────────────────
  const localSaleIds = localSales.map((sale) => sale.id);

  const localPayments = await local.payment.aggregate({
    where: { saleId: { in: localSaleIds } },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const cloudPayments = await cloud.payment.aggregate({
    where: { saleId: { in: localSaleIds } },
    _sum: { amount: true },
    _count: { _all: true },
  });

  assert("PAYMENT count matches",
    localPayments._count._all === cloudPayments._count._all,
    `local ${localPayments._count._all.toLocaleString()}, cloud ${cloudPayments._count._all.toLocaleString()}`);

  assert("PAYMENT total matches",
    Math.abs(Number(localPayments._sum.amount ?? 0) - Number(cloudPayments._sum.amount ?? 0)) < 0.005,
    `local ₹${Number(localPayments._sum.amount ?? 0).toFixed(2)}, cloud ₹${Number(cloudPayments._sum.amount ?? 0).toFixed(2)}`);

  // ── Inventory ──────────────────────────────────────────────────────────────
  const variantIds = (
    await local.productVariant.findMany({ where: { sku: { startsWith: tag } }, select: { id: true } })
  ).map((variant) => variant.id);

  const localMovements = await local.inventoryMovement.aggregate({
    where: { variantId: { in: variantIds } },
    _sum: { quantityChanged: true },
    _count: { _all: true },
  });
  const cloudMovements = await cloud.inventoryMovement.aggregate({
    where: { variantId: { in: variantIds } },
    _sum: { quantityChanged: true },
    _count: { _all: true },
  });

  assert("inventory MOVEMENT count matches",
    localMovements._count._all === cloudMovements._count._all,
    `local ${localMovements._count._all.toLocaleString()}, cloud ${cloudMovements._count._all.toLocaleString()}`);

  assert("net STOCK change matches",
    (localMovements._sum.quantityChanged ?? 0) === (cloudMovements._sum.quantityChanged ?? 0),
    `local ${localMovements._sum.quantityChanged}, cloud ${cloudMovements._sum.quantityChanged}`);

  // The ledger must agree with the till: this workload is sales-only, so the
  // net movement is exactly minus the units sold.
  const unitsSold = await local.saleItem.aggregate({
    where: { sku: { startsWith: tag } },
    _sum: { quantity: true },
  });
  assert("stock ledger agrees with the day's trade",
    (cloudMovements._sum.quantityChanged ?? 0) === -(unitsSold._sum.quantity ?? 0),
    `net ${cloudMovements._sum.quantityChanged}, expected ${-(unitsSold._sum.quantity ?? 0)}`);

  // ── Sale items ─────────────────────────────────────────────────────────────
  const localItems = await local.saleItem.count({ where: { sku: { startsWith: tag } } });
  const cloudItems = await cloud.saleItem.count({ where: { sku: { startsWith: tag } } });
  assert("sale ITEM count matches", localItems === cloudItems,
    `local ${localItems.toLocaleString()}, cloud ${cloudItems.toLocaleString()}`);

  // ── Customers ──────────────────────────────────────────────────────────────
  const localCustomers = await local.customer.count({ where: { customerCode: { startsWith: tag } } });
  const cloudCustomers = await cloud.customer.count({ where: { customerCode: { startsWith: tag } } });
  assert("CUSTOMERS reached the cloud", localCustomers === cloudCustomers,
    `local ${localCustomers}, cloud ${cloudCustomers}`);

  // ── Reporting surface ──────────────────────────────────────────────────────
  // Reports are read models over the same rows, so if the aggregate a report
  // would compute differs, a manager sees a different day than the till rang up.
  const localReport = await local.sale.aggregate({
    where: { saleNumber: { startsWith: tag }, status: "COMPLETED" },
    _sum: { grandTotal: true },
    _count: { _all: true },
  });
  const cloudReport = await cloud.sale.aggregate({
    where: { saleNumber: { startsWith: tag }, status: "COMPLETED" },
    _sum: { grandTotal: true },
    _count: { _all: true },
  });

  assert("REPORT aggregate agrees across both databases",
    localReport._count._all === cloudReport._count._all &&
      Math.abs(Number(localReport._sum.grandTotal ?? 0) - Number(cloudReport._sum.grandTotal ?? 0)) < 0.005,
    `local ${localReport._count._all.toLocaleString()} / ₹${Number(localReport._sum.grandTotal ?? 0).toFixed(2)}, ` +
      `cloud ${cloudReport._count._all.toLocaleString()} / ₹${Number(cloudReport._sum.grandTotal ?? 0).toFixed(2)}`);
}

// =============================================================================
// REPORT ARTIFACT
// =============================================================================

function writeReport(data: {
  machine: MachineProfile;
  failures: number;
  warnings: number;
  throughput: number;
  checkout: LatencySummary;
  scan: LatencySummary;
  day: ResourceSummary;
  dbSize: { totalMb: number; mainMb: number; walMb: number };
  syncDurationMs: number;
  uploadedItems: number;
  queueDepth: number;
  localOnly: boolean;
}): string {
  const directory = path.resolve("reports");
  fs.mkdirSync(directory, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(directory, `production-stress-${data.machine.hostname}-${stamp}.json`);

  const payload = {
    verdict: data.failures === 0 ? "PASS" : "FAIL",
    failures: data.failures,
    warnings: data.warnings,
    machine: data.machine,
    workload: { products: PRODUCT_COUNT, transactions: TRANSACTION_COUNT, localOnly: data.localOnly },
    results: {
      throughputSalesPerSecond: data.throughput,
      checkoutLatencyMs: data.checkout,
      scanLatencyMs: data.scan,
      resourcesDuringTrade: data.day,
      databaseSizeMb: data.dbSize,
      syncDurationSeconds: data.syncDurationMs / 1000,
      itemsUploaded: data.uploadedItems,
      queueDepth: data.queueDepth,
    },
    measurements,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  return jsonPath;
}

main().catch((error: unknown) => {
  console.error("\nproduction stress harness crashed:", error);
  process.exit(1);
});
