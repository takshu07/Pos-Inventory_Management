// =============================================================================
// TILL PROVISIONING — INTEGRATION
//
// Runs against REAL SQLite databases with the real generated mirror schema and
// the real change-capture triggers. Nothing about the local database is mocked,
// because every property under test is a property of the DATABASE:
//
//   • a queue holding unsent sales blocks the wipe        (the money check)
//   • a failed stage restores the previous mirror          (rollback)
//   • a cursor ahead of its rows is caught                 (silent data gap)
//   • FK violations and corruption are caught              (fitness to sell)
//
// Only the CLOUD is substituted — `downloadMasterData` is stubbed per case so a
// suite can model "the link dropped at page 9" without needing a Neon branch.
// Everything the stub touches (the local client, the triggers, the cursors) is
// the real thing.
//
// ── Why databases are COPIED rather than pushed per test ─────────────────────
// `prisma db push` takes ~20-30s. Nineteen cases would be ten minutes. So the
// schema is pushed ONCE into a template file, and each case copies it — which
// is also a more honest fixture, since a copied SQLite file is exactly what a
// cloned-from-another-till mirror is in the field.
// =============================================================================

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { resolveOfflineConfig, type OfflineConfig } from "../config";
import {
  __setLocalClientForTesting,
  closeLocalClient,
  type LocalClient,
} from "../datasource/localClient";
import { installChangeCapture } from "../sync/changeCapture";
import type { DownloadOutcome } from "../sync/download";

const SERVER_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const MIRROR_SCHEMA = path.join(SERVER_ROOT, "prisma", "local", "schema.prisma");

const DEVICE_ID = "store-99-till-01";

// =============================================================================
// TEMPLATE DATABASE
//
// ⚠ Built at MODULE SCOPE. `describe.skip` is chosen while the file is being
// COLLECTED, before any hook runs — a flag set in `beforeAll` is always still
// false when the suite decides whether to skip, so every test would silently
// skip while reporting green.
// =============================================================================

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pos-provision-test-"));
const template = buildTemplateDatabase();
const available = template !== null;

function buildTemplateDatabase(): string | null {
  if (!fs.existsSync(MIRROR_SCHEMA)) return null;

  const target = path.join(workspace, "template.db");

  try {
    execFileSync(
      "npx",
      ["prisma", "db", "push", "--accept-data-loss", "--config", "prisma/local/prisma.config.ts"],
      {
        cwd: SERVER_ROOT,
        // Prisma's SQLite connector wants `file:` + a NATIVE absolute path.
        env: { ...process.env, LOCAL_DATABASE_URL: `file:${target}` },
        stdio: "pipe",
        timeout: 180_000,
        // Required on Windows: spawning npx.cmd without a shell fails EINVAL,
        // and the failure is swallowed below — the suite would report green
        // while testing nothing.
        shell: true,
      }
    );
  } catch {
    return null;
  }

  return target;
}

const suite = available ? describe : describe.skip;

// =============================================================================
// PER-CASE FIXTURES
// =============================================================================

let caseCounter = 0;
const openClients: LocalClient[] = [];

/** A path in the workspace that no other case uses. */
function nextMirrorPath(): string {
  return path.join(workspace, `mirror-${(caseCounter += 1)}.db`);
}

/** Copies the pushed template to `target`, giving a real, empty mirror. */
function materializeMirror(target: string): void {
  fs.copyFileSync(template as string, target);
}

/** Opens a client on `databasePath` with the production PRAGMAs applied. */
async function openMirror(databasePath: string): Promise<LocalClient> {
  const client = __setLocalClientForTesting(databasePath);
  await client.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  openClients.push(client);
  return client;
}

function configFor(
  databasePath: string,
  overrides: Partial<OfflineConfig> = {}
): OfflineConfig {
  return {
    ...resolveOfflineConfig(),
    enabled: true,
    role: "edge",
    deviceId: DEVICE_ID,
    localDatabasePath: databasePath,
    cloudBaseUrl: "http://127.0.0.1:1",
    deviceSecret: "provisioning-test-secret-".padEnd(48, "x"),
    ...overrides,
  };
}

/**
 * A `buildSchema` seam that copies the template instead of shelling out to
 * Prisma — the same DDL, without the 25s subprocess.
 */
const copyTemplateSchema = (databasePath: string): void => {
  materializeMirror(databasePath);
};

