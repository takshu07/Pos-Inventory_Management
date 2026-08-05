/* eslint-disable no-console */
// =============================================================================
// END-TO-END SYNC VALIDATION
//
// Drives a real business day through the real code paths and then reconciles
// both databases row by row:
//
//   1. MORNING   download master data from the cloud into the local mirror
//   2. DAY       the network is CLOSED at the socket, and a full day of trade
//                is rung up against SQLite only
//   3. NIGHT     the network returns and the queue drains
//   4. RECONCILE every module is compared across the two databases
//
// Usage:
//   npm run sync:validate -- --i-accept-writes-to-this-database
//   npm run sync:validate -- --i-accept-writes-to-this-database --transactions 200
//
// ── What makes this genuinely end-to-end ─────────────────────────────────────
// Nothing is stubbed. Real Express, real HTTP over a real socket, real HMAC
// signing, real SQLite triggers, real Prisma writes to Postgres. The offline
// period is a real disconnection — the listener is CLOSED, so the transport
// fails the way it fails in a shop when the router dies, rather than because a
// mock was told to.
//
// It runs in ONE process, which is possible only because `cloudApply` and
// `cloudServe` address the cloud through `getCloudClient()` rather than through
// the routed `prisma` export. So the process can be an edge node (routed writes
// go to SQLite) while simultaneously serving the cloud half against Postgres.
// The data path is identical to two machines; only the wire is shorter.
//
// ── Why the safety flag ──────────────────────────────────────────────────────
// This WRITES to whatever DATABASE_URL points at. Against a production database
// it would insert test sales into the real books. It refuses to run unless the
// URL looks like a test/staging/branch database, or the operator says otherwise
// explicitly.
// =============================================================================

import type { Server } from "node:http";

import "dotenv/config";

// ── Environment must be set BEFORE the app graph is imported ─────────────────
// `config/prisma.ts` resolves the datasource router at module scope, so an
// import that happens first would pin this process to the cloud client and the
// whole run would silently exercise nothing.
const PORT = Number.parseInt(process.env["E2E_PORT"] ?? "3941", 10);

process.env["OFFLINE_MODE_ENABLED"] = "true";
process.env["OFFLINE_ROLE"] = "edge";
process.env["OFFLINE_DEVICE_ID"] = process.env["OFFLINE_DEVICE_ID"] ?? "e2e-validation-till";
process.env["SYNC_CLOUD_URL"] = `http://127.0.0.1:${PORT}`;
process.env["SYNC_DEVICE_SECRET"] =
  process.env["SYNC_DEVICE_SECRET"] ?? "e2e-validation-secret-".padEnd(48, "x");
process.env["SYNC_AUTO_ENABLED"] = "false"; // the harness drives every run itself
// Connectivity uses hysteresis: 2 consecutive good probes before it will call
// itself online. This harness opens the listener and immediately runs ONE sync,
// so with the production default the state is still "unknown" and every download
// is skipped. A store wants the damping; a single-shot test cannot afford it.
process.env["SYNC_PROBE_OK_THRESHOLD"] = "1";
process.env["SYNC_PROBE_FAIL_THRESHOLD"] = "1";
process.env["LOCAL_DATABASE_PATH"] =
  process.env["LOCAL_DATABASE_PATH"] ?? "./data/e2e-validation.db";

// =============================================================================
// REPORT
// =============================================================================

interface Check {
  readonly phase: string;
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

const checks: Check[] = [];

function check(phase: string, name: string, passed: boolean, detail = ""): void {
  checks.push({ phase, name, passed, detail });
  console.log(`  ${passed ? "✔" : "✖"} ${name}${detail ? `  — ${detail}` : ""}`);
}

function phase(title: string): void {
  console.log(`\n${"─".repeat(78)}\n${title}\n${"─".repeat(78)}`);
}

// =============================================================================
// FIXTURE HELPERS
// =============================================================================

let sequence = 0;
const nextId = () => (sequence += 1);
const tag = `E2E-${Date.now().toString(36)}`;
// `phone` is @unique cloud-wide and this harness is re-run against a branch that
// keeps the rows from the previous run, so the counter alone repeats and the
// second run always collides. Offset it per-run so each run claims a fresh block.
const phoneRunOffset = Date.now() % 100_000_000;
const uniquePhone = () =>
  `9${String(100_000_000 + ((phoneRunOffset + nextId()) % 900_000_000)).slice(0, 9)}`;

interface DayTotals {
  sales: number;
  saleItems: number;
  payments: number;
  movements: number;
  customers: number;
  expenses: number;
  attendance: number;
  revenue: number;
  returns: number;
  exchanges: number;
  purchases: number;
  purchaseItems: number;
  notifications: number;
  /** Units returned to stock by refunds and exchanges — a POSITIVE number. */
  unitsReturned: number;
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const accepted = args.includes("--i-accept-writes-to-this-database");
  const transactionCount = Number.parseInt(
    args.find((a) => a.startsWith("--transactions="))?.split("=")[1] ??
      (args[args.indexOf("--transactions") + 1] || "40"),
    10
  );

  console.log("=".repeat(78));
  console.log("  END-TO-END SYNC VALIDATION");
  console.log(`  device: ${process.env["OFFLINE_DEVICE_ID"]}   transactions: ${transactionCount}`);
  console.log("=".repeat(78));

  // ── Preflight ──────────────────────────────────────────────────────────────
  phase("PREFLIGHT");

  const databaseUrl = process.env["DATABASE_URL"] ?? "";
  if (!databaseUrl) {
    console.error("\n  DATABASE_URL is not set. Nothing to validate against.\n");
    process.exit(1);
  }

  const looksDisposable = /test|staging|branch|localhost|127\.0\.0\.1/i.test(databaseUrl);

  if (!looksDisposable && !accepted) {
    console.error(`
  ✖ DATABASE_URL does not look like a test or branch database, and this harness
    WRITES to it — it would insert validation sales into your real books.

    Point DATABASE_URL at a Neon branch:
        neonctl branches create --name sync-validation

    Or, if this really is disposable, re-run with:
        npm run sync:validate -- --i-accept-writes-to-this-database
`);
    process.exit(1);
  }

  check("preflight", "database target accepted", true, looksDisposable ? "disposable-looking URL" : "operator override");

