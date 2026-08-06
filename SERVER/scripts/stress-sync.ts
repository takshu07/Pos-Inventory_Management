/* eslint-disable no-console */
// =============================================================================
// SYNC STRESS AND RECOVERY HARNESS
//
// Answers the questions a store owner would actually ask before trusting this:
//
//   Does capture slow the till down?          measured, with and without triggers
//   Can it hold a whole day of trade?         thousands of transactions, timed
//   How long does the night sync take?        queue drain rate
//   What if the power goes out mid-sync?      interrupted-run recovery, verified
//   What if a record is edited both sides?    conflict resolution at volume
//
// Usage:
//   npm run sync:stress                          local only — no cloud needed
//   npm run sync:stress -- --products 2000 --transactions 5000
//   npm run sync:stress -- --with-cloud --i-accept-writes-to-this-database
//
// ── Why the local half runs without a cloud ──────────────────────────────────
// The expensive, risky parts of an offline day are all local: the write path
// the cashier waits on, the trigger overhead on every one of those writes, and
// the queue's behaviour when it grows to a day's depth. Those can be measured
// on a laptop with no database credentials and no network, which means this can
// be run before anyone provisions anything — and run again on the actual till
// hardware, which is where the number that matters comes from.
//
// The cloud half (upload throughput, conflict resolution across the wire) needs
// a disposable Postgres and is opt-in.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

import "dotenv/config";

process.env["OFFLINE_MODE_ENABLED"] = "true";
process.env["OFFLINE_ROLE"] = "edge";
process.env["OFFLINE_DEVICE_ID"] = process.env["OFFLINE_DEVICE_ID"] ?? "stress-till";
process.env["SYNC_DEVICE_SECRET"] =
  process.env["SYNC_DEVICE_SECRET"] ?? "stress-secret-".padEnd(48, "x");
process.env["SYNC_AUTO_ENABLED"] = "false";
process.env["LOCAL_DATABASE_PATH"] =
  process.env["LOCAL_DATABASE_PATH"] ?? "./data/stress.db";

// =============================================================================
// MEASUREMENT
// =============================================================================

interface Metric {
  readonly label: string;
  readonly value: string;
  /** Set when the number has a pass/fail meaning. */
  readonly verdict?: "ok" | "warn" | "fail";
  readonly note?: string;
}

const metrics: Metric[] = [];

function metric(label: string, value: string, verdict?: Metric["verdict"], note?: string): void {
  metrics.push({ label, value, ...(verdict ? { verdict } : {}), ...(note ? { note } : {}) });

  const mark = verdict === undefined ? " " : verdict === "ok" ? "✔" : verdict === "warn" ? "!" : "✖";
  console.log(`  ${mark} ${label.padEnd(46)} ${value}${note ? `   ${note}` : ""}`);
}

function section(title: string): void {
  console.log(`\n${"─".repeat(78)}\n${title}\n${"─".repeat(78)}`);
}

async function timed<T>(work: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const started = process.hrtime.bigint();
  const result = await work();
  return { result, ms: Number(process.hrtime.bigint() - started) / 1e6 };
}

const rate = (count: number, ms: number): string =>
  ms <= 0 ? "—" : `${Math.round((count / ms) * 1000).toLocaleString()}/s`;

