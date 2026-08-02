/**
 * Regression tests for the Users & Roles transport layer.
 *
 * These pin the three decisions in usersApi.ts that are invisible at the call
 * site and would break silently:
 *
 *   1. WHICH ENDPOINT each operation targets. Role change deliberately goes to
 *      the WORKFORCE tree, not `/employees` PATCH, because only that path
 *      closes the target's sessions — otherwise a demoted manager keeps manager
 *      access until their JWT expires. A "tidy-up" that routed it through the
 *      employees endpoint would look correct and quietly reintroduce that hole.
 *
 *   2. THAT EMPTY FILTERS ARE DROPPED. Sending `?role=` makes the server's zod
 *      enum reject the request instead of reading it as "no filter".
 *
 *   3. THAT `isActive: false` AND `email: ""` SURVIVE. Both are meaningful
 *      values, not absences — one deactivates an account, the other clears an
 *      address. A generic "strip falsy values" helper would swallow both.
 *
 * apiClient is mocked at the module boundary: this is a transport test, not a
 * network test.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: (...args: unknown[]) => patch(...args),
  },
}));

const api = await import("../api/usersApi");

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: [], meta: { total: 0, page: 1, totalPages: 1 } });
  post.mockResolvedValue({ data: {} });
  patch.mockResolvedValue({ data: {} });
});

// =============================================================================
// ENDPOINT ROUTING
// =============================================================================

describe("endpoint routing", () => {
  it("reads the list from /employees", async () => {
    await api.fetchUsers({ page: 1, limit: 20 });
    expect(get).toHaveBeenCalledWith("/employees", expect.anything());
  });

  it("creates through /employees", async () => {
    await api.createUser({
      firstName: "Rahul",
      lastName: "Sharma",
      phone: "9876543210",
      password: "Password1",
      role: "CASHIER",
    });
    expect(post).toHaveBeenCalledWith("/employees", expect.anything());
  });

  it("updates through /employees/:id", async () => {
    await api.updateUser("abc", { firstName: "Rahul" });
    expect(patch).toHaveBeenCalledWith("/employees/abc", { firstName: "Rahul" });
  });

  it("routes a ROLE CHANGE to the workforce tree, not /employees", async () => {
    // The load-bearing assertion in this file. /employees PATCH accepts `role`
    // and would appear to work, but does NOT revoke the target's sessions.
    await api.changeUserRole("abc", "MANAGER");
    expect(patch).toHaveBeenCalledWith("/owner/workforce/employees/abc/role", {
      role: "MANAGER",
    });

    // Assert on the PREFIX, not a substring: the workforce URL legitimately
    // contains "/employees/abc" further along, so `stringContaining` would
    // match it and the negative assertion would fail against correct code.
    const url = patch.mock.calls[0]?.[0] as string;
    expect(url.startsWith("/employees/")).toBe(false);
  });

  it("routes a PASSWORD RESET to the workforce tree", async () => {
    await api.resetUserPassword("abc", "Password1");
    expect(post).toHaveBeenCalledWith("/owner/workforce/employees/abc/reset-password", {
      newPassword: "Password1",
    });
  });
});

// =============================================================================
// QUERY PARAM CLEANING
// =============================================================================

describe("list params", () => {
  const paramsSent = () => get.mock.calls[0]?.[1]?.params as Record<string, unknown>;

  it("drops empty filters so the server sees no filter at all", async () => {
    await api.fetchUsers({ page: 1, limit: 20, search: "", role: "" });
    const params = paramsSent();
    expect(params).not.toHaveProperty("search");
    expect(params).not.toHaveProperty("role");
  });

  it("keeps isActive:false — 'show deactivated' is a real filter", async () => {
    // The bug this guards against: a falsy-stripping helper turning
    // "show me deactivated accounts" into "show me everything".
    await api.fetchUsers({ page: 1, limit: 20, isActive: false });
    expect(paramsSent()).toHaveProperty("isActive", false);
  });

  it("keeps isActive:true", async () => {
    await api.fetchUsers({ page: 1, limit: 20, isActive: true });
    expect(paramsSent()).toHaveProperty("isActive", true);
  });

  it("passes through real filter values", async () => {
    await api.fetchUsers({
      page: 2,
      limit: 20,
      search: "rahul",
      role: "MANAGER",
      sortBy: "firstName",
      sortOrder: "asc",
    });
    expect(paramsSent()).toMatchObject({
      page: 2,
      search: "rahul",
      role: "MANAGER",
      sortBy: "firstName",
      sortOrder: "asc",
    });
  });
});

// =============================================================================
// UPDATE PAYLOAD SEMANTICS
// =============================================================================

describe("update payloads", () => {
  it("sends isActive:false verbatim when deactivating", async () => {
    await api.setUserActive("abc", false);
    expect(patch).toHaveBeenCalledWith("/employees/abc", { isActive: false });
  });

  it("sends isActive:true when reactivating", async () => {
    await api.setUserActive("abc", true);
    expect(patch).toHaveBeenCalledWith("/employees/abc", { isActive: true });
  });

  it("preserves an empty email — that is how an address is CLEARED", async () => {
    // Server: `if (data.email === "") updateData.email = null`. Stripping the
    // empty string would make "remove this email" a silent no-op.
    await api.updateUser("abc", { email: "" });
    expect(patch).toHaveBeenCalledWith("/employees/abc", { email: "" });
  });
});

// =============================================================================
// RESPONSE ENVELOPE
// =============================================================================

describe("pagination envelope", () => {
  it("flattens { data, meta } into the client shape", async () => {
    get.mockResolvedValue({
      data: [{ id: "1" }],
      meta: { total: 42, page: 3, totalPages: 5 },
    });
    const result = await api.fetchUsers({ page: 3, limit: 10 });
    expect(result).toEqual({
      data: [{ id: "1" }],
      total: 42,
      page: 3,
      totalPages: 5,
    });
  });

  it("derives totalPages when the server omits it", async () => {
    get.mockResolvedValue({ data: [], meta: { total: 25, page: 1 } });
    const result = await api.fetchUsers({ page: 1, limit: 10 });
    expect(result.totalPages).toBe(3);
  });

  it("survives a malformed envelope rather than throwing", async () => {
    // A list screen that crashes on an unexpected shape is worse than one that
    // renders an empty state.
    get.mockResolvedValue({});
    const result = await api.fetchUsers({ page: 1, limit: 10 });
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(1);
  });
});