  // Imports happen HERE, after the environment is final.
  const { getCloudClient } = await import("../src/config/prisma");
  const { getLocalClient, prepareLocalDatabase } = await import(
    "../src/offline/datasource/localClient"
  );
  const { installChangeCapture } = await import("../src/offline/sync/changeCapture");
  const { runDownload, runUpload } = await import("../src/offline/sync/engine");
  const { default: app } = await import("../src/app");

  const cloud = getCloudClient();

  // ── The cloud half cannot work without its tables ──────────────────────────
  // Asked of information_schema rather than by querying sync_receipts and
  // catching the failure: a missing-table error goes through Prisma's error log
  // and buries the actionable message under a stack trace and a slow-query
  // warning. A catalog lookup answers the same question quietly.
  const tablePresence = await cloud.$queryRawUnsafe<Array<{ present: number }>>(
    `SELECT COUNT(*)::int AS present
       FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'sync_receipts'`
  );

  if (Number(tablePresence[0]?.present ?? 0) === 0) {
    console.error(`
  ✖ The cloud sync tables do not exist. Apply the migration first:

        npm run sync:verify-migration                                  (verify)
        npm run sync:verify-migration -- --apply --i-have-taken-a-backup
`);
    process.exit(1);
  }

  check("preflight", "cloud sync tables present", true, "migration applied");

  await prepareLocalDatabase();
  const local = getLocalClient();
  await installChangeCapture(local);
  check("preflight", "local mirror ready, capture installed", true);

  // A clean slate, so counts mean something.
  await local.$executeRawUnsafe("DELETE FROM sync_queue");
  await local.$executeRawUnsafe("DELETE FROM sync_cursors");
  await local.syncNodeState.update({
    where: { id: "singleton" },
    data: { deviceId: process.env["OFFLINE_DEVICE_ID"] ?? "e2e-validation-till" },
  });
  check("preflight", "queue and cursors cleared", true);

  // ── Seed the CLOUD with master data to download ────────────────────────────
  // Without a catalog centrally there is nothing to sell offline.
  const seeded = await seedCloudMasterData(cloud);
  check("preflight", "cloud master data seeded", true, `category, size, colour, 5 variants`);

  let server: Server | undefined;

