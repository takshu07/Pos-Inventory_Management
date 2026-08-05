// =============================================================================
// ROLLBACK IS INERT
//
// ⚠ A SAFETY suite, like defaultDisabled.test.ts. That one pins the property
// that a server which never enabled Offline Mode is unchanged. This one pins
// the harder property: a server that HAD it enabled and turned it off is
// unchanged too.
//
// The two are not the same, and the difference is the whole reason this file
// exists. Rollback is performed by setting OFFLINE_MODE_ENABLED=false — which
// is the natural way to disable a flag, and which leaves every other offline
// variable in place. `OFFLINE_ROLE=edge` in particular survives, because
// nothing prompts anyone to remove it.
//
// The endpoints used to gate on `role` alone. A rolled-back till therefore
// still took the edge branch and opened SQLite, in the one situation where
// "disabled means inert" most needs to hold:
//
//   • with no local file, /sync/status throws — and the client polls it every
//     10 seconds, so an inert server logs a 500 six times a minute;
//   • with a leftover file, the cashier sees a live sync indicator showing a
//     real pending count on a node whose sync engine is not running. Data
//     reported as queued that nothing will ever drain is the most misleading
//     state the UI can enter.
//
// Every test below therefore sets the STALE-role configuration deliberately.
// That is not an exotic case; it is what a real rollback looks like.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isCloudNode,
  isEdgeNode,
  resetOfflineConfigCache,
  resolveOfflineConfig,
} from "../config";

// The controller is imported at module scope, NOT inside the tests. It reaches
// the prisma singleton transitively (controller → cloudApply → prisma), and
// that module constructs its client eagerly from DATABASE_URL at import time.
// The env isolation below deletes DATABASE_URL, so a lazy `await import()`
// inside a test would resolve the module graph with the variable already gone
// and throw "DATABASE_URL is not set" before reaching the code under test.
//
// Importing first binds the singleton while the real env is still intact. That
// costs nothing here: these handlers must return before touching any database,
// which is the exact property being tested.
import * as sync from "../api/sync.controller";

// =============================================================================
// ENV ISOLATION
// =============================================================================

const OFFLINE_KEYS = [
  "OFFLINE_MODE_ENABLED",
  "OFFLINE_ROLE",
  "OFFLINE_DEVICE_ID",
  "LOCAL_DATABASE_PATH",
  "SYNC_CLOUD_URL",
  "SYNC_DEVICE_SECRET",
  "DATABASE_URL",
  "JWT_SECRET",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of OFFLINE_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  resetOfflineConfigCache();
});

afterEach(() => {
  for (const key of OFFLINE_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetOfflineConfigCache();
  vi.restoreAllMocks();
});

/**
 * The state a real rollback leaves behind: master switch off, every other
 * offline variable still set, because only the switch was touched.
 */
function applyRolledBackEdgeEnv(): void {
  process.env["OFFLINE_MODE_ENABLED"] = "false";
  process.env["OFFLINE_ROLE"] = "edge";
  process.env["OFFLINE_DEVICE_ID"] = "store-01-till-01";
  process.env["SYNC_CLOUD_URL"] = "https://cloud.example.com";
  process.env["SYNC_DEVICE_SECRET"] = "s".repeat(48);
  resetOfflineConfigCache();
}

// =============================================================================
// THE GATE AFTER ROLLBACK
// =============================================================================

describe("a rolled-back edge node", () => {
  it("takes no edge code path despite OFFLINE_ROLE=edge", () => {
    applyRolledBackEdgeEnv();

    // `role` still reads "edge" — nothing cleared it, and that is expected.
    expect(resolveOfflineConfig().role).toBe("edge");

    // But every behavioural helper must conjoin `enabled`, so neither side of
    // the sync relationship is active.
    expect(isEdgeNode()).toBe(false);
    expect(isCloudNode()).toBe(false);
  });

  it("routes the datasource to the cloud, not to SQLite", async () => {
    applyRolledBackEdgeEnv();

    const { getDataSourceMode } = await import("../datasource/router");

    // If this ever returns "local", a disabled node is serving business traffic
    // from a SQLite file nothing is maintaining.
    expect(getDataSourceMode()).toBe("cloud");
  });
});

// =============================================================================
// THE ENDPOINTS
//
// The controller is exercised against fake req/res objects rather than through
// a real HTTP stack, deliberately: the property under test is that the handler
// RETURNS BEFORE reaching the local client, and a mocked service would prove
// nothing about that. `syncStatus.service` is mocked to throw on every call —
// so any handler that reaches it fails loudly rather than quietly passing.
// =============================================================================

vi.mock("../api/syncStatus.service", () => {
  const reached = (name: string) => () => {
    throw new Error(
      `syncStatus.${name}() was called on a DISABLED node — this is the ` +
        "regression this suite exists to catch. The handler must return the " +
        "degenerate cloud payload before touching the local client."
    );
  };

  return {
    getSyncStatus: reached("getSyncStatus"),
    getSyncHistory: reached("getSyncHistory"),
    getQueueItems: reached("getQueueItems"),
    getConflicts: reached("getConflicts"),
    getSyncEvents: reached("getSyncEvents"),
    runConsistencyCheck: reached("runConsistencyCheck"),
  };
});

/** Minimal Express double capturing what a handler sent. */
function fakeRes() {
  const captured: { status?: number; body?: any } = {};

  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(body: unknown) {
      captured.body = body;
      return res;
    },
  };

  return { res, captured };
}

