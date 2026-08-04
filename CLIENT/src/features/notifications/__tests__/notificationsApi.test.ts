/**
 * Notifications — transport layer regression tests.
 *
 * WHY ENDPOINT ROUTING IS PINNED HERE
 * -----------------------------------
 * The settings module shipped a base path the server never mounted, and every
 * read and write 404'd for months, because no test asserted a request URL.
 * This module has a sharper version of the same trap: `/notifications` and
 * `/notifications/feed` BOTH exist and both return 200.
 *
 *   • `/notifications`      — unread only, unpaginated (Navbar bell, dashboard)
 *   • `/notifications/feed` — paginated, filtered (this screen)
 *
 * Pointing the screen at the bare path would not error. It would silently show
 * only unread notifications, ignore every filter, and ignore paging — a bug
 * that looks like a product decision. Hence the assertions below.
 *
 * apiClient is mocked at the module boundary: this is a transport test, not a
 * network test.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

const api = await import("../api/notificationsApi");

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ success: true, data: [], meta: { total: 0 } });
  post.mockResolvedValue({ success: true, data: { updated: 0 } });
});

describe("endpoint routing", () => {
  it("reads the list from /notifications/feed, not /notifications", async () => {
    await api.fetchNotifications({ page: 1 });

    expect(get).toHaveBeenCalledWith("/notifications/feed", expect.anything());
  });

  it("never reads the list from the bare unread-only endpoint", async () => {
    // The bare path returns 200 with unread-only rows, so a wrong path here
    // degrades silently instead of failing loudly.
    await api.fetchNotifications({ page: 1 });

    const path = String(get.mock.calls[0]?.[0]);
    expect(path).not.toBe("/notifications");
  });

  it("reads counts from /notifications/summary", async () => {
    get.mockResolvedValue({ success: true, data: { total: 0, unreadTotal: 0 } });
    await api.fetchNotificationSummary();

    expect(get).toHaveBeenCalledWith("/notifications/summary");
  });

  it("posts bulk reads to /notifications/read", async () => {
    await api.markNotificationsRead(["a", "b"]);

    expect(post).toHaveBeenCalledWith("/notifications/read", { ids: ["a", "b"] });
  });

  it("posts mark-all to the pre-existing /notifications/read-all", async () => {
    // This one deliberately reuses the endpoint that already existed rather
    // than adding a parallel one.
    await api.markAllNotificationsRead();

    expect(post).toHaveBeenCalledWith("/notifications/read-all");
  });

  it("uses paths relative to the api client's baseURL", async () => {
    await api.fetchNotifications({ page: 1 });

    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith("/")).toBe(true);
    expect(path).not.toContain("/api/v1");
    expect(path).not.toMatch(/^https?:/);
  });
});

describe("query serialisation", () => {
  it("comma-joins array filters", () => {
    const q = api.toQuery({ category: ["INVENTORY", "SALES"] });

    expect(q.category).toBe("INVENTORY,SALES");
  });

  it("drops empty arrays rather than sending an empty param", () => {
    // `?category=` fails the server's enum instead of reading as "no filter".
    const q = api.toQuery({ category: [] });

    expect(q).not.toHaveProperty("category");
  });

  it("drops undefined and empty-string values", () => {
    const q = api.toQuery({ search: "", page: undefined });

    expect(q).not.toHaveProperty("search");
    expect(q).not.toHaveProperty("page");
  });

  it("PRESERVES isRead:false — it means 'unread only', not 'absent'", () => {
    // The bug a generic falsy-strip would introduce: the unread filter would
    // silently become "show everything".
    const q = api.toQuery({ isRead: false });

    expect(q.isRead).toBe("false");
  });

  it("preserves isRead:true", () => {
    const q = api.toQuery({ isRead: true });

    expect(q.isRead).toBe("true");
  });

  it("passes paging through unchanged", () => {
    const q = api.toQuery({ page: 3, limit: 25 });

    expect(q.page).toBe(3);
    expect(q.limit).toBe(25);
  });
});

describe("envelope handling", () => {
  it("unwraps rows from data and pagination from meta", async () => {
    get.mockResolvedValue({
      success: true,
      data: [{ id: "n1" }],
      meta: { total: 1, page: 1, limit: 25, totalPages: 1, unreadTotal: 1 },
    });

    const result = await api.fetchNotifications({ page: 1 });

    // Reading the wrong envelope level yields an empty list rather than
    // throwing, which is exactly why this is asserted.
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
    expect(result.meta.unreadTotal).toBe(1);
  });

  it("returns an empty array when the server sends no rows", async () => {
    get.mockResolvedValue({ success: true, data: null, meta: { total: 0 } });

    const result = await api.fetchNotifications({ page: 1 });

    // A null must not reach the list component as a crash.
    expect(result.data).toEqual([]);
  });

  it("propagates transport errors instead of swallowing them", async () => {
    post.mockRejectedValue(new Error("Network down"));

    await expect(api.markNotificationsRead(["a"])).rejects.toThrow("Network down");
  });
});