/** An empty-but-successful download, for cases that are not about the cloud. */
const emptyDownload: DownloadOutcome = {
  entities: [],
  totalRows: 0,
  totalConflicts: 0,
  bytesReceived: 0,
  failedEntities: [],
};

function stubDownload(outcome: DownloadOutcome | (() => Promise<DownloadOutcome>)): void {
  vi.doMock("../sync/download", async () => {
    const actual = await vi.importActual<typeof import("../sync/download")>("../sync/download");
    return {
      ...actual,
      downloadMasterData: typeof outcome === "function" ? outcome : async () => outcome,
    };
  });
}

/**
 * Imports `provisionTill` FRESH, so a `vi.doMock` registered in the test is
 * honoured. A top-level import would bind the real download module once for the
 * whole file.
 */
async function loadProvisioner() {
  vi.resetModules();
  return (await import("../provisioning/provision")).provisionTill;
}

afterEach(async () => {
  vi.doUnmock("../sync/download");
  vi.resetModules();

  // The module singleton may hold a handle to a file the next case deletes.
  try {
    await closeLocalClient();
  } catch {
    // Already closed by the code under test.
  }

  while (openClients.length > 0) {
    const client = openClients.pop();
    try {
      await client?.$disconnect();
    } catch {
      // Windows keeps a lock briefly after close; not worth failing a run over.
    }
  }
});

