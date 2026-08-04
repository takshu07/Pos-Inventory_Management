// =============================================================================
// OFFLINE OPERATION — INTEGRATION
//
// Runs against a REAL SQLite database with the real generated schema and the
// real change-capture triggers. Nothing here is mocked, because the properties
// under test are properties of the DATABASE, not of application code:
//
//   • a rolled-back transaction leaves no queue row      (trigger atomicity)
//   • foreign keys are enforced                          (PRAGMA actually took)
//   • suppression cannot leak                            (write-lock scoping)
//   • a delete keeps its before-image                    (recoverability)
//
// A mock would assert that the code we wrote calls the code we wrote.
//
// ── Setup ────────────────────────────────────────────────────────────────────
// The suite builds a throwaway database by pushing the generated mirror into a
// temp file. That takes a few seconds, so it happens once per run. If the
// mirror has not been generated (`npm run db:local:setup`), the suite SKIPS
// rather than fails — matching how the rest of this repo treats integration
// suites whose infrastructure is absent.
// =============================================================================

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { __setLocalClientForTesting, type LocalClient } from "../datasource/localClient";
import { installChangeCapture, verifyChangeCapture, withCaptureSuppressed } from "../sync/changeCapture";

const SERVER_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const MIRROR_SCHEMA = path.join(SERVER_ROOT, "prisma", "local", "schema.prisma");

let db: LocalClient;

/**
 * ⚠ Built at MODULE SCOPE, not in `beforeAll`.
 *
 * `describe.skip` is chosen while the file is being COLLECTED, which happens
 * before any hook runs — so a flag set in `beforeAll` is always still false
 * when the suite decides whether to skip, and every test silently skips while
 * reporting green. The subprocess push is synchronous anyway, so doing it here
 * costs nothing and makes the decision on real information.
 */
const databasePath = buildTestDatabase();
const available = databasePath !== null;

function buildTestDatabase(): string | null {
  if (!fs.existsSync(MIRROR_SCHEMA)) return null;

  const target = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "pos-offline-test-")),
    "test.db"
  );

  try {
    execFileSync(
      "npx",
      ["prisma", "db", "push", "--accept-data-loss", "--config", "prisma/local/prisma.config.ts"],
      {
        cwd: SERVER_ROOT,
        // Prisma's SQLite connector wants `file:` + a NATIVE absolute path; the
        // RFC-8089 `file:///D:/…` form is rejected on Windows.
        env: { ...process.env, LOCAL_DATABASE_URL: `file:${target}` },
        stdio: "pipe",
        timeout: 120_000,
        // Required on Windows. Since the Node 18.20/20.12 security fix,
        // spawning a .cmd shim (npx.cmd) WITHOUT a shell fails with EINVAL —
        // and the failure is swallowed by the catch below, so the whole suite
        // reports green while silently testing nothing.
        shell: true,
      }
    );
  } catch {
    // No mirror generated yet (`npm run db:local:setup`), or no Prisma CLI.
    // Skipping is the documented behavior for this repo's integration suites.
    return null;
  }

  return target;
}

beforeAll(async () => {
  if (!available || databasePath === null) return;

  db = __setLocalClientForTesting(databasePath);

  await db.$executeRawUnsafe("PRAGMA foreign_keys = ON");

  // ⚠ ORDER MATTERS. `installChangeCapture` seeds the node-state row itself,
  // taking the device id from OFFLINE_DEVICE_ID — which is unset in a test
  // process, so it writes "unregistered". Setting the id BEFORE the install
  // would therefore be silently overwritten, and the idempotency-key assertion
  // below would fail for a reason that looks nothing like the actual cause.
  await installChangeCapture(db);

  await db.syncNodeState.update({
    where: { id: "singleton" },
    data: { deviceId: "till-test", captureEnabled: true },
  });
}, 120_000);

afterAll(async () => {
  if (!available || databasePath === null) return;

  await db.$disconnect();

  try {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  } catch {
    // A locked file on Windows is not worth failing a green run over.
  }
});

const suite = () => (available ? describe : describe.skip);

// =============================================================================
// FIXTURES
// =============================================================================