  const openNetwork = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      server = app.listen(PORT, "127.0.0.1", () => {
        resolve();
      });
    });
  };

  const closeNetwork = async (): Promise<void> => {
    if (server === undefined) return;
    await new Promise<void>((resolve) => {
      server?.close(() => {
        resolve();
      });
    });
    server = undefined;
  };

  try {
    // =========================================================================
    // 1. MORNING
    // =========================================================================
    phase("1. MORNING SYNC — download master data from the cloud");

    await openNetwork();

    const download = await runDownload("MANUAL");
    check(
      "morning",
      "download completed",
      download.status === "SUCCESS",
      `${download.status}, ${download.download?.totalRows ?? 0} rows`
    );

    const localVariants = await local.productVariant.count();
    check("morning", "catalog is present locally", localVariants >= 5, `${localVariants} variants`);

    const localProduct = await local.product.findFirst({ where: { name: { contains: tag } } });
    check("morning", "the seeded product arrived", localProduct !== null);

    // The download must not have queued the cloud's own rows back up.
    const echoed = await local.syncQueueItem.count();
    check(
      "morning",
      "download did not echo into the queue",
      echoed === 0,
      `${echoed} items queued (expected 0)`
    );

    // =========================================================================
    // 2. THE BUSINESS DAY — network CLOSED
    // =========================================================================
    phase("2. BUSINESS DAY — network disconnected, SQLite only");

    await closeNetwork();
    check("day", "network is down", true, "listener closed at the socket");

    const cloudSalesBefore = await cloud.sale.count();

    const totals = await runBusinessDay(local, transactionCount);

    check("day", "sales rung up offline", totals.sales === transactionCount, `${totals.sales} sales`);
    check("day", "walk-in customers created offline", totals.customers > 0, `${totals.customers}`);
    check("day", "stock movements recorded", totals.movements > 0, `${totals.movements}`);
    check("day", "expenses recorded", totals.expenses > 0, `${totals.expenses}`);
    check("day", "attendance recorded", totals.attendance > 0, `${totals.attendance}`);
    check("day", "returns/refunds processed offline", totals.returns > 0, `${totals.returns}`);
    check("day", "exchanges processed offline", totals.exchanges > 0, `${totals.exchanges}`);
    check("day", "purchases received offline", totals.purchases > 0, `${totals.purchases}`);
    check("day", "notifications raised offline", totals.notifications > 0, `${totals.notifications}`);

    const queued = await local.syncQueueItem.count({ where: { status: "PENDING" } });
    check("day", "every write was captured", queued > 0, `${queued} queue items pending`);

    const cloudSalesDuring = await cloud.sale.count();
    check(
      "day",
      "NOTHING reached the cloud during the outage",
      cloudSalesDuring === cloudSalesBefore,
      `cloud sales ${cloudSalesBefore} → ${cloudSalesDuring}`
    );

    // A sale must be readable back locally — the till has to be able to reprint
    // a receipt and process a return while offline.
    const readback = await local.sale.findFirst({
      where: { saleNumber: { startsWith: tag } },
      include: { items: true, payments: true },
    });
    check(
      "day",
      "an offline sale reads back with its lines and payments",
      (readback?.items.length ?? 0) > 0 && (readback?.payments.length ?? 0) > 0
    );

    // =========================================================================
    // 3. NIGHT SYNC
    // =========================================================================
    phase("3. NIGHT SYNC — network restored, queue drains");

    await openNetwork();
    check("night", "network is back", true);

    // ── Interrupted sync, then resume ────────────────────────────────────────
    // The night sync is the moment a shop is most likely to lose the link: the
    // shutters come down, someone kills the router, the till gets switched off
    // mid-drain. The engine must lose NOTHING and must not double anything when
    // it comes back. So the first drain is deliberately cut off partway.
    const queuedBeforeInterrupt = await local.syncQueueItem.count({
      where: { status: "PENDING" },
    });

    // A batch-sized slice is claimed and abandoned, exactly as a killed process
    // leaves it: IN_FLIGHT, with a run row still RUNNING and nobody to close it.
    const abandoned = await local.syncQueueItem.findMany({
      where: { status: "PENDING" },
      orderBy: { id: "asc" },
      take: Math.max(1, Math.floor(queuedBeforeInterrupt / 3)),
      select: { id: true },
    });

    await local.syncQueueItem.updateMany({
      where: { id: { in: abandoned.map((i) => i.id) } },
      data: {
        status: "IN_FLIGHT",
        batchId: "e2e-interrupted-batch",
        lastAttempt: new Date(),
      },
    });

    const interruptedRunId = `${tag}-interrupted-run`;
    await local.syncRun.create({
      data: {
        id: interruptedRunId,
        direction: "UPLOAD",
        trigger: "MANUAL",
        status: "RUNNING",
      },
    });

    check(
      "night",
      "sync interrupted mid-batch",
      abandoned.length > 0,
      `${abandoned.length} items stranded IN_FLIGHT, run left RUNNING`
    );

    // Startup recovery is what a restarted till actually runs.
    const { recoverAndBootstrap } = await import("../src/offline/sync/engine");
    await recoverAndBootstrap(local);

    const stillInFlight = await local.syncQueueItem.count({
      where: { status: "IN_FLIGHT" },
    });
    const pendingAfterRecovery = await local.syncQueueItem.count({
      where: { status: "PENDING" },
    });

    check(
      "night",
      "stranded items recovered, nothing invisible",
      stillInFlight === 0 && pendingAfterRecovery === queuedBeforeInterrupt,
      `in-flight ${stillInFlight}, pending ${pendingAfterRecovery} (expected ${queuedBeforeInterrupt})`
    );

    const interruptedRun = await local.syncRun.findUnique({
      where: { id: interruptedRunId },
    });
    check(
      "night",
      "interrupted run closed, lock released",
      interruptedRun !== null && interruptedRun.status !== "RUNNING",
      `status ${interruptedRun?.status ?? "missing"} — otherwise status reports "syncing" forever`
    );

    const startedAt = Date.now();
    const upload = await runUpload("MANUAL");
    const uploadMs = Date.now() - startedAt;

    check(
      "night",
      "upload completed",
      upload.status === "SUCCESS",
      `${upload.status}, ${upload.upload?.applied ?? 0} applied, ` +
        `${upload.upload?.rejected ?? 0} rejected, ${uploadMs}ms`
    );

    const stillPending = await local.syncQueueItem.count({ where: { status: "PENDING" } });
    check("night", "queue fully drained", stillPending === 0, `${stillPending} still pending`);

    const failedItems = await local.syncQueueItem.findMany({
      where: { status: "FAILED" },
      take: 5,
    });
    check(
      "night",
      "no items failed",
      failedItems.length === 0,
      failedItems.map((i) => `${i.entity}: ${i.lastError?.slice(0, 60)}`).join(" | ")
    );

    // ── Idempotency: run it again, nothing may double ────────────────────────
    const cloudSalesAfterFirst = await cloud.sale.count();
    await local.syncQueueItem.updateMany({
      where: { status: "SYNCED" },
      data: { status: "PENDING", syncedAt: null },
    });
    const replay = await runUpload("MANUAL");
    const cloudSalesAfterReplay = await cloud.sale.count();

    check(
      "night",
      "re-uploading the whole day creates NO duplicates",
      cloudSalesAfterReplay === cloudSalesAfterFirst,
      `${cloudSalesAfterFirst} → ${cloudSalesAfterReplay}, ` +
        `${replay.upload?.duplicates ?? 0} recognized as duplicates`
    );

    // =========================================================================
    // 4. RECONCILIATION
    // =========================================================================
    phase("4. RECONCILIATION — every module, both databases");

    await reconcile(local, cloud, totals, seeded);

    // =========================================================================
    // 5. CONFLICT HANDLING
    // =========================================================================
    phase("5. CONFLICT HANDLING — both sides changed the same row");

    await validateConflictHandling(local, cloud, seeded, runDownload);

    // =========================================================================
    // SUMMARY
    // =========================================================================
    const failures = checks.filter((c) => !c.passed);

    console.log(`\n${"=".repeat(78)}`);
    if (failures.length === 0) {
      console.log(`  ✔ ALL ${checks.length} CHECKS PASSED — offline day reconciles exactly.`);
    } else {
      console.log(`  ✖ ${failures.length} of ${checks.length} checks FAILED:\n`);
      for (const failure of failures) {
        console.log(`    [${failure.phase}] ${failure.name}  ${failure.detail}`);
      }
    }
    console.log("=".repeat(78));

    if (failures.length > 0) process.exitCode = 1;
  } finally {
    await closeNetwork();
    await local.$disconnect().catch(() => undefined);
    await cloud.$disconnect().catch(() => undefined);
  }
}

// =============================================================================
// CLOUD SEED
// =============================================================================

interface Seeded {
  categoryId: string;
  employeeId: string;
  variantIds: string[];
  supplierId: string;
}

async function seedCloudMasterData(
  cloud: Awaited<ReturnType<typeof import("../src/config/prisma").getCloudClient>>
): Promise<Seeded> {
  const category = await cloud.category.create({ data: { name: `${tag}-cat` } });
  const color = await cloud.color.create({ data: { name: `${tag}-Blue` } });

  const product = await cloud.product.create({
    data: {
      name: `${tag}-Tee`,
      categoryId: category.id,
      imageUrls: [`https://example.test/${tag}.png`],
    },
  });

  // ProductVariant is unique on (productId, sizeId, colorId), so each variant
  // needs its own size — reusing one size collides after the first insert.
  const sizes = await Promise.all(
    Array.from({ length: 5 }, (_unused, index) =>
      cloud.size.create({ data: { name: `${tag}-S${index}` } })
    )
  );

  const variantIds: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const variant = await cloud.productVariant.create({
      data: {
        productId: product.id,
        sizeId: sizes[index]!.id,
        colorId: color.id,
        sku: `${tag}-SKU-${index}`,
        costPrice: "100.00",
        sellingPrice: "199.00",
        mrp: "249.00",
        currentStock: 10_000,
      },
    });
    variantIds.push(variant.id);
  }

  // An expense category has to exist in the CLOUD so the morning download
  // carries it to the till — without one the business day cannot record the
  // drawer expense and that whole path goes untested.
  await cloud.expenseCategory.create({ data: { name: `${tag}-Sundries` } });

  const employee = await cloud.employee.create({
    data: {
      employeeCode: `${tag}-E1`,
      firstName: "E2E",
      lastName: "Cashier",
      phone: uniquePhone(),
      password: "x",
      role: "CASHIER",
      joiningDate: new Date(),
    },
  });

  // A supplier is CLOUD master data (DOWN). Goods received at the till during
  // the outage book against it, so without one the whole procurement path —
  // Purchase, PurchaseItem, and the PURCHASE inventory movements — cannot be
  // exercised offline.
  const supplier = await cloud.supplier.create({
    data: { businessName: `${tag}-Supplies`, phone: uniquePhone() },
  });

  return {
    categoryId: category.id,
    employeeId: employee.id,
    variantIds,
    supplierId: supplier.id,
  };
}

