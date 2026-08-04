/**
 * Dashboard notifications — single-source-of-truth regression tests.
 *
 * WHY THIS EXISTS
 * ---------------
 * `dashboardApi.getNotifications` returned three HARDCODED rows for months. The
 * dashboard cheerfully announced a "System Update" that was never scheduled
 * while a genuine out-of-stock alert sat unread in the Notification Center, and
 * nothing failed — mock data does not throw. These tests pin the wiring so it
 * cannot quietly revert to a literal.
 *
 * They assert three things a future refactor could each break independently:
 *   1. the widget reads the REAL API (no hardcoded rows),
 *   2. it reads `/notifications/feed`, not the bare unread-only endpoint,
 *   3. server severity is MAPPED to the widget's vocabulary, not cast — the
 *      two enums disagree at exactly one value, and it is the urgent one.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();

// Mocked at the transport boundary — both the module the notifications API
// imports and the one the dashboard API imports resolve to this client.
vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

vi.mock("@/lib/api/axios", () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

const dashboardApi = await import("../api/dashboardApi");

/** A server-shaped notification row, as `/notifications/feed` returns it. */
function serverRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "n-real-1",
    type: "OUT_OF_STOCK",
    typeLabel: "Out of stock",
    category: "INVENTORY",
    severity: "CRITICAL",
    title: "Out of stock",
    message: "Black Leather Jacket (L) is out of stock.",
    isRead: false,
    referenceId: null,
    referenceType: null,
    createdAt: "2026-08-03T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({
    success: true,
    data: [serverRow()],
    meta: { total: 1, page: 1, limit: 8, totalPages: 1, unreadTotal: 1 },
  });
});

describe("getNotifications — real data, not mocks", () => {
  it("issues a network request instead of returning hardcoded rows", async () => {
    await dashboardApi.getNotifications();

    expect(get).toHaveBeenCalled();
  });

  it("returns what the server sent", async () => {
    const result = await dashboardApi.getNotifications();

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("n-real-1");
    expect(result[0]?.message).toBe("Black Leather Jacket (L) is out of stock.");
  });

  it("does not contain the retired mock fixtures", async () => {
    const result = await dashboardApi.getNotifications();
    const serialised = JSON.stringify(result);

    // The exact strings the old mock returned. If any reappears, someone has
    // restored a literal or added a fallback that fabricates notifications.
    expect(serialised).not.toContain("POS version 1.2");
    expect(serialised).not.toContain("Large Sale Alert");
    expect(serialised).not.toContain("RCP-103");
  });

  it("returns an empty list when the user has no notifications", async () => {
    get.mockResolvedValue({
      success: true,
      data: [],
      meta: { total: 0, page: 1, limit: 8, totalPages: 0, unreadTotal: 0 },
    });

    // Must be a genuine empty state ("You're all caught up!"), never a silent
    // fall back to sample data.
    await expect(dashboardApi.getNotifications()).resolves.toEqual([]);
  });

  it("propagates errors rather than masking them with mock data", async () => {
    get.mockRejectedValue(new Error("Network down"));

    await expect(dashboardApi.getNotifications()).rejects.toThrow("Network down");
  });
});

describe("getNotifications — endpoint routing", () => {
  it("reads /notifications/feed, not the bare unread-only endpoint", async () => {
    await dashboardApi.getNotifications();

    // Both paths return 200. The bare one would silently drop every read
    // notification and ignore the limit.
    expect(get).toHaveBeenCalledWith("/notifications/feed", expect.anything());
  });

  it("requests a bounded, newest-first slice", async () => {
    await dashboardApi.getNotifications();

    const params = get.mock.calls[0]?.[1]?.params ?? {};
    expect(Number(params.limit)).toBeGreaterThan(0);
    expect(params.sortOrder).toBe("desc");
  });
});

describe("getNotifications — severity mapping", () => {
  it("maps CRITICAL to the widget's ERROR tone", async () => {
    // The one value where the two vocabularies disagree. A structural cast
    // would compile and leave critical alerts unstyled.
    const result = await dashboardApi.getNotifications();

    expect(result[0]?.type).toBe("ERROR");
  });

  it.each([
    ["INFO", "INFO"],
    ["SUCCESS", "SUCCESS"],
    ["WARNING", "WARNING"],
    ["CRITICAL", "ERROR"],
  ])("maps server severity %s to widget type %s", async (severity, expected) => {
    get.mockResolvedValue({
      success: true,
      data: [serverRow({ severity })],
      meta: { total: 1, page: 1, limit: 8, totalPages: 1, unreadTotal: 1 },
    });

    const result = await dashboardApi.getNotifications();

    expect(result[0]?.type).toBe(expected);
  });

  it("carries read-state and timestamp through unchanged", async () => {
    const result = await dashboardApi.getNotifications();

    expect(result[0]?.isRead).toBe(false);
    // `createdAt` on the server becomes `timestamp` in the widget's shape.
    expect(result[0]?.timestamp).toBe("2026-08-03T10:00:00.000Z");
  });
});