function argNumber(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const parsed = Number.parseInt(process.argv[index + 1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const productCount = argNumber("--products", 1000);
  const transactionCount = argNumber("--transactions", 2000);
  // `--with-cloud` used to exist here, but it never synced anything: it only
  // suppressed the "NOT measured" footer. A flag that turns an honest "this was
  // not measured" into a clean green run is worse than no flag at all, because
  // the run then implies coverage it does not have. It now refuses outright and
  // names the harness that really does exercise the cloud.
  if (process.argv.includes("--with-cloud")) {
    console.error(`
  ✖ --with-cloud is not supported by this harness.

    It never measured the cloud. It only hid the "NOT measured" notice, which
    made a local-only run look like it had covered the upload path.

    This harness is local-only by construction — it measures the till's write
    path, capture overhead and queue behaviour at depth.

    For the cloud half (real signed HTTP, upload drain, full reconciliation):
        npm run sync:validate -- --transactions 200
`);
    process.exitCode = 2;
    return;
  }

  console.log("=".repeat(78));
  console.log("  SYNC STRESS AND RECOVERY");
  console.log(`  products: ${productCount.toLocaleString()}   transactions: ${transactionCount.toLocaleString()}   cloud: no (local-only by design)`);
  console.log("=".repeat(78));

  const { getLocalClient, prepareLocalDatabase } = await import(
    "../src/offline/datasource/localClient"
  );
  const { installChangeCapture, verifyChangeCapture } = await import(
    "../src/offline/sync/changeCapture"
  );
  const { recoverStalledItems } = await import("../src/offline/sync/upload");
  const { reconcileInterruptedRuns } = await import("../src/offline/sync/runLog");

  await prepareLocalDatabase();
  const db = getLocalClient();

  // ── Clean slate ────────────────────────────────────────────────────────────
  section("SETUP");

  await installChangeCapture(db);
  const capture = await verifyChangeCapture(db);
  metric("change-capture triggers", `${capture.installed}`, capture.missing.length === 0 ? "ok" : "fail");

  // This list is a subset of the 55-model mirror, so rows in tables it does not
  // name (expenses, discount_rules, …) still reference the categories and
  // employees being deleted, and SQLite refuses the DELETE. Suspending FK
  // enforcement for the truncation is safe precisely because EVERY table below
  // is emptied — there is no dangling reference left to protect — and it is
  // re-enabled immediately after.
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

  metric("database cleared", "ok");

  const tag = `ST-${Date.now().toString(36)}`;

  // =========================================================================
  // 1. CATALOG — the morning download's write side
  // =========================================================================
  section("1. CATALOG LOAD  (what a morning download writes)");

  const category = await db.category.create({ data: { name: `${tag}-cat` } });
  const size = await db.size.create({ data: { name: `${tag}-M` } });
  const color = await db.color.create({ data: { name: `${tag}-Blue` } });
  const employee = await db.employee.create({
    data: {
      employeeCode: `${tag}-E1`, firstName: "Stress", lastName: "Cashier",
      phone: `9${String(800000001).slice(0, 9)}`, password: "x",
      role: "CASHIER", joiningDate: new Date(),
    },
  });

  const catalogRun = await timed(async () => {
    // Chunked so one transaction does not hold the write lock for the whole
    // load — the same shape the download applier uses, page by page.
    const CHUNK = 250;

    for (let start = 0; start < productCount; start += CHUNK) {
      const end = Math.min(start + CHUNK, productCount);

      await db.$transaction(async (tx) => {
        for (let index = start; index < end; index += 1) {
          const product = await tx.product.create({
            data: { name: `${tag}-P${index}`, categoryId: category.id },
          });

          await tx.productVariant.create({
            data: {
              productId: product.id, sizeId: size.id, colorId: color.id,
              sku: `${tag}-SKU-${index}`,
              costPrice: "100.00", sellingPrice: "199.00", mrp: "249.00",
              currentStock: 1_000_000,
            },
          });
        }
      });
    }
  });

  metric(
    "products + variants written",
    `${(productCount * 2).toLocaleString()} rows in ${catalogRun.ms.toFixed(0)}ms`,
    undefined,
    rate(productCount * 2, catalogRun.ms)
  );

  const variants = await db.productVariant.findMany({
    where: { sku: { startsWith: tag } }, select: { id: true, sku: true },
  });

  // A barcode scan is the single most latency-sensitive read on the till.
  const scanRun = await timed(async () => {
    for (let index = 0; index < 200; index += 1) {
      const target = variants[index % variants.length];
      if (target === undefined) continue;
      await db.productVariant.findFirst({ where: { sku: target.sku } });
    }
  });
  metric(
    "barcode/SKU lookup (the scan path)",
    `${(scanRun.ms / 200).toFixed(2)}ms avg`,
    scanRun.ms / 200 < 5 ? "ok" : "warn",
    "over 1,000 variants"
  );

  // =========================================================================
  // 2. CAPTURE OVERHEAD — does the trigger slow the cashier down?
  // =========================================================================
  section("2. CAPTURE OVERHEAD  (the number that decides if this is usable)");

  const customer = await db.customer.create({
    data: { name: "Stress Walk-In", customerCode: `${tag}-C1`, phone: "9800000002" },
  });

  const SAMPLE = Math.min(200, transactionCount);

  // With triggers installed — the real configuration.
  const withTriggers = await timed(async () => {
    await runTransactions(db, { tag, from: 0, count: SAMPLE, customer, employee, variants, prefix: "WT" });
  });

  // Without. Capture is dropped, measured, then reinstalled — this is the
  // control, and the difference is the true cost of the guarantee.
  await db.$executeRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_capture_%'`
  );
  const triggerNames = await db.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_capture_%'`
  );
  for (const trigger of triggerNames) {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger.name}"`);
  }

  const withoutTriggers = await timed(async () => {
    await runTransactions(db, { tag, from: 0, count: SAMPLE, customer, employee, variants, prefix: "NT" });
  });

  await installChangeCapture(db);

  const perTxWith = withTriggers.ms / SAMPLE;
  const perTxWithout = withoutTriggers.ms / SAMPLE;
  const overheadPct = ((perTxWith - perTxWithout) / perTxWithout) * 100;

  metric("checkout WITH capture", `${perTxWith.toFixed(2)}ms per sale`, undefined, rate(SAMPLE, withTriggers.ms));
  metric("checkout WITHOUT capture", `${perTxWithout.toFixed(2)}ms per sale`, undefined, rate(SAMPLE, withoutTriggers.ms));
  metric(
    "capture overhead",
    `${overheadPct >= 0 ? "+" : ""}${overheadPct.toFixed(1)}%  (${(perTxWith - perTxWithout).toFixed(2)}ms)`,
    perTxWith < 50 ? "ok" : "warn",
    perTxWith < 50 ? "imperceptible at the till" : "review"
  );

  // =========================================================================
  // 3. A FULL DAY
  // =========================================================================
  section("3. FULL BUSINESS DAY");

  await db.$executeRawUnsafe("DELETE FROM sync_queue");

  const dayRun = await timed(async () => {
    await runTransactions(db, {
      tag, from: 0, count: transactionCount, customer, employee, variants, prefix: "DAY",
    });
  });

  const queueDepth = await db.syncQueueItem.count();

  metric(
    "transactions",
    `${transactionCount.toLocaleString()} in ${(dayRun.ms / 1000).toFixed(1)}s`,
    undefined,
    rate(transactionCount, dayRun.ms)
  );
  metric("queue depth after the day", queueDepth.toLocaleString(), queueDepth === transactionCount * 4 ? "ok" : "warn",
    `expected ${(transactionCount * 4).toLocaleString()} (4 writes per sale)`);

  const databasePath = path.resolve(process.env["LOCAL_DATABASE_PATH"] ?? "./data/stress.db");
  const sizeMb = fs.existsSync(databasePath) ? fs.statSync(databasePath).size / 1024 / 1024 : 0;
  metric("local database size", `${sizeMb.toFixed(1)} MB`, sizeMb < 2048 ? "ok" : "warn");

  const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;
  metric("process heap after the day", `${heapMb.toFixed(0)} MB`, heapMb < 512 ? "ok" : "warn",
    "queue is streamed in batches, never loaded whole");

  // =========================================================================
  // 4. QUEUE READS AT DEPTH
  // =========================================================================
  section("4. QUEUE OPERATIONS AT DEPTH");

  const statusRun = await timed(async () => {
    for (let index = 0; index < 20; index += 1) {
      await db.syncQueueItem.groupBy({ by: ["status"], _count: { _all: true } });
    }
  });
  metric(
    "status endpoint aggregate",
    `${(statusRun.ms / 20).toFixed(2)}ms`,
    statusRun.ms / 20 < 100 ? "ok" : "warn",
    "polled by every open till screen"
  );

  const claimRun = await timed(async () => {
    await db.syncQueueItem.findMany({
      where: { status: "PENDING" }, orderBy: { id: "asc" }, take: 200,
    });
  });
  metric("batch claim (200 items)", `${claimRun.ms.toFixed(1)}ms`, claimRun.ms < 200 ? "ok" : "warn");

  const oldestRun = await timed(async () => {
    await db.syncQueueItem.findFirst({
      where: { status: { in: ["PENDING", "IN_FLIGHT"] } },
      orderBy: { localTimestamp: "asc" }, select: { localTimestamp: true },
    });
  });
  metric("oldest-pending lookup", `${oldestRun.ms.toFixed(1)}ms`, oldestRun.ms < 100 ? "ok" : "warn");

  // =========================================================================
  // 5. IDEMPOTENCY AT SCALE
  // =========================================================================
  section("5. IDEMPOTENCY KEYS");

  // `distinct` is a reserved word — an unquoted alias is a syntax error.
  const keyStats = await db.$queryRawUnsafe<Array<{ total: number; distinctKeys: number }>>(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT idempotencyKey) AS "distinctKeys" FROM sync_queue`
  );
  const total = Number(keyStats[0]?.total ?? 0);
  const distinct = Number(keyStats[0]?.distinctKeys ?? 0);

  metric(
    "keys unique across the whole queue",
    `${distinct.toLocaleString()} / ${total.toLocaleString()}`,
    distinct === total ? "ok" : "fail",
    distinct === total ? "no collisions" : "COLLISION — duplicates would be silently dropped"
  );

  const prefixed = await db.syncQueueItem.count({
    where: { idempotencyKey: { startsWith: `${process.env["OFFLINE_DEVICE_ID"]}:` } },
  });
  metric("keys namespaced by device", `${prefixed.toLocaleString()} / ${total.toLocaleString()}`,
    prefixed === total ? "ok" : "fail");

  // =========================================================================
  // 6. INTERRUPTED SYNC — the power-cut scenario
  // =========================================================================
  section("6. INTERRUPTED SYNC RECOVERY");

  // Simulate a run that claimed a batch and then died: items IN_FLIGHT, a run
  // row left RUNNING, and no process to finish either.
  const claimed = await db.syncQueueItem.findMany({
    where: { status: "PENDING" }, orderBy: { id: "asc" }, take: 500,
  });
  await db.syncQueueItem.updateMany({
    where: { id: { in: claimed.map((item) => item.id) } },
    data: { status: "IN_FLIGHT", batchId: "interrupted-batch", lastAttempt: new Date() },
  });
  await db.syncRun.create({
    data: { id: `${tag}-interrupted`, direction: "UPLOAD", trigger: "MANUAL", status: "RUNNING" },
  });

  const beforeRecovery = await db.syncQueueItem.count({ where: { status: "IN_FLIGHT" } });

  const recoveredRuns = await reconcileInterruptedRuns(db);
  const recoveredItems = await recoverStalledItems(db);

  const afterRecovery = await db.syncQueueItem.count({ where: { status: "IN_FLIGHT" } });
  const backToPending = await db.syncQueueItem.count({ where: { status: "PENDING" } });

  metric("items stranded in flight", beforeRecovery.toLocaleString());
  metric("items recovered to PENDING", recoveredItems.toLocaleString(),
    recoveredItems === beforeRecovery ? "ok" : "fail");
  metric("items still stranded", afterRecovery.toLocaleString(), afterRecovery === 0 ? "ok" : "fail",
    afterRecovery === 0 ? "nothing invisible to the next drain" : "LOST WORK");
  metric("interrupted runs closed", recoveredRuns.toLocaleString(), recoveredRuns > 0 ? "ok" : "warn",
    "otherwise status reports 'syncing' forever and the lock blocks every future run");
  metric("queue total preserved", backToPending.toLocaleString(),
    backToPending === total ? "ok" : "fail", `expected ${total.toLocaleString()} — nothing lost`);

  // =========================================================================
  // 7. CAPTURE-OFF DETECTION
  // =========================================================================
  section("7. CAPTURE FAILURE DETECTION");

  await db.syncNodeState.update({
    where: { id: "singleton" }, data: { captureEnabled: false },
  });

  const beforeBlind = await db.syncQueueItem.count();
  await db.customer.create({
    data: { name: "Blind Write", customerCode: `${tag}-BLIND`, phone: "9800000003" },
  });
  const afterBlind = await db.syncQueueItem.count();

  metric("write while capture disabled", afterBlind === beforeBlind ? "NOT captured" : "captured",
    afterBlind === beforeBlind ? "ok" : "fail",
    "confirms suppression works — and why a stuck flag is an ALARM");

  const { repairCaptureFlag } = await import("../src/offline/sync/changeCapture");
  const repaired = await repairCaptureFlag(db);
  metric("startup repair re-enables capture", repaired ? "repaired" : "no-op", repaired ? "ok" : "fail");

  const afterRepair = await db.syncQueueItem.count();
  await db.customer.create({
    data: { name: "After Repair", customerCode: `${tag}-AFTER`, phone: "9800000004" },
  });
  metric("capture resumes after repair",
    (await db.syncQueueItem.count()) > afterRepair ? "captured" : "NOT captured",
    (await db.syncQueueItem.count()) > afterRepair ? "ok" : "fail");

  // =========================================================================
  // 8. CONFLICT RESOLUTION AT VOLUME
  // =========================================================================
  section("8. CONFLICT RESOLUTION");

  const { resolveDownloadConflict, resolveUploadConflict } = await import(
    "../src/offline/sync/conflicts"
  );
  const { requirePolicy } = await import("../src/offline/sync/policy");

  const productPolicy = requirePolicy("Product");
  const salePolicy = requirePolicy("Sale");

  const conflictRun = await timed(async () => {
    for (let index = 0; index < 10_000; index += 1) {
      resolveDownloadConflict(
        productPolicy,
        { id: `p${index}`, name: "Tee", sellingPrice: "199.00" },
        { id: `p${index}`, name: "Tee", sellingPrice: "249.00" }
      );
      resolveUploadConflict({
        policy: salePolicy,
        cloudRow: { id: `s${index}`, grandTotal: "199.00" },
        localRow: { id: `s${index}`, grandTotal: "199.00" },
        operation: "UPDATE",
      });
    }
  });
  metric("conflict decisions", `20,000 in ${conflictRun.ms.toFixed(0)}ms`, undefined,
    rate(20_000, conflictRun.ms));

  const cloudWins = resolveDownloadConflict(
    productPolicy,
    { id: "p1", sellingPrice: "199.00" },
    { id: "p1", sellingPrice: "249.00" }
  );
  metric("cloud wins on a price change", `${cloudWins.winner}, logged=${cloudWins.logged}`,
    cloudWins.winner === "CLOUD" && cloudWins.logged ? "ok" : "fail");

  const localWins = resolveUploadConflict({
    policy: salePolicy,
    cloudRow: { id: "s1", grandTotal: "150.00" },
    localRow: { id: "s1", grandTotal: "199.00" },
    operation: "UPDATE",
  });
  metric("till wins on a recorded sale", `${localWins.winner}`,
    localWins.winner === "LOCAL" ? "ok" : "fail");

  const noiseFree = resolveDownloadConflict(
    productPolicy,
    { id: "p1", sellingPrice: "12.50" },
    { id: "p1", sellingPrice: 12.5 }
  );
  metric("Postgres 12.50 vs SQLite 12.5", noiseFree.logged ? "CONFLICT" : "identical",
    noiseFree.logged ? "fail" : "ok",
    noiseFree.logged ? "would log a false conflict on every priced row" : "no false conflicts");

  // =========================================================================
  // SUMMARY
  // =========================================================================
  const failures = metrics.filter((m) => m.verdict === "fail");
  const warnings = metrics.filter((m) => m.verdict === "warn");

  console.log(`\n${"=".repeat(78)}`);
  if (failures.length === 0) {
    console.log(`  ✔ No failures${warnings.length > 0 ? `, ${warnings.length} warning(s)` : ""}.`);
  } else {
    console.log(`  ✖ ${failures.length} FAILURE(S):\n`);
    for (const failure of failures) console.log(`    ${failure.label}: ${failure.value} ${failure.note ?? ""}`);
  }

  console.log(`
  Cloud-side throughput (upload rate, wire conflicts) was NOT measured.
  This harness is local-only by construction: it measures the till's write
  path, capture overhead and queue behaviour, none of which need a cloud.

  For the cloud half — real signed HTTP, upload drain, reconciliation —
  run the end-to-end validator instead:
      npm run sync:validate -- --transactions 200`);
  console.log("=".repeat(78));

  await db.$disconnect();
  if (failures.length > 0) process.exitCode = 1;
}

// =============================================================================
// WORKLOAD
// =============================================================================

async function runTransactions(
  db: ReturnType<typeof import("../src/offline/datasource/localClient").getLocalClient>,
  params: {
    tag: string;
    from: number;
    count: number;
    prefix: string;
    customer: { id: string };
    employee: { id: string };
    variants: Array<{ id: string; sku: string }>;
  }
): Promise<void> {
  const { tag, from, count, prefix, customer, employee, variants } = params;

  for (let index = from; index < from + count; index += 1) {
    const variant = variants[index % variants.length];
    if (variant === undefined) continue;

    // One transaction, four captured writes — the real checkout shape.
    await db.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          saleNumber: `${tag}-${prefix}-${index}`,
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
          saleId: sale.id, variantId: variant.id,
          productName: "Stress Tee", sizeName: "M", colorName: "Blue",
          sku: variant.sku, quantity: 1,
          sellingPrice: "199.00", costAtSale: "100.00", totalPrice: "199.00",
        },
      });

      await tx.payment.create({
        data: { saleId: sale.id, method: "CASH", amount: "199.00" },
      });

      await tx.inventoryMovement.create({
        data: {
          variantId: variant.id, type: "SALE", quantityChanged: -1,
          stockBefore: 1_000_000 - index, stockAfter: 999_999 - index,
          employeeId: employee.id,
        },
      });
    });
  }
}

main().catch((error: unknown) => {
  console.error("\nstress harness crashed:", error);
  process.exit(1);
});