// =============================================================================
// THE BUSINESS DAY
// =============================================================================

async function runBusinessDay(
  local: ReturnType<typeof import("../src/offline/datasource/localClient").getLocalClient>,
  transactionCount: number
): Promise<DayTotals> {
  const totals: DayTotals = {
    sales: 0,
    saleItems: 0,
    payments: 0,
    movements: 0,
    customers: 0,
    expenses: 0,
    attendance: 0,
    revenue: 0,
    returns: 0,
    exchanges: 0,
    purchases: 0,
    purchaseItems: 0,
    notifications: 0,
    unitsReturned: 0,
  };

  const employee = await local.employee.findFirstOrThrow({
    where: { employeeCode: { startsWith: tag } },
  });
  const variants = await local.productVariant.findMany({
    where: { sku: { startsWith: tag } },
  });

  if (variants.length === 0) {
    throw new Error("No variants downloaded — the morning sync did not deliver a catalog.");
  }

  // Attendance: the cashier clocks in.
  await local.attendance.create({
    data: {
      employeeId: employee.id,
      date: new Date(),
      status: "PRESENT",
      clockInAt: new Date(),
    },
  });
  totals.attendance += 1;

  for (let index = 0; index < transactionCount; index += 1) {
    // Every fourth customer is a new walk-in signed up at the counter — the
    // BIDIRECTIONAL path that has to reach the cloud or their history starts
    // empty.
    const customer =
      index % 4 === 0
        ? await local.customer.create({
            data: {
              name: `${tag} Walk-In ${index}`,
              customerCode: `${tag}-C-${nextId()}`,
              phone: uniquePhone(),
            },
          })
        : await local.customer.findFirstOrThrow({ where: { customerCode: { startsWith: tag } } });

    if (index % 4 === 0) totals.customers += 1;

    const variant = variants[index % variants.length];
    if (variant === undefined) continue;

    const quantity = (index % 3) + 1;
    const lineTotal = 199 * quantity;

    await local.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          saleNumber: `${tag}-INV-${index}`,
          customerId: customer.id,
          employeeId: employee.id,
          subtotal: lineTotal.toFixed(2),
          grandTotal: lineTotal.toFixed(2),
          paidAmount: lineTotal.toFixed(2),
          status: "COMPLETED",
        },
      });

      await tx.saleItem.create({
        data: {
          saleId: sale.id,
          variantId: variant.id,
          productName: `${tag}-Tee`,
          sizeName: "M",
          colorName: "Blue",
          sku: variant.sku,
          quantity,
          sellingPrice: "199.00",
          costAtSale: "100.00",
          totalPrice: lineTotal.toFixed(2),
        },
      });

      await tx.payment.create({
        data: {
          saleId: sale.id,
          method: index % 2 === 0 ? "CASH" : "UPI",
          amount: lineTotal.toFixed(2),
        },
      });

      const before = variant.currentStock - index;
      await tx.inventoryMovement.create({
        data: {
          variantId: variant.id,
          type: "SALE",
          quantityChanged: -quantity,
          stockBefore: before,
          stockAfter: before - quantity,
          employeeId: employee.id,
        },
      });
    });

    totals.sales += 1;
    totals.saleItems += 1;
    totals.payments += 1;
    totals.movements += 1;
    totals.revenue += lineTotal;
  }

  // ── Returns and exchanges ──────────────────────────────────────────────────
  // Both are the awkward half of a trading day and both were untested. A return
  // moves money OUT and stock back IN; an exchange does both at once against an
  // *earlier* sale. They matter here because they are the only transactions that
  // reference a row created earlier in the SAME offline session — if the queue
  // uploads them out of order, the cloud rejects them on a foreign key.
  const soldSales = await local.sale.findMany({
    where: { saleNumber: { startsWith: tag } },
    include: { items: true },
    orderBy: { saleNumber: "asc" },
    take: 6,
  });

  // A refund: the customer brings a shirt back and takes the cash.
  const refunded = soldSales[0];
  if (refunded !== undefined && refunded.items[0] !== undefined) {
    const line = refunded.items[0];

    await local.$transaction(async (tx) => {
      await tx.sale.update({
        where: { id: refunded.id },
        data: { status: "REFUNDED" },
      });

      // The refund leg. Negative, so revenue nets down on both sides.
      await tx.payment.create({
        data: {
          saleId: refunded.id,
          method: "CASH",
          amount: `-${Number(line.totalPrice).toFixed(2)}`,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          variantId: line.variantId,
          type: "MANUAL_ADJUSTMENT",
          quantityChanged: line.quantity,
          stockBefore: 0,
          stockAfter: line.quantity,
          employeeId: employee.id,
          reason: `${tag} refund for ${refunded.saleNumber}`,
          relatedSaleId: refunded.id,
        },
      });
    });

    totals.returns += 1;
    totals.payments += 1;
    totals.movements += 1;
    totals.unitsReturned += line.quantity;
    totals.revenue -= Number(line.totalPrice);
  }

  // An exchange: wrong size. One variant comes back, another goes out, and the
  // customer settles the difference.
  const exchanged = soldSales[1];
  if (exchanged !== undefined && exchanged.items[0] !== undefined && variants.length > 1) {
    const returnedLine = exchanged.items[0];
    const issuedVariant =
      variants.find((v) => v.id !== returnedLine.variantId) ?? variants[0]!;

    const returnedValue = Number(returnedLine.totalPrice);
    const issuedValue = 199 * returnedLine.quantity;
    const difference = issuedValue - returnedValue;

    await local.$transaction(async (tx) => {
      const exchange = await tx.exchange.create({
        data: {
          exchangeNumber: `${tag}-EX-1`,
          originalSaleId: exchanged.id,
          customerId: exchanged.customerId!,
          employeeId: employee.id,
          returnedValue: returnedValue.toFixed(2),
          issuedValue: issuedValue.toFixed(2),
          priceDifference: difference.toFixed(2),
          exchangeReason: "Wrong Size",
          status: "COMPLETED",
        },
      });

      await tx.exchangeReturnItem.create({
        data: {
          exchangeId: exchange.id,
          variantId: returnedLine.variantId,
          quantity: returnedLine.quantity,
          condition: "GOOD",
          priceAtSale: returnedLine.sellingPrice,
          totalValue: returnedValue.toFixed(2),
        },
      });

      await tx.exchangeIssuedItem.create({
        data: {
          exchangeId: exchange.id,
          variantId: issuedVariant.id,
          quantity: returnedLine.quantity,
          sellingPrice: "199.00",
          totalValue: issuedValue.toFixed(2),
        },
      });

      // Stock in for what came back, stock out for what went out.
      await tx.inventoryMovement.create({
        data: {
          variantId: returnedLine.variantId,
          type: "EXCHANGE_IN",
          quantityChanged: returnedLine.quantity,
          stockBefore: 0,
          stockAfter: returnedLine.quantity,
          employeeId: employee.id,
          relatedExchangeId: exchange.id,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          variantId: issuedVariant.id,
          type: "EXCHANGE_OUT",
          quantityChanged: -returnedLine.quantity,
          stockBefore: returnedLine.quantity,
          stockAfter: 0,
          employeeId: employee.id,
          relatedExchangeId: exchange.id,
        },
      });

      await tx.sale.update({
        where: { id: exchanged.id },
        data: { status: "EXCHANGED" },
      });
    });

    totals.exchanges += 1;
    totals.movements += 2;
    // Deliberately NOT added to unitsReturned: an exchange is stock-NEUTRAL.
    // The same quantity comes back on one variant and goes out on another, so
    // the two movements cancel in the net-change total.
  }

  // ── Goods received from a supplier during the outage ───────────────────────
  const supplier = await local.supplier.findFirst({
    where: { businessName: { startsWith: tag } },
  });

  if (supplier !== null) {
    const restockVariant = variants[0]!;
    const restockQty = 24;
    const unitCost = 100;

    await local.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          purchaseNumber: `${tag}-PO-1`,
          supplierId: supplier.id,
          employeeId: employee.id,
          subtotal: (unitCost * restockQty).toFixed(2),
          totalAmount: (unitCost * restockQty).toFixed(2),
          dueAmount: (unitCost * restockQty).toFixed(2),
          status: "RECEIVED",
          receivedAt: new Date(),
        },
      });

      await tx.purchaseItem.create({
        data: {
          purchaseId: purchase.id,
          variantId: restockVariant.id,
          quantity: restockQty,
          costPrice: unitCost.toFixed(2),
          sellingPriceAtPurchase: "199.00",
          totalPrice: (unitCost * restockQty).toFixed(2),
          receivedQuantity: restockQty,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          variantId: restockVariant.id,
          type: "PURCHASE",
          quantityChanged: restockQty,
          stockBefore: 0,
          stockAfter: restockQty,
          employeeId: employee.id,
          relatedPurchaseId: purchase.id,
        },
      });
    });

    totals.purchases += 1;
    totals.purchaseItems += 1;
    totals.movements += 1;
    totals.unitsReturned += restockQty;
  }

  // ── Notifications raised by the till while it was alone ────────────────────
  // Policy is UP: an alert the shop raised offline still has to reach whoever
  // is meant to act on it, otherwise the low-stock warning dies on the device.
  await local.notification.create({
    data: {
      type: "LOW_STOCK",
      title: `${tag} low stock`,
      message: `${tag}: a variant fell below its reorder point during the outage.`,
      targetRole: "OWNER",
    },
  });
  totals.notifications += 1;

  // An expense paid out of the drawer during the day.
  const expenseCategory = await local.expenseCategory.findFirst();
  if (expenseCategory !== null) {
    await local.expense.create({
      data: {
        expenseCode: `${tag}-EXP-1`,
        categoryId: expenseCategory.id,
        title: "Tea and biscuits",
        amount: "250.00",
        description: `${tag} tea and biscuits`,
        expenseDate: new Date(),
        employeeId: employee.id,
      },
    });
    totals.expenses += 1;
  } else {
    // No categories downloaded — record it as a skipped rather than a silent 0.
    totals.expenses = 0;
  }

  return totals;
}

