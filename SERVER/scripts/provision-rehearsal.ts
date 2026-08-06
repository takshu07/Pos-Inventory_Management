/* eslint-disable no-console */
// =============================================================================
// PROVISIONING REHEARSAL — the full workflow against a stand-in cloud
//
// Drives `provisionTill` through the REAL download path: real HTTP over a real
// socket, real HMAC signing, real keyset pagination, real page-at-a-time
// transactional apply, real cursor advancement, real verification.
//
// The ONE thing that is not production here is what sits behind the cloud's
// `/api/v1/sync/download` endpoint. This harness serves the protocol directly
// from an in-memory catalog rather than from Neon, so the workflow can be
// exercised on a machine with no disposable Postgres. Everything on the EDGE
// side — the side being provisioned — is the shipped code.
//
// Usage:
//   npx tsx scripts/provision-rehearsal.ts
//
// ── What this does and does not prove ────────────────────────────────────────
// PROVES:      preflight gating, fresh-database creation, signed download,
//              cursor initialization from real pagination, mirror verification,
//              rollback, and idempotent re-runs.
// DOES NOT     that Neon's real catalog volume downloads within a sensible
// PROVE:       time, or that row counts reconcile against production data.
//              Those need `npm run till:provision -- --verify-against-cloud`
//              against a real Neon branch. See TILL_PROVISIONING_RUNBOOK.md §2.
// =============================================================================

import type { Server } from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import "dotenv/config";

const PORT = Number.parseInt(process.env["REHEARSAL_PORT"] ?? "3947", 10);
const DEVICE_ID = "rehearsal-store-01-till-01";
const SECRET = "provisioning-rehearsal-secret-".padEnd(48, "x");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pos-provision-rehearsal-"));
const MIRROR = path.join(workspace, "pos-local.db");

// ── Environment must be final BEFORE the offline module graph is imported ────
// `offlineConfig()` memoizes on first read.
process.env["OFFLINE_MODE_ENABLED"] = "true";
process.env["OFFLINE_ROLE"] = "edge";
process.env["OFFLINE_DEVICE_ID"] = DEVICE_ID;
process.env["SYNC_CLOUD_URL"] = `http://127.0.0.1:${PORT}`;
process.env["SYNC_DEVICE_SECRET"] = SECRET;
process.env["SYNC_AUTO_ENABLED"] = "false";
process.env["LOCAL_DATABASE_PATH"] = MIRROR;
// This harness has no Neon behind it, so nothing may resolve to the cloud
// client. Clearing it also proves provisioning needs no database credentials.
delete process.env["DATABASE_URL"];

// =============================================================================
// REPORT
// =============================================================================

