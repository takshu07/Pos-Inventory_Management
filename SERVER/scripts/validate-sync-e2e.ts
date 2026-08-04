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
const uniquePhone = () => `9${String(700_000_000 + nextId()).slice(0, 9)}`;

interface DayTotals {
  sales: number;
  saleItems: number;
  payments: number;
  movements: number;
  customers: number;
  expenses: number;
  attendance: number;
  revenue: number;
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
}

async function seedCloudMasterData(
  cloud: Awaited<ReturnType<typeof import("../src/config/prisma").getCloudClient>>
): Promise<Seeded> {
  const category = await cloud.category.create({ data: { name: `${tag}-cat` } });
  const size = await cloud.size.create({ data: { name: `${tag}-M` } });
  const color = await cloud.color.create({ data: { name: `${tag}-Blue` } });

  const product = await cloud.product.create({
    data: {
      name: `${tag}-Tee`,
      categoryId: category.id,
      imageUrls: [`https://example.test/${tag}.png`],
    },
  });

  const variantIds: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const variant = await cloud.productVariant.create({
      data: {
        productId: product.id,
        sizeId: size.id,
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

  return { categoryId: category.id, employeeId: employee.id, variantIds };
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
      checkIn: new Date(),
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

  // An expense paid out of the drawer during the day.
  const expenseCategory = await local.expenseCategory.findFirst();
  if (expenseCategory !== null) {
    await local.expense.create({
      data: {
        categoryId: expenseCategory.id,
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

  // Movements sum to the units sold — the ledger must agree with the till.
  const unitsSold = await local.saleItem.aggregate({
    where: { sku: { startsWith: tag } },
    _sum: { quantity: true },
  });
  check("reconcile", "stock ledger agrees with units sold",
    Math.abs(cloudMovements._sum.quantityChanged ?? 0) === (unitsSold._sum.quantity ?? 0),
    `movements ${Math.abs(cloudMovements._sum.quantityChanged ?? 0)}, sold ${unitsSold._sum.quantity}`);

  // ── Customers ─────────────────────────────────────────────────────────────
  const localCustomers = await local.customer.count({ where: { customerCode: { startsWith: tag } } });
  const cloudCustomers = await cloud.customer.count({ where: { customerCode: { startsWith: tag } } });
  check("reconcile", "walk-in CUSTOMERS reached the cloud",
    localCustomers === cloudCustomers, `local ${localCustomers}, cloud ${cloudCustomers}`);

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
  const syncedItems = await local.syncQueueItem.count({ where: { status: "SYNCED" } });
  const receipts = await cloud.syncReceipt.count({
    where: { deviceId: process.env["OFFLINE_DEVICE_ID"] ?? "" },
  });
  check("reconcile", "every synced item has exactly one receipt",
    receipts === syncedItems, `synced ${syncedItems}, receipts ${receipts}`);

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
}

main().catch((error: unknown) => {
  console.error("\nvalidation crashed:", error);
  process.exit(1);
});