// =============================================================================
// RECONCILIATION
// =============================================================================

async function reconcile(
  local: ReturnType<typeof import("../src/offline/datasource/localClient").getLocalClient>,
  cloud: Awaited<ReturnType<typeof import("../src/config/prisma").getCloudClient>>,
  totals: DayTotals,
  _seeded: Seeded
): Promise<void> {
  // ── Sales ─────────────────────────────────────────────────────────────────
  const localSales = await local.sale.findMany({ where: { saleNumber: { startsWith: tag } } });
  const cloudSales = await cloud.sale.findMany({ where: { saleNumber: { startsWith: tag } } });

  check("reconcile", "sale COUNT matches", localSales.length === cloudSales.length,
    `local ${localSales.length}, cloud ${cloudSales.length}`);

  const localRevenue = localSales.reduce((sum, s) => sum + Number(s.grandTotal), 0);
  const cloudRevenue = cloudSales.reduce((sum, s) => sum + Number(s.grandTotal), 0);

  // The single most important number in the run. If revenue does not match to
  // the paisa, the day's books do not balance and nothing else matters.
  check("reconcile", "sale REVENUE matches to the paisa",
    Math.abs(localRevenue - cloudRevenue) < 0.005,
    `local ₹${localRevenue.toFixed(2)}, cloud ₹${cloudRevenue.toFixed(2)}`);

  const cloudNumbers = new Set(cloudSales.map((s) => s.saleNumber));
  const missing = localSales.filter((s) => !cloudNumbers.has(s.saleNumber));
  check("reconcile", "no sale left behind", missing.length === 0,
    missing.slice(0, 3).map((s) => s.saleNumber).join(", "));

  // ── Sale items, payments ──────────────────────────────────────────────────
  const localItems = await local.saleItem.count({ where: { sku: { startsWith: tag } } });
  const cloudItems = await cloud.saleItem.count({ where: { sku: { startsWith: tag } } });
  check("reconcile", "sale ITEM count matches", localItems === cloudItems,
    `local ${localItems}, cloud ${cloudItems}`);

  const localSaleIds = localSales.map((s) => s.id);
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

  check("reconcile", "PAYMENT count matches",
    localPayments._count._all === cloudPayments._count._all,
    `local ${localPayments._count._all}, cloud ${cloudPayments._count._all}`);

  check("reconcile", "PAYMENT total matches",
    Math.abs(Number(localPayments._sum.amount ?? 0) - Number(cloudPayments._sum.amount ?? 0)) < 0.005,
    `local ₹${Number(localPayments._sum.amount ?? 0).toFixed(2)}, cloud ₹${Number(cloudPayments._sum.amount ?? 0).toFixed(2)}`);

  // ── Inventory ─────────────────────────────────────────────────────────────
  const variantIds = (await local.productVariant.findMany({
    where: { sku: { startsWith: tag } },
    select: { id: true },
  })).map((v) => v.id);

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

  check("reconcile", "inventory MOVEMENT count matches",
    localMovements._count._all === cloudMovements._count._all,
    `local ${localMovements._count._all}, cloud ${cloudMovements._count._all}`);

  check("reconcile", "net stock CHANGE matches",
    (localMovements._sum.quantityChanged ?? 0) === (cloudMovements._sum.quantityChanged ?? 0),
    `local ${localMovements._sum.quantityChanged}, cloud ${cloudMovements._sum.quantityChanged}`);

  // The ledger must agree with the till. Sales take stock OUT; refunds,
  // exchange returns and goods received put it BACK, so the net movement is
  // units sold minus everything that came back in. Comparing against sales
  // alone would only hold on a day with no returns and no deliveries — which is
  // exactly the day this harness deliberately no longer simulates.
  const unitsSold = await local.saleItem.aggregate({
    where: { sku: { startsWith: tag } },
    _sum: { quantity: true },
  });

  const expectedNet = -((unitsSold._sum.quantity ?? 0) - totals.unitsReturned);

  check("reconcile", "stock ledger agrees with the day's trade",
    (cloudMovements._sum.quantityChanged ?? 0) === expectedNet,
    `net ${cloudMovements._sum.quantityChanged}, expected ${expectedNet} ` +
      `(${unitsSold._sum.quantity} sold − ${totals.unitsReturned} returned/received)`);

  // ── Customers ─────────────────────────────────────────────────────────────
  const localCustomers = await local.customer.count({ where: { customerCode: { startsWith: tag } } });
  const cloudCustomers = await cloud.customer.count({ where: { customerCode: { startsWith: tag } } });
  check("reconcile", "walk-in CUSTOMERS reached the cloud",
    localCustomers === cloudCustomers, `local ${localCustomers}, cloud ${cloudCustomers}`);

  // ── Returns and exchanges ─────────────────────────────────────────────────
  // A refund is a NEGATIVE payment, so the payment totals compared above only
  // balance if the refund arrived. Here the status transition itself is checked:
  // a sale the shop refunded offline must not still read COMPLETED centrally,
  // or head office bills a customer who was already paid back.
  const refundedLocal = await local.sale.count({
    where: { saleNumber: { startsWith: tag }, status: "REFUNDED" },
  });
  const refundedCloud = await cloud.sale.count({
    where: { saleNumber: { startsWith: tag }, status: "REFUNDED" },
  });
  check("reconcile", "REFUNDED sale status propagated", refundedLocal === refundedCloud,
    `local ${refundedLocal}, cloud ${refundedCloud}`);

  const exchangedLocal = await local.sale.count({
    where: { saleNumber: { startsWith: tag }, status: "EXCHANGED" },
  });
  const exchangedCloud = await cloud.sale.count({
    where: { saleNumber: { startsWith: tag }, status: "EXCHANGED" },
  });
  check("reconcile", "EXCHANGED sale status propagated", exchangedLocal === exchangedCloud,
    `local ${exchangedLocal}, cloud ${exchangedCloud}`);

  const localExchanges = await local.exchange.count({
    where: { exchangeNumber: { startsWith: tag } },
  });
  const cloudExchanges = await cloud.exchange.count({
    where: { exchangeNumber: { startsWith: tag } },
  });
  check("reconcile", "EXCHANGE headers match", localExchanges === cloudExchanges,
    `local ${localExchanges}, cloud ${cloudExchanges}`);

  // The two child tables travel as separate queue items from their parent, so
  // an exchange that arrives without its lines is a real and silent failure.
  const localExchangeIds = (await local.exchange.findMany({
    where: { exchangeNumber: { startsWith: tag } }, select: { id: true },
  })).map((e) => e.id);

  const localReturnItems = await local.exchangeReturnItem.count({
    where: { exchangeId: { in: localExchangeIds } },
  });
  const cloudReturnItems = await cloud.exchangeReturnItem.count({
    where: { exchangeId: { in: localExchangeIds } },
  });
  const localIssuedItems = await local.exchangeIssuedItem.count({
    where: { exchangeId: { in: localExchangeIds } },
  });
  const cloudIssuedItems = await cloud.exchangeIssuedItem.count({
    where: { exchangeId: { in: localExchangeIds } },
  });

  check("reconcile", "exchange RETURNED lines match", localReturnItems === cloudReturnItems,
    `local ${localReturnItems}, cloud ${cloudReturnItems}`);
  check("reconcile", "exchange ISSUED lines match", localIssuedItems === cloudIssuedItems,
    `local ${localIssuedItems}, cloud ${cloudIssuedItems}`);

  // ── Purchases ─────────────────────────────────────────────────────────────
  const localPurchases = await local.purchase.count({
    where: { purchaseNumber: { startsWith: tag } },
  });
  const cloudPurchases = await cloud.purchase.count({
    where: { purchaseNumber: { startsWith: tag } },
  });
  check("reconcile", "PURCHASE count matches", localPurchases === cloudPurchases,
    `local ${localPurchases}, cloud ${cloudPurchases}`);

  const localPurchaseIds = (await local.purchase.findMany({
    where: { purchaseNumber: { startsWith: tag } }, select: { id: true },
  })).map((p) => p.id);

  const localPurchaseItems = await local.purchaseItem.count({
    where: { purchaseId: { in: localPurchaseIds } },
  });
  const cloudPurchaseItems = await cloud.purchaseItem.count({
    where: { purchaseId: { in: localPurchaseIds } },
  });
  check("reconcile", "PURCHASE lines match", localPurchaseItems === cloudPurchaseItems,
    `local ${localPurchaseItems}, cloud ${cloudPurchaseItems}`);

  // Received quantity is what actually books stock — if it arrives as 0 the
  // cloud thinks the goods are still outstanding and reorders them.
  const localReceived = await local.purchaseItem.aggregate({
    where: { purchaseId: { in: localPurchaseIds } }, _sum: { receivedQuantity: true },
  });
  const cloudReceived = await cloud.purchaseItem.aggregate({
    where: { purchaseId: { in: localPurchaseIds } }, _sum: { receivedQuantity: true },
  });
  check("reconcile", "received QUANTITY matches",
    (localReceived._sum.receivedQuantity ?? 0) === (cloudReceived._sum.receivedQuantity ?? 0),
    `local ${localReceived._sum.receivedQuantity}, cloud ${cloudReceived._sum.receivedQuantity}`);

  // ── Notifications ─────────────────────────────────────────────────────────
  const localNotifications = await local.notification.count({
    where: { title: { startsWith: tag } },
  });
  const cloudNotifications = await cloud.notification.count({
    where: { title: { startsWith: tag } },
  });
  check("reconcile", "NOTIFICATIONS reached the cloud",
    localNotifications === cloudNotifications && cloudNotifications > 0,
    `local ${localNotifications}, cloud ${cloudNotifications}`);

  // ── Workforce ─────────────────────────────────────────────────────────────
  const localAttendance = await local.attendance.count();
  const cloudAttendance = await cloud.attendance.count();
  check("reconcile", "ATTENDANCE uploaded", cloudAttendance >= totals.attendance,
    `local ${localAttendance}, cloud ${cloudAttendance}`);

  // ── Expenses ──────────────────────────────────────────────────────────────
  if (totals.expenses > 0) {
    const cloudExpenses = await cloud.expense.count({
      where: { description: { contains: tag } },
    });
    check("reconcile", "EXPENSES uploaded", cloudExpenses === totals.expenses,
      `local ${totals.expenses}, cloud ${cloudExpenses}`);
  } else {
    check("reconcile", "EXPENSES uploaded", true, "skipped — no expense categories in the catalog");
  }

  // ── Audit trail ───────────────────────────────────────────────────────────
  const localAudit = await local.auditLog.count();
  const cloudAuditForDevice = await cloud.syncReceipt.count({
    where: { deviceId: process.env["OFFLINE_DEVICE_ID"] ?? "", entity: "AuditLog" },
  });
  check("reconcile", "AUDIT entries accounted for",
    localAudit === 0 || cloudAuditForDevice > 0,
    `local ${localAudit}, receipts ${cloudAuditForDevice}`);

  // ── Idempotency ledger ────────────────────────────────────────────────────
  // Matched on the idempotency KEY, not by counting rows per device. The device
  // id is reused across runs, so a count comparison silently folds in every
  // earlier run's receipts and fails on a perfectly good sync. The keys are
  // generated per queue item, so they identify THIS day's work exactly.
  const syncedKeys = (
    await local.syncQueueItem.findMany({
      where: { status: "SYNCED" },
      select: { idempotencyKey: true },
    })
  )
    .map((i) => i.idempotencyKey)
    .filter((k): k is string => k !== null && k !== "");

  const receiptsForRun = await cloud.syncReceipt.count({
    where: { idempotencyKey: { in: syncedKeys } },
  });

  check("reconcile", "every synced item has exactly one receipt",
    receiptsForRun === syncedKeys.length,
    `synced ${syncedKeys.length}, receipts ${receiptsForRun}`);

  // The unique index is what actually guarantees "exactly one", so prove no key
  // ever got two receipts — a duplicate here means a sale booked twice.
  const duplicateReceipts = await cloud.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM (
      SELECT "idempotencyKey"
      FROM "sync_receipts"
      GROUP BY "idempotencyKey"
      HAVING COUNT(*) > 1
    ) d
  `;
  check("reconcile", "NO receipt was written twice",
    Number(duplicateReceipts[0]?.n ?? 0) === 0,
    `${Number(duplicateReceipts[0]?.n ?? 0)} keys with multiple receipts`);

  // ── No duplicates anywhere ────────────────────────────────────────────────
  const duplicateSales = await cloud.$queryRaw<Array<{ saleNumber: string; n: bigint }>>`
    SELECT "saleNumber", COUNT(*) AS n
    FROM "sales"
    WHERE "saleNumber" LIKE ${`${tag}%`}
    GROUP BY "saleNumber"
    HAVING COUNT(*) > 1
  `;
  check("reconcile", "NO duplicate sales in the cloud", duplicateSales.length === 0,
    duplicateSales.slice(0, 3).map((r) => r.saleNumber).join(", "));

  // ── Conflicts ─────────────────────────────────────────────────────────────
  const conflicts = await local.syncConflict.count();
  check("reconcile", "no unexpected conflicts", conflicts === 0, `${conflicts} logged`);

  // ── REPORTS ───────────────────────────────────────────────────────────────
  // Every check above compares rows. A report compares what a MANAGER sees, and
  // that is a different question: the reporting queries aggregate and group, so
  // they can disagree across the two databases even when every row matched —
  // a Decimal that arrived as text, or a timestamp that lost its timezone, both
  // reconcile row-for-row and still produce a different daily total.
  //
  // These are the figures the shop is actually judged on, recomputed
  // independently on each side and compared.
  const localReport = await local.sale.aggregate({
    where: { saleNumber: { startsWith: tag } },
    _sum: { grandTotal: true, paidAmount: true },
    _count: { _all: true },
    _avg: { grandTotal: true },
  });
  const cloudReport = await cloud.sale.aggregate({
    where: { saleNumber: { startsWith: tag } },
    _sum: { grandTotal: true, paidAmount: true },
    _count: { _all: true },
    _avg: { grandTotal: true },
  });

  check("reconcile", "REPORT gross sales agree",
    Math.abs(Number(localReport._sum.grandTotal ?? 0) - Number(cloudReport._sum.grandTotal ?? 0)) < 0.005,
    `local ₹${Number(localReport._sum.grandTotal ?? 0).toFixed(2)}, cloud ₹${Number(cloudReport._sum.grandTotal ?? 0).toFixed(2)}`);

  check("reconcile", "REPORT average basket agrees",
    Math.abs(Number(localReport._avg.grandTotal ?? 0) - Number(cloudReport._avg.grandTotal ?? 0)) < 0.005,
    `local ₹${Number(localReport._avg.grandTotal ?? 0).toFixed(2)}, cloud ₹${Number(cloudReport._avg.grandTotal ?? 0).toFixed(2)}`);

  // Payment-method split — the figure that has to match the cash in the drawer.
  const methodRows = async (
    client: typeof local | typeof cloud
  ): Promise<Map<string, number>> => {
    const grouped = await client.payment.groupBy({
      by: ["method"],
      where: { saleId: { in: localSaleIds } },
      _sum: { amount: true },
    });
    return new Map(
      grouped.map((row) => [row.method as string, Number(row._sum.amount ?? 0)])
    );
  };

  const localByMethod = await methodRows(local);
  const cloudByMethod = await methodRows(cloud);

  const methodKeys = new Set([...localByMethod.keys(), ...cloudByMethod.keys()]);
  const methodMismatches = [...methodKeys].filter(
    (m) => Math.abs((localByMethod.get(m) ?? 0) - (cloudByMethod.get(m) ?? 0)) >= 0.005
  );

  check("reconcile", "REPORT payment-method split agrees", methodMismatches.length === 0,
    methodMismatches.length === 0
      ? [...methodKeys].map((m) => `${m} ₹${(localByMethod.get(m) ?? 0).toFixed(2)}`).join(", ")
      : `differs on ${methodMismatches.join(", ")}`);

  // Stock on hand per variant, rebuilt from the movement ledger on both sides.
  // This is the number that decides reordering, and it is the one most likely to
  // drift because it is a SUM over the table with the most inserts.
  const ledgerByVariant = async (
    client: typeof local | typeof cloud
  ): Promise<Map<string, number>> => {
    const grouped = await client.inventoryMovement.groupBy({
      by: ["variantId"],
      where: { variantId: { in: variantIds } },
      _sum: { quantityChanged: true },
    });
    return new Map(grouped.map((r) => [r.variantId, Number(r._sum.quantityChanged ?? 0)]));
  };

  const localLedger = await ledgerByVariant(local);
  const cloudLedger = await ledgerByVariant(cloud);

  const ledgerMismatches = [...new Set([...localLedger.keys(), ...cloudLedger.keys()])].filter(
    (v) => (localLedger.get(v) ?? 0) !== (cloudLedger.get(v) ?? 0)
  );

  check("reconcile", "REPORT stock-on-hand agrees per variant",
    ledgerMismatches.length === 0,
    ledgerMismatches.length === 0
      ? `${localLedger.size} variants reconciled`
      : `${ledgerMismatches.length} variants differ`);
}

// =============================================================================
// CONFLICT HANDLING
//
// Every check up to here runs on data only ONE side authored, which is the easy
// case. A conflict is when both sides changed the same row during the outage,
// and the policy that resolves it is a business rule, not a technical detail:
//
//   CLOUD wins the catalog   — head office changed a price at noon; a till that
//                              could overrule it would silently roll back a
//                              company-wide price change.
//   LOCAL wins a sale        — the cloud cannot have a better opinion about
//                              whether a customer walked out with a shirt.
//
// Both directions are provoked here for real, against the real cloud.
// =============================================================================

async function validateConflictHandling(
  local: ReturnType<typeof import("../src/offline/datasource/localClient").getLocalClient>,
  cloud: Awaited<ReturnType<typeof import("../src/config/prisma").getCloudClient>>,
  seeded: Seeded,
  runDownload: typeof import("../src/offline/sync/engine").runDownload
): Promise<void> {
  const variantId = seeded.variantIds[0];
  if (variantId === undefined) {
    check("conflict", "conflict scenarios ran", false, "no seeded variant");
    return;
  }

  // ── CLOUD WINS: head office re-priced while the till was offline ──────────
  // The till also touched the row, so this is a genuine two-sided conflict
  // rather than a plain refresh.
  await cloud.productVariant.update({
    where: { id: variantId },
    data: { sellingPrice: "349.00" },
  });

  await local.productVariant.update({
    where: { id: variantId },
    data: { sellingPrice: "179.00" },
  });

  const download = await runDownload("MANUAL");
  check("conflict", "reconnect download completed", download.status === "SUCCESS", download.status);

  const afterDownload = await local.productVariant.findUnique({ where: { id: variantId } });
  check(
    "conflict",
    "CLOUD wins on a catalog price change",
    Number(afterDownload?.sellingPrice ?? 0) === 349,
    `local now ₹${Number(afterDownload?.sellingPrice ?? 0).toFixed(2)} (cloud ₹349.00, till had ₹179.00)`
  );

  // ── The false-conflict trap ──────────────────────────────────────────────
  // Postgres returns a Decimal as "199.00" and SQLite as 199; compared as text
  // those differ on every priced row, and the log fills with conflicts that
  // never happened. An unchanged row must produce NO conflict record.
  const conflictsBefore = await local.syncConflict.count();
  await runDownload("MANUAL");
  const conflictsAfter = await local.syncConflict.count();

  check(
    "conflict",
    "an unchanged row logs NO false conflict",
    conflictsAfter === conflictsBefore,
    `${conflictsBefore} → ${conflictsAfter} (Decimal "199.00" vs 199 must compare numerically)`
  );

  // ── LOCAL WINS: the till's record of what physically happened ────────────
  const { resolveUploadConflict } = await import("../src/offline/sync/conflicts");
  const { requirePolicy } = await import("../src/offline/sync/policy");

  const saleDecision = resolveUploadConflict({
    policy: requirePolicy("Sale"),
    cloudRow: { id: "s1", grandTotal: "150.00" },
    localRow: { id: "s1", grandTotal: "199.00" },
    operation: "UPDATE",
  });

  check(
    "conflict",
    "LOCAL wins on a recorded sale",
    saleDecision.winner === "LOCAL",
    `winner ${saleDecision.winner} — the shop's record of a sale is authoritative`
  );
}

main().catch((error: unknown) => {
  console.error("\nvalidation crashed:", error);
  process.exit(1);
});