async function invoke(
  handler: (req: any, res: any, next: any) => unknown,
  req: Record<string, unknown> = {}
) {
  const { res, captured } = fakeRes();

  // asyncHandler forwards rejections to `next`; surface them as failures.
  await handler({ query: {}, body: {}, ...req }, res, (err: unknown) => {
    if (err) throw err;
  });

  return captured;
}

describe("sync endpoints on a disabled node with a stale edge role", () => {
  it("GET /sync/status answers as a cloud node, never opening SQLite", async () => {
    applyRolledBackEdgeEnv();

    const { status, body } = await invoke(sync.status);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.role).toBe("cloud");
  });

  it("reports an empty queue rather than a stale pending count", async () => {
    // The misleading-indicator case: a leftover local file must not surface as
    // "you have N sales waiting" on a node that will never drain them.
    applyRolledBackEdgeEnv();

    const { body } = await invoke(sync.status);

    expect(body.data.queue).toMatchObject({
      pending: 0,
      failed: 0,
      conflicted: 0,
      inFlight: 0,
      oldestPendingAgeSeconds: null,
    });
    expect(body.data.syncing).toBe(false);
  });

  it("GET /sync/health returns 200 healthy, not 503", async () => {
    // A rolled-back node has no capture to be broken. Returning 503 would page
    // whoever owns the uptime monitor every time a node is taken out of
    // Offline Mode on purpose.
    applyRolledBackEdgeEnv();

    const { status, body } = await invoke(sync.health);

    expect(status).toBe(200);
    expect(body.data.healthy).toBe(true);
    expect(body.data.role).toBe("cloud");
  });

  it("POST /sync/run reports 'nothing to sync' instead of failing in the engine", async () => {
    applyRolledBackEdgeEnv();

    const { status, body } = await invoke(sync.run, { body: { direction: "UPLOAD" } });

    expect(status).toBe(200);
    expect(body.data.skipped).toBe(true);
    expect(body.data.reason).toMatch(/not enabled/i);
  });

  it("POST /sync/retry requeues nothing rather than erroring", async () => {
    applyRolledBackEdgeEnv();

    const { status, body } = await invoke(sync.retry);

    expect(status).toBe(200);
    expect(body.data.requeued).toBe(0);
  });

  it.each([
    ["history", (s: any) => s.history],
    ["conflicts", (s: any) => s.conflicts],
    ["events", (s: any) => s.events],
  ])("GET /sync/%s returns empty rather than a raw SQLite error", async (_name, pick) => {
    applyRolledBackEdgeEnv();

    const { status, body } = await invoke(pick(sync));

    expect(status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("GET /sync/queue returns an empty page with a zero total", async () => {
    applyRolledBackEdgeEnv();

    const { status, body } = await invoke(sync.queue);

    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });
});

// =============================================================================
// STILL CORRECT WHEN GENUINELY DISABLED WITH NO STALE ROLE
// =============================================================================

describe("sync endpoints on a plain disabled node", () => {
  it("answers as a cloud node with no offline variables at all", async () => {
    resetOfflineConfigCache();

    const { status, body } = await invoke(sync.status);

    expect(status).toBe(200);
    expect(body.data.role).toBe("cloud");
  });
});