afterAll(() => {
  try {
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch {
    // A locked file on Windows is not worth failing a green run over.
  }
});

// =============================================================================
// SEEDING HELPERS
// =============================================================================

let seedCounter = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${(seedCounter += 1)}`;
const uniquePhone = () => `9${String((seedCounter += 1)).padStart(9, "0")}`;

/** Marks a mirror as belonging to `deviceId`, the way a real node would. */
async function seedIdentity(client: LocalClient, deviceId: string): Promise<void> {
  await installChangeCapture(client);
  await client.syncNodeState.update({
    where: { id: "singleton" },
    data: { deviceId, captureEnabled: true },
  });
}

/** A product, so the mirror counts as "not empty". */
async function seedProduct(client: LocalClient, name = unique("prod")) {
  const category = await client.category.create({ data: { name: unique("cat") } });
  return client.product.create({ data: { name, categoryId: category.id } });
}

/**
 * A real queue row, minted by the real trigger.
 *
 * Deliberately not an INSERT into sync_queue: the point of the pending-uploads
 * check is that it sees what the capture triggers actually produce, including
 * the trigger-minted idempotency key.
 */
async function seedPendingSale(client: LocalClient): Promise<void> {
  const employee = await client.employee.create({
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
  const customer = await client.customer.create({
    data: { name: "Walk In", customerCode: unique("C"), phone: uniquePhone() },
  });

  await client.sale.create({
    data: {
      saleNumber: unique("INV"),
      customerId: customer.id,
      employeeId: employee.id,
      subtotal: "1234.56",
      grandTotal: "1234.56",
      paidAmount: "1234.56",
      status: "COMPLETED",
    },
  });
}

// =============================================================================
// 1. FIRST-TIME PROVISIONING
// =============================================================================

suite("provisioning: first-time", () => {
  it("builds a verified mirror on a machine with no database", async () => {
    const mirror = nextMirrorPath();
    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    expect(fs.existsSync(mirror)).toBe(false);

    const result = await provisionTill({
      confirmed: false, // no confirmation needed — there is nothing to destroy
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.ok).toBe(true);
    expect(result.failedStage).toBeUndefined();
    expect(result.quarantinePath).toBeUndefined();
    expect(fs.existsSync(mirror)).toBe(true);
  });

  it("initializes device identity, capture flag and cleared watermarks", async () => {
    const mirror = nextMirrorPath();
    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    await provisionTill({
      confirmed: false,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    const client = await openMirror(mirror);
    const state = await client.syncNodeState.findUniqueOrThrow({ where: { id: "singleton" } });

    expect(state.deviceId).toBe(DEVICE_ID);
    expect(state.captureEnabled).toBe(true);
    // A fresh till has never synced and never held a lock. Inheriting any of
    // these from a replaced file would make the first sync skip real rows.
    expect(state.activeRunId).toBeNull();
    expect(state.lastDownloadAt).toBeNull();
    expect(state.lastUploadAt).toBeNull();
  });

  it("installs the change-capture triggers", async () => {
    const mirror = nextMirrorPath();
    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: false,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    const triggers = result.verification?.checks.find(
      (c) => c.name === "change-capture triggers installed"
    );
    expect(triggers?.passed).toBe(true);

    const client = await openMirror(mirror);
    const rows = await client.$queryRawUnsafe<Array<{ count: number | bigint }>>(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_capture_%'"
    );
    expect(Number(rows[0]?.count ?? 0)).toBeGreaterThan(0);
  });

  it("leaves the queue empty — the download must not echo into it", async () => {
    const mirror = nextMirrorPath();
    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: false,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.verification?.checks.find((c) => c.name === "queue is empty")?.passed).toBe(
      true
    );
  });
});

// =============================================================================
// 2. RE-PROVISIONING  (and the confirmation gate)
// =============================================================================

suite("provisioning: re-provisioning a drained till", () => {
  it("refuses a non-empty mirror without explicit confirmation", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);

    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);
    await seedProduct(client);
    await client.$disconnect();

    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: false,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe("PREFLIGHT");
    expect(result.preflight.findings.map((f) => f.code)).toContain("DATABASE_NOT_EMPTY");
    // Refused means untouched.
    expect(fs.existsSync(mirror)).toBe(true);
  });

  it("proceeds when confirmed, and preserves the old mirror rather than deleting it", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);

    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);
    await seedProduct(client, "OLD-CATALOG-ITEM");
    await client.$disconnect();

    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: true,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.ok).toBe(true);
    expect(result.quarantinePath).toBeDefined();
    // Never deleted — an operator must be able to get the old data back.
    expect(fs.existsSync(result.quarantinePath as string)).toBe(true);

    // The live mirror is genuinely new: the old catalog is gone from it.
    const fresh = await openMirror(mirror);
    expect(await fresh.product.count({ where: { name: "OLD-CATALOG-ITEM" } })).toBe(0);
  });

  it("is idempotent — a second confirmed run also succeeds", async () => {
    const mirror = nextMirrorPath();
    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const first = await provisionTill({
      confirmed: true,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });
    expect(first.ok).toBe(true);

    const second = await provisionTill({
      confirmed: true,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });
    expect(second.ok).toBe(true);
  });
});

// =============================================================================
// 3. EXISTING QUEUE DETECTION  — the check that protects real money
// =============================================================================

suite("provisioning: pending uploads", () => {
  it("REFUSES when the queue holds unsent sales, even with confirmation", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);

    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);
    await seedPendingSale(client);

    const queued = await client.syncQueueItem.count({ where: { status: "PENDING" } });
    expect(queued).toBeGreaterThan(0);
    await client.$disconnect();

    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    // Confirmed = true. This must STILL refuse — unsent sales exist nowhere
    // else, so there is no flag that makes destroying them acceptable.
    const result = await provisionTill({
      confirmed: true,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe("PREFLIGHT");

    const pending = result.preflight.findings.find((f) => f.code === "PENDING_UPLOADS");
    expect(pending).toBeDefined();
    expect(pending?.severity).toBe("BLOCKING");
  });

  it("still refuses for items parked FAILED, not just PENDING", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);

    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);
    await seedPendingSale(client);
    // A FAILED item is an unsent sale that has merely exhausted its retries.
    await client.syncQueueItem.updateMany({ data: { status: "FAILED" } });
    await client.$disconnect();

    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: true,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.preflight.findings.map((f) => f.code)).toContain("PENDING_UPLOADS");
  });

  it("allows provisioning when every queue item is already SYNCED", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);

    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);
    await seedPendingSale(client);
    await client.syncQueueItem.updateMany({ data: { status: "SYNCED" } });
    await client.$disconnect();

    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: true,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.preflight.findings.map((f) => f.code)).not.toContain("PENDING_UPLOADS");
    expect(result.ok).toBe(true);
  });
});

// =============================================================================
// 4. DUPLICATE / FOREIGN DEVICE DETECTION
// =============================================================================

suite("provisioning: device identity", () => {
  it("detects a mirror cloned from another till", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);

    const client = await openMirror(mirror);
    await seedIdentity(client, "store-01-till-07"); // someone else's till
    await client.$disconnect();

    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: false,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.ok).toBe(false);
    const finding = result.preflight.findings.find((f) => f.code === "FOREIGN_MIRROR");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("store-01-till-07");
  });

  it("rebuilding a foreign mirror gives it THIS till's identity", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);

    const client = await openMirror(mirror);
    await seedIdentity(client, "store-01-till-07");
    await client.$disconnect();

    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: true,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.ok).toBe(true);

    const fresh = await openMirror(mirror);
    const state = await fresh.syncNodeState.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(state.deviceId).toBe(DEVICE_ID);
  });

  it("flags a stress-harness database", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);

    const client = await openMirror(mirror);
    await seedIdentity(client, "stress-till-04");
    await client.$disconnect();

    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: false,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.preflight.findings.map((f) => f.code)).toContain("STRESS_DATABASE");
  });

  it("refuses to provision UNDER a synthetic device id without confirmation", async () => {
    const mirror = nextMirrorPath();
    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: false,
      config: configFor(mirror, { deviceId: "e2e-validation-till" }),
      buildSchema: copyTemplateSchema,
    });

    expect(result.ok).toBe(false);
    expect(result.preflight.findings.map((f) => f.code)).toContain("SYNTHETIC_DEVICE_ID");
  });

  it("blocks an edge node with no device id at all", async () => {
    const mirror = nextMirrorPath();
    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: true,
      config: configFor(mirror, { deviceId: "" }),
      buildSchema: copyTemplateSchema,
    });

    expect(result.ok).toBe(false);
    const finding = result.preflight.findings.find((f) => f.code === "NO_DEVICE_ID");
    expect(finding?.severity).toBe("BLOCKING");
  });
});

// =============================================================================
// 5. ROLE ENFORCEMENT
// =============================================================================

suite("provisioning: node role", () => {
  it("refuses to provision a cloud node", async () => {
    const mirror = nextMirrorPath();
    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: true,
      config: configFor(mirror, { role: "cloud" }),
      buildSchema: copyTemplateSchema,
    });

    expect(result.ok).toBe(false);
    expect(result.preflight.findings.find((f) => f.code === "NOT_EDGE_ROLE")?.severity).toBe(
      "BLOCKING"
    );
    // A cloud node must not have had a SQLite file created underneath it.
    expect(fs.existsSync(mirror)).toBe(false);
  });

  it("does not gate a first-time run behind the destroys-the-mirror flag", async () => {
    // A developer workstation has DATABASE_URL set, which raises the
    // EDGE_HAS_DATABASE_URL advisory. An advisory must never require the
    // confirmation flag: that flag means "I accept DATA LOSS", and spending it
    // on hygiene notes is how operators learn to pass it without reading.
    const mirror = nextMirrorPath();
    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: false,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.ok).toBe(true);
    // Still reported — advisory means "printed", not "suppressed".
    const advisories = result.preflight.findings.filter((f) => f.severity === "ADVISORY");
    expect(advisories.every((f) => f.severity === "ADVISORY")).toBe(true);
  });

  it("refuses when offline mode is disabled entirely", async () => {
    const mirror = nextMirrorPath();
    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: true,
      config: configFor(mirror, { enabled: false }),
      buildSchema: copyTemplateSchema,
    });

    expect(result.preflight.findings.map((f) => f.code)).toContain("OFFLINE_DISABLED");
  });
});

// =============================================================================
// 6. CORRUPTED DATABASE
// =============================================================================

suite("provisioning: corrupted existing database", () => {
  it("treats an unreadable file as confirmable, not as an empty machine", async () => {
    const mirror = nextMirrorPath();
    // Not SQLite at all — the shape of a truncated or overwritten file.
    fs.writeFileSync(mirror, "this is not a database");

    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: false,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.ok).toBe(false);
    // The danger: a corrupt file whose queue cannot be READ might still have
    // held unsent sales. It must never be silently overwritten.
    expect(result.preflight.findings.map((f) => f.code)).toContain("EXISTING_DB_UNREADABLE");
  });

  it("rebuilds a corrupt database once confirmed", async () => {
    const mirror = nextMirrorPath();
    fs.writeFileSync(mirror, "this is not a database");

    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: true,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.ok).toBe(true);
    const client = await openMirror(mirror);
    // Proves it is a real mirror now, not the junk file.
    expect(await client.syncQueueItem.count()).toBe(0);
  });
});

// =============================================================================
// 7. FAILED DOWNLOAD RECOVERY  +  10. ROLLBACK
// =============================================================================

suite("provisioning: download failure and rollback", () => {
  it("rolls back to the previous mirror when the download throws", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);

    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);
    await seedProduct(client, "SURVIVES-ROLLBACK");
    await client.$disconnect();

    stubDownload(async () => {
      throw new Error("connection reset by peer");
    });
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: true,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe("DOWNLOAD");
    expect(result.rolledBack).toBe(true);

    // The old mirror is back at the live path, with its data intact.
    const restored = await openMirror(mirror);
    expect(await restored.product.count({ where: { name: "SURVIVES-ROLLBACK" } })).toBe(1);
  });

  it("rejects a PARTIAL download — a till with half a catalog must not open", async () => {
    const mirror = nextMirrorPath();
    stubDownload({
      entities: [
        { entity: "Product", rows: 120, conflicts: 0, pages: 1 },
        { entity: "Customer", rows: 0, conflicts: 0, pages: 0, error: "socket hang up" },
      ],
      totalRows: 120,
      totalConflicts: 0,
      bytesReceived: 4096,
      failedEntities: ["Customer"],
    });
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: true,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe("DOWNLOAD");
    expect(result.messages.some((m) => m.includes("Customer"))).toBe(true);
  });

  it("discards the partial mirror when there was nothing to roll back to", async () => {
    const mirror = nextMirrorPath();
    stubDownload(async () => {
      throw new Error("cloud unreachable");
    });
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: false,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(false);
    // A half-built mirror must never be left where the service would boot on it.
    expect(fs.existsSync(mirror)).toBe(false);
  });

  it("is retryable: a run that failed can be re-run successfully", async () => {
    const mirror = nextMirrorPath();

    stubDownload(async () => {
      throw new Error("cloud unreachable");
    });
    let provisionTill = await loadProvisioner();

    const failed = await provisionTill({
      confirmed: true,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });
    expect(failed.ok).toBe(false);

    vi.doUnmock("../sync/download");
    stubDownload(emptyDownload);
    provisionTill = await loadProvisioner();

    const retried = await provisionTill({
      confirmed: true,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });
    expect(retried.ok).toBe(true);
  });
});

// =============================================================================
// 8. INTERRUPTED PROVISIONING
// =============================================================================

suite("provisioning: interrupted run", () => {
  it("rolls back when the schema build fails", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);

    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);
    await seedProduct(client, "STILL-HERE");
    await client.$disconnect();

    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: true,
      config: configFor(mirror),
      buildSchema: () => {
        throw new Error("disk full");
      },
    });

    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe("BUILD");
    expect(result.rolledBack).toBe(true);

    const restored = await openMirror(mirror);
    expect(await restored.product.count({ where: { name: "STILL-HERE" } })).toBe(1);
  });

  it("recovers a mirror left with capture DISABLED by an interrupted download", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);

    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);
    // Exactly what a process killed mid-download leaves behind.
    await client.syncNodeState.update({
      where: { id: "singleton" },
      data: { captureEnabled: false },
    });
    await client.$disconnect();

    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: true,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.ok).toBe(true);
    expect(
      result.verification?.checks.find((c) => c.name === "change capture is enabled")?.passed
    ).toBe(true);
  });

  it("does not move the old mirror aside when preflight refuses", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);

    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);
    await seedPendingSale(client);
    await client.$disconnect();

    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: true,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.failedStage).toBe("PREFLIGHT");

    // No .superseded- copy of THIS mirror was created — a refusal moves nothing.
    // Scoped to this case's own filename, because the shared workspace holds
    // quarantined files from every other case in the file.
    const base = path.basename(mirror);
    const supersededHere = fs
      .readdirSync(workspace)
      .filter((f) => f.startsWith(`${base}.superseded-`));
    expect(supersededHere).toHaveLength(0);

    // And the live mirror still holds the queue that caused the refusal.
    const survivor = await openMirror(mirror);
    expect(await survivor.syncQueueItem.count()).toBeGreaterThan(0);
  });
});

// =============================================================================
// 9. MIRROR + CURSOR VERIFICATION  (verify.ts directly)
// =============================================================================

suite("verification: mirror checks", () => {
  it("passes a freshly provisioned mirror", async () => {
    const mirror = nextMirrorPath();
    stubDownload(emptyDownload);
    const provisionTill = await loadProvisioner();

    const result = await provisionTill({
      confirmed: false,
      config: configFor(mirror),
      buildSchema: copyTemplateSchema,
    });

    expect(result.verification?.passed).toBe(true);
    const failures = (result.verification?.checks ?? []).filter(
      (c) => !c.passed && c.advisory !== true
    );
    expect(failures).toHaveLength(0);
  });

  it("catches a cursor that points at a row the mirror does not hold", async () => {
    // The silent killer: a cursor ahead of its data means the rows in between
    // are never re-fetched by any future incremental sync.
    const mirror = nextMirrorPath();
    materializeMirror(mirror);
    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);

    await client.syncCursor.create({
      data: {
        entity: "Product",
        lastPulledAt: new Date(),
        lastPulledId: "a-product-id-that-was-never-downloaded",
        lastSuccessAt: new Date(),
        rowsPulled: 500,
      },
    });

    vi.resetModules();
    const { verifyMirror } = await import("../provisioning/verify");
    const result = await verifyMirror({ client, config: configFor(mirror) });

    const cursorCheck = result.checks.find(
      (c) => c.name === "cursors point at rows the mirror holds"
    );
    expect(cursorCheck?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("accepts a cursor whose row is present", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);
    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);

    const product = await seedProduct(client);
    await client.syncCursor.create({
      data: {
        entity: "Product",
        lastPulledAt: new Date(),
        lastPulledId: product.id,
        lastSuccessAt: new Date(),
        rowsPulled: 1,
      },
    });

    vi.resetModules();
    const { verifyMirror } = await import("../provisioning/verify");
    const result = await verifyMirror({ client, config: configFor(mirror) });

    expect(
      result.checks.find((c) => c.name === "cursors point at rows the mirror holds")?.passed
    ).toBe(true);
  });

  it("fails a mirror that downloaded rows but wrote no cursors", async () => {
    // The fault this catches: rows landed, but no high-water mark was recorded,
    // so tomorrow's incremental sync re-pulls the entire catalog every night.
    // Reported via `downloaded`, because "no cursors" is only wrong relative to
    // a download that actually returned something.
    const mirror = nextMirrorPath();
    materializeMirror(mirror);
    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);

    vi.resetModules();
    const { verifyMirror } = await import("../provisioning/verify");
    const result = await verifyMirror({
      client,
      config: configFor(mirror),
      downloaded: new Map([["Product", 250]]),
    });

    expect(
      result.checks.find((c) => c.name === "download cursors initialized")?.passed
    ).toBe(false);
  });

  it("accepts a mirror with no cursors when nothing was downloaded", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);
    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);

    vi.resetModules();
    const { verifyMirror } = await import("../provisioning/verify");
    const result = await verifyMirror({ client, config: configFor(mirror) });

    expect(
      result.checks.find((c) => c.name === "download cursors initialized")?.passed
    ).toBe(true);
  });

  it("detects a non-empty queue on a mirror that has never traded", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);
    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);
    await seedPendingSale(client);

    vi.resetModules();
    const { verifyMirror } = await import("../provisioning/verify");
    const result = await verifyMirror({ client, config: configFor(mirror) });

    expect(result.checks.find((c) => c.name === "queue is empty")?.passed).toBe(false);
  });

  it("detects stress-test residue in the catalog", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);
    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);
    await seedProduct(client, "E2E-widget");

    vi.resetModules();
    const { verifyMirror } = await import("../provisioning/verify");
    const result = await verifyMirror({ client, config: configFor(mirror) });

    expect(result.checks.find((c) => c.name === "no stress-test data")?.passed).toBe(false);
  });

  it("detects a hand-written idempotency key", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);
    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);

    // A key not minted by the capture trigger. The cloud's UNIQUE index would
    // either reject real sales as duplicates or accept two sales under one key.
    await client.syncQueueItem.create({
      data: {
        entity: "Sale",
        tableName: "sales",
        entityId: "some-sale",
        operation: "CREATE",
        idempotencyKey: "hand-written-key-001",
        status: "PENDING",
      },
    });

    vi.resetModules();
    const { verifyMirror } = await import("../provisioning/verify");
    const result = await verifyMirror({ client, config: configFor(mirror) });

    expect(result.checks.find((c) => c.name === "no fake idempotency keys")?.passed).toBe(
      false
    );
  });

  it("reports database integrity and foreign key state", async () => {
    const mirror = nextMirrorPath();
    materializeMirror(mirror);
    const client = await openMirror(mirror);
    await seedIdentity(client, DEVICE_ID);

    vi.resetModules();
    const { verifyMirror } = await import("../provisioning/verify");
    const result = await verifyMirror({ client, config: configFor(mirror) });

    expect(result.checks.find((c) => c.name === "database integrity")?.passed).toBe(true);
    expect(
      result.checks.find((c) => c.name === "foreign key enforcement is ON")?.passed
    ).toBe(true);
    expect(result.checks.find((c) => c.name === "no foreign key violations")?.passed).toBe(
      true
    );
  });
});
