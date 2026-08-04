/**
 * Pins the sync transport's URLs, envelope handling and health derivation.
 *
 * WHY URL PINNING
 * ---------------
 * This codebase has already shipped a settings module pointing at a base path
 * the server never mounted, and it was invisible because nothing asserted the
 * URLs. The sync endpoints are worse in that respect: a wrong path here makes
 * the indicator report "offline" forever, which is indistinguishable from a
 * genuine outage — so the cashier is told the truth is unknowable, and nobody
 * finds the typo.
 *
 * WHY THE HEALTH DERIVATION IS TESTED SO HEAVILY
 * ----------------------------------------------
 * `deriveSyncHealth` is the whole user-facing contract of the feature reduced
 * to one function. Its ORDERING is load-bearing: a broken capture must outrank
 * a healthy network, or a till that has stopped recording sales displays a
 * green tick.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import { deriveSyncHealth } from "../hooks/useSync";
import type { SyncStatus } from "../types";

// =============================================================================
// TRANSPORT
// =============================================================================

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

describe("syncApi", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockResolvedValue({ success: true, data: {} });
    post.mockResolvedValue({ success: true, data: {} });
  });

  it("reads status from /sync/status", async () => {
    const { syncApi } = await import("../api/syncApi");
    await syncApi.getStatus();

    expect(get).toHaveBeenCalledWith("/sync/status");
  });

  it("defaults 'Sync Now' to FULL — uploads before downloading", async () => {
    const { syncApi } = await import("../api/syncApi");
    await syncApi.run();

    // The direction matters: un-uploaded sales are the only copy of that data
    // anywhere, so they must go first if only one leg completes.
    expect(post).toHaveBeenCalledWith("/sync/run", { direction: "FULL" });
  });

  it("posts an empty body when retrying everything, not { ids: undefined }", async () => {
    const { syncApi } = await import("../api/syncApi");
    await syncApi.retry();

    // `{ ids: undefined }` serializes to `{}` here but would fail the server's
    // Zod array schema if the key were ever sent explicitly as null.
    expect(post).toHaveBeenCalledWith("/sync/retry", {});
  });

  it("passes explicit ids through when retrying a selection", async () => {
    const { syncApi } = await import("../api/syncApi");
    await syncApi.retry([1, 2, 3]);

    expect(post).toHaveBeenCalledWith("/sync/retry", { ids: [1, 2, 3] });
  });

  it("unwraps the envelope's data, not the envelope", async () => {
    get.mockResolvedValue({ success: true, data: { deviceId: "till-01" } });

    const { syncApi } = await import("../api/syncApi");
    const status = await syncApi.getStatus();

    // Reading the wrong level does not throw — it yields undefined and the
    // indicator silently shows nothing.
    expect(status).toEqual({ deviceId: "till-01" });
  });

  it("reports the queue total from meta, falling back to the row count", async () => {
    get.mockResolvedValue({ success: true, data: [{ id: 1 }], meta: { total: 4200 } });

    const { syncApi } = await import("../api/syncApi");
    const result = await syncApi.getQueue();

    // The page shows 100 rows but must report the REAL depth — that number is
    // how an owner knows how much business is sitting on the machine.
    expect(result.total).toBe(4200);
    expect(result.items).toHaveLength(1);
  });
});

// =============================================================================
// HEALTH DERIVATION
// =============================================================================

function statusWith(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    protocolVersion: 1,
    deviceId: "till-01",
    role: "edge",
    dataSource: "local",
    connectivity: { state: "online", lastOnlineAt: null, latencyMs: 12 },
    queue: {
      pending: 0,
      failed: 0,
      conflicted: 0,
      inFlight: 0,
      oldestPendingAgeSeconds: null,
    },
    lastDownload: null,
    lastUpload: null,
    syncing: false,
    captureHealthy: true,
    ...overrides,
  };
}

describe("deriveSyncHealth", () => {
  it("is SYNCED when online with an empty queue", () => {
    expect(deriveSyncHealth(statusWith())).toBe("SYNCED");
  });

  it("is PENDING when online with work outstanding", () => {
    expect(
      deriveSyncHealth(statusWith({ queue: { ...statusWith().queue, pending: 12 } }))
    ).toBe("PENDING");
  });

  it("is OFFLINE — not an error state — when disconnected", () => {
    // Operating offline is the feature working as designed. If this ever
    // returns DEGRADED, the UI starts crying wolf every time the broadband
    // hiccups and operators learn to ignore the indicator entirely.
    expect(
      deriveSyncHealth(
        statusWith({
          connectivity: { state: "offline", lastOnlineAt: null, latencyMs: null },
          queue: { ...statusWith().queue, pending: 200 },
        })
      )
    ).toBe("OFFLINE");
  });

  it("is BROKEN when capture is unhealthy, even while fully online and idle", () => {
    // THE most important case in this file. A till that is selling but no
    // longer recording anything must never display a green tick.
    expect(deriveSyncHealth(statusWith({ captureHealthy: false }))).toBe("BROKEN");
  });

  it("ranks BROKEN above DEGRADED", () => {
    expect(
      deriveSyncHealth(
        statusWith({
          captureHealthy: false,
          queue: { ...statusWith().queue, failed: 5 },
        })
      )
    ).toBe("BROKEN");
  });

  it("is DEGRADED when items have given up retrying", () => {
    expect(
      deriveSyncHealth(statusWith({ queue: { ...statusWith().queue, failed: 3 } }))
    ).toBe("DEGRADED");
  });

  it("is DEGRADED when conflicts need review", () => {
    expect(
      deriveSyncHealth(statusWith({ queue: { ...statusWith().queue, conflicted: 1 } }))
    ).toBe("DEGRADED");
  });

  it("is DEGRADED when the queue has been stuck for over four hours, even offline", () => {
    // Half a trading day of un-uploaded sales is the point an owner would want
    // to have been told — not the point at which it is already too late.
    expect(
      deriveSyncHealth(
        statusWith({
          connectivity: { state: "offline", lastOnlineAt: null, latencyMs: null },
          queue: { ...statusWith().queue, pending: 40, oldestPendingAgeSeconds: 5 * 3600 },
        })
      )
    ).toBe("DEGRADED");
  });

  it("stays OFFLINE for a queue younger than the stale threshold", () => {
    expect(
      deriveSyncHealth(
        statusWith({
          connectivity: { state: "offline", lastOnlineAt: null, latencyMs: null },
          queue: { ...statusWith().queue, pending: 40, oldestPendingAgeSeconds: 3600 },
        })
      )
    ).toBe("OFFLINE");
  });

  it("treats an unreadable status as OFFLINE rather than throwing", () => {
    // The status endpoint failing means the local server is down. The
    // indicator must degrade, not take the till's UI down with it.
    expect(deriveSyncHealth(undefined)).toBe("OFFLINE");
  });
});