interface Check {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

const checks: Check[] = [];

function check(name: string, passed: boolean, detail = ""): void {
  checks.push({ name, passed, detail });
  console.log(`  ${passed ? "✔" : "✖"} ${name}${detail ? `  — ${detail}` : ""}`);
}

function phase(title: string): void {
  console.log(`\n${"─".repeat(78)}\n${title}\n${"─".repeat(78)}`);
}

// =============================================================================
// THE STAND-IN CLOUD
//
// Serves the download half of the wire protocol from an in-memory catalog,
// including the parts that are easy to get wrong and therefore worth
// exercising: keyset pagination on (updatedAt, id), and HMAC verification.
// =============================================================================

interface CatalogRow {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly [key: string]: unknown;
}

/** Rows per entity. Sized to force MULTI-PAGE downloads at batch size 500. */
function buildCatalog(): Map<string, CatalogRow[]> {
  const catalog = new Map<string, CatalogRow[]>();
  const base = Date.parse("2026-01-01T00:00:00.000Z");

  const make = (prefix: string, count: number, extra: (i: number) => object) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${prefix}-${String(i).padStart(6, "0")}`,
      name: `${prefix} ${i}`,
      // Deliberately COARSE: many rows share a timestamp, which is what makes
      // the `id` half of the keyset cursor load-bearing. A cursor on updatedAt
      // alone would skip rows here — exactly the bug the composite cursor
      // exists to prevent, so the rehearsal must be able to catch it.
      updatedAt: new Date(base + Math.floor(i / 50) * 1000).toISOString(),
      createdAt: new Date(base).toISOString(),
      ...extra(i),
    }));

  catalog.set("Category", make("category", 40, () => ({ isActive: true })));
  catalog.set(
    "Product",
    make("product", 1250, (i) => ({
      categoryId: `category-${String(i % 40).padStart(6, "0")}`,
      isActive: true,
    }))
  );
  catalog.set("Customer", make("customer", 620, (i) => ({
    customerCode: `C-${i}`,
    phone: `9${String(100000000 + i)}`,
  })));

  return catalog;
}

const catalog = buildCatalog();

/** Verifies the signature the edge node sends. Same scheme as the real cloud. */
function verifySignature(req: import("http").IncomingMessage, body: string): boolean {
  const device = req.headers["x-sync-device"];
  const timestamp = req.headers["x-sync-timestamp"];
  const nonce = req.headers["x-sync-nonce"];
  const signature = req.headers["x-sync-signature"];

  if (
    typeof device !== "string" ||
    typeof timestamp !== "string" ||
    typeof nonce !== "string" ||
    typeof signature !== "string"
  ) {
    return false;
  }

  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  const canonical = [
    device,
    timestamp,
    nonce,
    (req.method ?? "GET").toUpperCase(),
    req.url ?? "",
    bodyHash,
  ].join("\n");

  const expected = crypto.createHmac("sha256", SECRET).update(canonical).digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

let signedRequests = 0;
let rejectedRequests = 0;
/** Set to make the next N download requests fail, for the rollback rehearsal. */
let failNextRequests = 0;

async function startStandInCloud(): Promise<Server> {
  const http = await import("node:http");

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

      if (url.pathname === "/api/v1/sync/ping") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, serverTime: new Date().toISOString() }));
        return;
      }

      if (url.pathname !== "/api/v1/sync/download") {
        res.writeHead(404).end();
        return;
      }

      // Every download must be SIGNED. An unsigned one is rejected exactly as
      // the real cloud rejects it, so the rehearsal proves signing works rather
      // than assuming it.
      if (!verifySignature(req, body)) {
        rejectedRequests += 1;
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "signature verification failed" }));
        return;
      }
      signedRequests += 1;

      if (failNextRequests > 0) {
        failNextRequests -= 1;
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "simulated cloud failure" }));
        return;
      }

      const entity = url.searchParams.get("entity") ?? "";
      const since = url.searchParams.get("since");
      const sinceId = url.searchParams.get("sinceId");
      const limit = Number.parseInt(url.searchParams.get("limit") ?? "500", 10);

      const all = catalog.get(entity) ?? [];

      // Keyset pagination on (updatedAt, id) — the real semantics, including
      // the strict tie-break on id.
      const after = all.filter((row) => {
        if (since === null) return true;
        if (row.updatedAt > since) return true;
        if (row.updatedAt < since) return false;
        return sinceId === null ? false : row.id > sinceId;
      });

      const page = after.slice(0, limit);
      const last = page.at(-1);
      const hasMore = after.length > page.length;

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          protocolVersion: 1,
          entity,
          rows: page,
          hasMore,
          nextCursor: last === undefined ? null : { updatedAt: last.updatedAt, id: last.id },
          serverTime: new Date().toISOString(),
        })
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  return server;
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<number> {
  console.log("=".repeat(78));
  console.log("  TILL PROVISIONING REHEARSAL");
  console.log(`  device : ${DEVICE_ID}`);
  console.log(`  mirror : ${MIRROR}`);
  console.log(`  cloud  : http://127.0.0.1:${PORT} (stand-in)`);
  console.log("=".repeat(78));

  const server = await startStandInCloud();

  const { provisionTill } = await import("../src/offline/provisioning/provision");
  const { __setLocalClientForTesting, closeLocalClient } = await import(
    "../src/offline/datasource/localClient"
  );

  const expectedRows =
    (catalog.get("Category")?.length ?? 0) +
    (catalog.get("Product")?.length ?? 0) +
    (catalog.get("Customer")?.length ?? 0);

  try {
    // =========================================================================
    phase("1. FIRST-TIME PROVISIONING");
    // =========================================================================

    check("no local database exists yet", !fs.existsSync(MIRROR), MIRROR);
    check("node holds no DATABASE_URL", (process.env["DATABASE_URL"] ?? "") === "");

    const first = await provisionTill({ confirmed: false });

    check("provisioning succeeded", first.ok, `stage: ${first.failedStage ?? "completed"}`);
    check("a fresh mirror now exists", fs.existsSync(MIRROR));
    check(
      "download pulled the catalog",
      (first.download?.totalRows ?? 0) >= expectedRows,
      `${first.download?.totalRows ?? 0} rows (expected ≥ ${expectedRows})`
    );
    check(
      "download was multi-page (keyset pagination exercised)",
      signedRequests > 3,
      `${signedRequests} signed request(s)`
    );
    check("every request was signed and accepted", rejectedRequests === 0);
    check(
      "every verification check passed",
      first.verification?.passed === true,
      `${first.verification?.checks.filter((c) => c.passed).length ?? 0}/${
        first.verification?.checks.length ?? 0
      }`
    );

    for (const c of first.verification?.checks ?? []) {
      console.log(`      ${c.passed ? "·" : "✖"} ${c.name.padEnd(44)} ${c.detail}`);
    }

    // =========================================================================
    phase("2. MIRROR CONTENTS");
    // =========================================================================

    const db = __setLocalClientForTesting(MIRROR);
    await db.$executeRawUnsafe("PRAGMA foreign_keys = ON");

    const [products, categories, customers, queued, cursors] = await Promise.all([
      db.product.count(),
      db.category.count(),
      db.customer.count(),
      db.syncQueueItem.count(),
      db.syncCursor.findMany(),
    ]);

    check("products landed", products === catalog.get("Product")?.length, `${products}`);
    check("categories landed", categories === catalog.get("Category")?.length, `${categories}`);
    check("customers landed", customers === catalog.get("Customer")?.length, `${customers}`);
    // The single most important post-condition: applying downloaded cloud rows
    // must NOT queue them straight back up as local changes.
    check("queue is empty (no download echo)", queued === 0, `${queued} item(s)`);
    check("cursors were written", cursors.length > 0, `${cursors.length} entity cursor(s)`);

    // Every cursor must name a row that is actually present — the check that
    // catches a cursor advanced past uncommitted data.
    let danglingCursors = 0;
    for (const cursor of cursors) {
      if (cursor.lastPulledId === null) continue;
      const table = cursor.entity.charAt(0).toLowerCase() + cursor.entity.slice(1);
      const delegate = (db as unknown as Record<string, { findFirst: (a: unknown) => Promise<unknown> }>)[
        table
      ];
      if (delegate === undefined) continue;
      if ((await delegate.findFirst({ where: { id: cursor.lastPulledId } })) === null) {
        danglingCursors += 1;
      }
    }
    check("no cursor points past the data", danglingCursors === 0);

    const state = await db.syncNodeState.findUniqueOrThrow({ where: { id: "singleton" } });
    check("device identity is this till", state.deviceId === DEVICE_ID, state.deviceId);
    check("change capture is enabled", state.captureEnabled);
    check("no stale watermarks inherited", state.activeRunId === null);

    const triggers = await db.$queryRawUnsafe<Array<{ count: number | bigint }>>(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_capture_%'"
    );
    check("capture triggers installed", Number(triggers[0]?.count ?? 0) === 102, `${Number(triggers[0]?.count ?? 0)}/102`);

    await closeLocalClient();

    // =========================================================================
    phase("3. RE-PROVISIONING IS REFUSED WITHOUT CONFIRMATION");
    // =========================================================================

    const unconfirmed = await provisionTill({ confirmed: false });

    check("second run refused", !unconfirmed.ok, `stage: ${unconfirmed.failedStage}`);
    check(
      "refusal names the non-empty mirror",
      unconfirmed.preflight.findings.some((f) => f.code === "DATABASE_NOT_EMPTY")
    );
    check("the mirror was not touched", fs.existsSync(MIRROR));

    const stillThere = __setLocalClientForTesting(MIRROR);
    check(
      "catalog survived the refusal",
      (await stillThere.product.count()) === products,
      `${await stillThere.product.count()} products`
    );
    await closeLocalClient();

    // =========================================================================
    phase("4. PENDING UPLOADS BLOCK EVEN A CONFIRMED RUN");
    // =========================================================================

    // Ring up a sale the way a cashier would, so the REAL capture trigger mints
    // a REAL queue row. This is the condition that must be unoverridable.
    const withSale = __setLocalClientForTesting(MIRROR);
    const employee = await withSale.employee.create({
      data: {
        employeeCode: `E-${Date.now()}`,
        firstName: "Rehearsal",
        lastName: "Cashier",
        phone: `9${String(Date.now()).slice(-9)}`,
        password: "x",
        role: "CASHIER",
        joiningDate: new Date(),
      },
    });
    const customer = await withSale.customer.findFirstOrThrow();
    await withSale.sale.create({
      data: {
        saleNumber: `INV-${Date.now()}`,
        customerId: customer.id,
        employeeId: employee.id,
        subtotal: "999.00",
        grandTotal: "999.00",
        paidAmount: "999.00",
        status: "COMPLETED",
      },
    });

    const pending = await withSale.syncQueueItem.count({ where: { status: "PENDING" } });
    check("a real sale queued via the capture trigger", pending > 0, `${pending} item(s)`);
    await closeLocalClient();

    const blocked = await provisionTill({ confirmed: true });

    check("CONFIRMED run still refused", !blocked.ok, `stage: ${blocked.failedStage}`);
    const pendingFinding = blocked.preflight.findings.find((f) => f.code === "PENDING_UPLOADS");
    check("refusal is BLOCKING, not confirmable", pendingFinding?.severity === "BLOCKING");

    const salePreserved = __setLocalClientForTesting(MIRROR);
    check(
      "the unsent sale is still there",
      (await salePreserved.syncQueueItem.count({ where: { status: "PENDING" } })) === pending
    );
    await closeLocalClient();

    // =========================================================================
    phase("5. ROLLBACK WHEN THE CLOUD FAILS MID-PROVISION");
    // =========================================================================

    // Drain the queue so the run is permitted, then break the cloud.
    const drain = __setLocalClientForTesting(MIRROR);
    await drain.syncQueueItem.updateMany({ data: { status: "SYNCED" } });
    const beforeRollback = await drain.product.count();
    await closeLocalClient();

    failNextRequests = 1000; // every download request fails
    const failed = await provisionTill({ confirmed: true });
    failNextRequests = 0;

    check("run failed at DOWNLOAD", !failed.ok && failed.failedStage === "DOWNLOAD");
    check("the previous mirror was restored", failed.rolledBack);

    const restored = __setLocalClientForTesting(MIRROR);
    check(
      "catalog is intact after rollback",
      (await restored.product.count()) === beforeRollback,
      `${await restored.product.count()} products`
    );
    check(
      "the drained queue survived too",
      (await restored.syncQueueItem.count()) > 0
    );
    await closeLocalClient();

    // =========================================================================
    phase("6. RETRY AFTER FAILURE (IDEMPOTENCY)");
    // =========================================================================

    const retried = await provisionTill({ confirmed: true });

    check("re-run after a failure succeeds", retried.ok, `stage: ${retried.failedStage ?? "completed"}`);
    check("verification passed again", retried.verification?.passed === true);
    check(
      "the superseded mirror was preserved, not deleted",
      retried.quarantinePath !== undefined && fs.existsSync(retried.quarantinePath)
    );

    const final = __setLocalClientForTesting(MIRROR);
    check(
      "the rebuilt mirror has a clean queue",
      (await final.syncQueueItem.count()) === 0
    );
    check(
      "the rebuilt mirror has the full catalog",
      (await final.product.count()) === catalog.get("Product")?.length
    );
    await closeLocalClient();

    // =========================================================================
    phase("7. CLOUD ROW-COUNT RECONCILIATION");
    // =========================================================================

    const reconciled = await provisionTill({ confirmed: true, compareWithCloud: true });

    check("provisioning with --verify-against-cloud succeeded", reconciled.ok);
    const rowCountCheck = reconciled.verification?.checks.find(
      (c) => c.name === "row counts match cloud expectations"
    );
    check(
      "row counts reconcile against the cloud",
      rowCountCheck?.passed === true,
      rowCountCheck?.detail ?? ""
    );
    await closeLocalClient();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
    } catch {
      // Windows file locks are not worth failing the run over.
    }
  }

  // =========================================================================
  phase("SUMMARY");
  // =========================================================================

  const failedChecks = checks.filter((c) => !c.passed);
  console.log(`  ${checks.length - failedChecks.length}/${checks.length} checks passed`);

  if (failedChecks.length > 0) {
    console.log("\n  FAILED:");
    for (const c of failedChecks) console.log(`    ✖ ${c.name}  ${c.detail}`);
    return 1;
  }

  console.log(
    "\n  The provisioning workflow behaves correctly end-to-end against a real\n" +
      "  signed download path. Run it against a Neon branch before the first\n" +
      "  production till — see TILL_PROVISIONING_RUNBOOK.md §2."
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error("\n  Rehearsal crashed:", error);
    process.exit(2);
  });