let counter = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${(counter += 1)}`;

/**
 * A distinct 10-digit phone number per call.
 *
 * `Customer.phone` is UNIQUE. Deriving one by truncating a timestamp string
 * collides for every row created inside the same second — which is every row a
 * test file creates.
 */
const uniquePhone = () => `9${String((counter += 1)).padStart(9, "0")}`;

async function makeEmployee() {
  return db.employee.create({
    data: {
      employeeCode: unique("E"),
      firstName: "Test",
      lastName: "Cashier",
      phone: uniquePhone(),
      password: "x",
      role: "CASHIER",
      joiningDate: new Date(),
    },
  });
}

async function makeCustomer(name = "Walk In") {
  return db.customer.create({
    data: { name, customerCode: unique("C"), phone: uniquePhone() },
  });
}

/** A minimal COMPLETED sale. `Sale.customerId` is required, so it needs one. */
async function makeSale(overrides: { saleNumber?: string } = {}) {
  const employee = await makeEmployee();
  const customer = await makeCustomer();

  return db.sale.create({
    data: {
      saleNumber: overrides.saleNumber ?? unique("INV"),
      customerId: customer.id,
      employeeId: employee.id,
      subtotal: "1234.56",
      grandTotal: "1234.56",
      paidAmount: "1234.56",
      status: "COMPLETED",
    },
  });
}

async function makeCatalog() {
  const category = await db.category.create({ data: { name: unique("cat") } });
  const size = await db.size.create({ data: { name: unique("sz") } });
  const color = await db.color.create({ data: { name: unique("col") } });

  const product = await db.product.create({
    data: { name: unique("prod"), categoryId: category.id },
  });

  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sizeId: size.id,
      colorId: color.id,
      sku: unique("sku"),
      costPrice: "100.00",
      sellingPrice: "199.00",
      mrp: "249.00",
      currentStock: 50,
    },
  });

  return { category, product, variant };
}

async function clearQueue() {
  await db.$executeRawUnsafe("DELETE FROM sync_queue");
}

// =============================================================================
// TRIGGERS
// =============================================================================

suite()("change capture", () => {
  it("installs a trigger set covering every uploadable table", async () => {
    const report = await verifyChangeCapture(db);

    expect(report.missing).toEqual([]);
    expect(report.installed).toBe(report.expected);
    // 3 triggers (insert/update/delete) per captured table.
    expect(report.expected % 3).toBe(0);
  });

  it("queues a local write with the full row snapshot", async () => {
    await clearQueue();

    const customer = await db.customer.create({
      data: { name: "Walk In", customerCode: unique("C"), phone: uniquePhone() },
    });

    const [item] = await db.syncQueueItem.findMany({ orderBy: { id: "asc" } });

    expect(item?.entity).toBe("Customer");
    expect(item?.operation).toBe("CREATE");
    expect(item?.entityId).toBe(customer.id);
    expect(item?.status).toBe("PENDING");

    const payload = JSON.parse(item?.payload ?? "{}") as Record<string, unknown>;
    expect(payload["name"]).toBe("Walk In");
    // The whole row, not a partial projection — the cloud upserts from this.
    expect(Object.keys(payload).length).toBeGreaterThan(5);
  });

  it("namespaces the idempotency key by device", async () => {
    await clearQueue();
    await db.customer.create({
      data: { name: "Keyed", customerCode: unique("C"), phone: uniquePhone() },
    });

    const [item] = await db.syncQueueItem.findMany({ orderBy: { id: "asc" } });

    // Without the device prefix, two stores restored from one backup would
    // produce colliding keys and the cloud would discard one store's sales.
    expect(item?.idempotencyKey.startsWith("till-test:")).toBe(true);
  });

  it("does NOT queue writes to cloud-authoritative tables", async () => {
    await clearQueue();
    await db.brand.create({ data: { name: unique("brand") } });

    expect(await db.syncQueueItem.count()).toBe(0);
  });

  it("keeps the before-image on update and delete", async () => {
    await clearQueue();

    const customer = await db.customer.create({
      data: { name: "Before", customerCode: unique("C"), phone: uniquePhone() },
    });
    await db.customer.update({ where: { id: customer.id }, data: { name: "After" } });

    const update = (await db.syncQueueItem.findMany({ orderBy: { id: "desc" }, take: 1 }))[0];
    expect(update?.operation).toBe("UPDATE");
    expect(JSON.parse(update?.beforeData ?? "{}")["name"]).toBe("Before");
    expect(JSON.parse(update?.payload ?? "{}")["name"]).toBe("After");

    await db.customer.delete({ where: { id: customer.id } });

    const remove = (await db.syncQueueItem.findMany({ orderBy: { id: "desc" }, take: 1 }))[0];
    expect(remove?.operation).toBe("DELETE");
    // Payload is null but the before-image survives — a delete uploaded without
    // it could never be undone.
    expect(remove?.payload).toBeNull();
    expect(JSON.parse(remove?.beforeData ?? "{}")["name"]).toBe("After");
  });
});

// =============================================================================
// ATOMICITY — the guarantee the whole design rests on
// =============================================================================

suite()("atomicity", () => {
  it("leaves no queue row when the transaction that wrote it rolls back", async () => {
    await clearQueue();

    const customer = await db.customer.create({
      data: { name: "Committed", customerCode: unique("C"), phone: uniquePhone() },
    });
    await clearQueue();

    await expect(
      db.$transaction(async (tx) => {
        await tx.customer.update({ where: { id: customer.id }, data: { name: "Doomed" } });
        throw new Error("simulated crash mid-transaction");
      })
    ).rejects.toThrow("simulated crash");

    // Neither the write NOR its queue entry may survive. A queue row for a
    // change that never happened would upload a phantom edit.
    expect(await db.syncQueueItem.count()).toBe(0);
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).name
    ).toBe("Committed");
  });

  it("queues every write of a multi-table checkout together", async () => {
    await clearQueue();

    const { variant } = await makeCatalog();
    const employee = await makeEmployee();
    const customer = await makeCustomer();
    await clearQueue();

    // An offline checkout: sale + line + payment + stock movement, one
    // transaction, exactly as the POS writes it.
    await db.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          saleNumber: unique("INV"),
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
          productName: "Offline Tee",
          sizeName: "M",
          colorName: "Blue",
          sku: unique("sku"),
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
          stockBefore: 50,
          stockAfter: 49,
          employeeId: employee.id,
        },
      });

      await tx.productVariant.update({
        where: { id: variant.id },
        data: { currentStock: 49 },
      });
    });

    const queued = await db.syncQueueItem.findMany({ orderBy: { id: "asc" } });
    const entities = queued.map((item) => item.entity);

    expect(entities).toContain("Sale");
    expect(entities).toContain("SaleItem");
    expect(entities).toContain("Payment");
    expect(entities).toContain("InventoryMovement");

    // ProductVariant is cloud-authoritative — the stock number is rebuilt
    // centrally from the movements, so uploading it too would double-count.
    expect(entities).not.toContain("ProductVariant");

    // Ascending id must reproduce the write order, or the cloud's foreign keys
    // reject a SaleItem that arrives before its Sale.
    expect(entities.indexOf("Sale")).toBeLessThan(entities.indexOf("SaleItem"));
    expect(entities.indexOf("Sale")).toBeLessThan(entities.indexOf("Payment"));
  });
});

// =============================================================================
// SUPPRESSION
// =============================================================================

suite()("download suppression", () => {
  it("does not queue writes applied inside withCaptureSuppressed", async () => {
    await clearQueue();

    const customer = await db.customer.create({
      data: { name: "Local", customerCode: unique("C"), phone: uniquePhone() },
    });
    await clearQueue();

    await withCaptureSuppressed(async (tx) => {
      await tx.customer.update({ where: { id: customer.id }, data: { name: "From Cloud" } });
    }, db);

    // Otherwise every download echoes the cloud's own rows straight back up.
    expect(await db.syncQueueItem.count()).toBe(0);
  });

  it("re-enables capture afterwards", async () => {
    const state = await db.syncNodeState.findUniqueOrThrow({ where: { id: "singleton" } });

    expect(state.captureEnabled).toBe(true);
  });

  it("re-enables capture even when the suppressed work throws", async () => {
    // A node left with capture off is the one failure mode that silently loses
    // data rather than merely delaying it.
    await expect(
      withCaptureSuppressed(async () => {
        throw new Error("download failed mid-page");
      }, db)
    ).rejects.toThrow("download failed");

    const state = await db.syncNodeState.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(state.captureEnabled).toBe(true);
  });

  it("resumes capturing normal writes after suppression", async () => {
    await clearQueue();

    await db.customer.create({
      data: { name: "After Suppression", customerCode: unique("C"), phone: uniquePhone() },
    });

    expect(await db.syncQueueItem.count()).toBe(1);
  });
});

// =============================================================================
// DATA INTEGRITY
// =============================================================================

suite()("local data integrity", () => {
  it("enforces foreign keys", async () => {
    // SQLite does not enforce FKs unless asked, per connection. Without this
    // the till would accept a sale line pointing at a product that does not
    // exist — and Postgres would reject the same data at upload time, after the
    // customer has left with the goods.
    await expect(
      db.saleItem.create({
        data: {
          saleId: "does-not-exist",
          variantId: "does-not-exist",
          quantity: 1,
          productName: "x",
          sizeName: "M",
          colorName: "Blue",
          sku: "x",
          sellingPrice: "1.00",
          costAtSale: "1.00",
          totalPrice: "1.00",
        },
      })
    ).rejects.toThrow();
  });

  it("enforces unique constraints", async () => {
    // A duplicate sale number must be rejected LOCALLY. If SQLite accepted it,
    // the collision would only surface at upload — after both receipts were
    // printed and handed to two different customers.
    const code = unique("INV");
    await makeSale({ saleNumber: code });

    await expect(makeSale({ saleNumber: code })).rejects.toThrow();
  });

  it("round-trips Decimal without losing precision", async () => {
    // The reason money is stored as Decimal rather than a float. SQLite's
    // native REAL would return 1234.5599999999999 here.
    const sale = await makeSale();
    const read = await db.sale.findUniqueOrThrow({ where: { id: sale.id } });

    expect(read.grandTotal.toString()).toBe("1234.56");
  });

  it("presents scalar lists as arrays through the bridge", async () => {
    const category = await db.category.create({ data: { name: unique("cat") } });

    const product = await db.product.create({
      data: {
        name: unique("prod"),
        categoryId: category.id,
        imageUrls: ["https://a/1.png", "https://a/2.png"],
      },
    });

    const read = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(read.imageUrls).toEqual(["https://a/1.png", "https://a/2.png"]);

    // Stored as JSON text underneath — the bridge is what makes it look like an
    // array to the 26 repositories that never learned SQLite exists.
    const raw = await db.$queryRawUnsafe<Array<{ imageUrls: string }>>(
      'SELECT "imageUrls" FROM products WHERE id = ?',
      product.id
    );
    expect(raw[0]?.imageUrls).toBe('["https://a/1.png","https://a/2.png"]');
  });
});
