/**
 * Regression tests for the Settings transport layer.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `settingsApi.ts` used `BASE = "/settings"` while the server mounts the
 * configuration document at `/api/v1/configuration`. Every Store Settings and
 * Receipt & Invoice Settings read and write returned:
 *
 *   404 {"success":false,"message":"The requested endpoint does not exist."}
 *
 * It survived because the settings suites only tested pure functions
 * (`applyPatch`, validators, the invoice preview). Not one assertion touched a
 * request URL, so the entire feature could be pointed at a non-existent route
 * and stay green.
 *
 * These tests pin the transport decisions that are invisible at the call site:
 *
 *   1. WHICH ENDPOINT both verbs target. The folder is "settings" and the route
 *      is "configuration" — the exact mismatch that caused the bug, so a rename
 *      toward the folder name must fail loudly here.
 *   2. THAT THE PATCH BODY IS SENT VERBATIM. The server merges per key; a
 *      transport that dropped or reshaped keys would silently revert whole
 *      config blocks to their Zod defaults.
 *   3. THAT THE ENVELOPE IS UNWRAPPED ONCE. The axios interceptor already
 *      returns `{success,message,data}`, so these functions must return `.data`.
 *
 * apiClient is mocked at the module boundary: this is a transport test, not a
 * network test. End-to-end behaviour against the live server is verified
 * separately (docs/CONFIGURATION_OWNERSHIP.md §7).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const patch = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    patch: (...args: unknown[]) => patch(...args),
  },
}));

const api = await import("../api/settingsApi");

/**
 * The path the server actually mounts (`SERVER/src/app.ts` →
 * `app.use("/api/v1/configuration", configurationRoutes)`).
 *
 * Written as a literal rather than imported from the source so that changing
 * the source constant makes these tests FAIL rather than silently follow it.
 */
const CONFIGURATION_ENDPOINT = "/configuration";

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { version: 1 } });
  patch.mockResolvedValue({ data: { version: 2 } });
});

describe("settingsApi — endpoint routing", () => {
  it("reads from /configuration, not /settings", async () => {
    await api.fetchSettings();

    expect(get).toHaveBeenCalledWith(CONFIGURATION_ENDPOINT);
  });

  it("writes to /configuration, not /settings", async () => {
    await api.updateSettings({ storeName: "CEX" });

    expect(patch).toHaveBeenCalledWith(
      CONFIGURATION_ENDPOINT,
      expect.anything()
    );
  });

  it("never targets the unmounted /settings path", async () => {
    // The literal that caused the outage. Asserting its ABSENCE means a partial
    // revert is caught even if someone adds a second call alongside.
    await api.fetchSettings();
    await api.updateSettings({ storeName: "CEX" });

    const allPaths = [...get.mock.calls, ...patch.mock.calls].map(
      (call) => call[0]
    );

    expect(allPaths.length).toBeGreaterThan(0);
    for (const path of allPaths) {
      expect(path).not.toBe("/settings");
      // Also rejects "/settings/whatever" without rejecting "/configuration".
      expect(String(path).startsWith("/settings")).toBe(false);
    }
  });

  it("uses a path relative to the api client's baseURL", async () => {
    // apiClient already carries `/api/v1`. A path that re-included it would
    // resolve to /api/v1/api/v1/configuration and 404 in a way that looks like
    // a server problem rather than a client one.
    await api.fetchSettings();

    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith("/")).toBe(true);
    expect(path).not.toContain("/api/v1");
    expect(path).not.toMatch(/^https?:/);
  });
});

describe("settingsApi — payload integrity", () => {
  it("sends the patch body verbatim", async () => {
    // The server merges key-by-key. Anything that reshaped this payload would
    // revert untouched fields to Zod defaults without erroring.
    const body = {
      invoiceConfig: { invoicePrefix: "BILL" },
      expectedVersion: 7,
    };

    await api.updateSettings(body);

    expect(patch).toHaveBeenCalledWith(CONFIGURATION_ENDPOINT, body);
  });

  it("preserves expectedVersion so conflict detection still fires", async () => {
    // Strip this and concurrent saves stop 409-ing and start silently
    // overwriting each other.
    await api.updateSettings({ storeName: "CEX", expectedVersion: 3 });

    expect(patch.mock.calls[0]?.[1]).toMatchObject({ expectedVersion: 3 });
  });

  it("sends an empty patch as-is rather than omitting the body", async () => {
    await api.updateSettings({});

    expect(patch).toHaveBeenCalledWith(CONFIGURATION_ENDPOINT, {});
  });
});

describe("settingsApi — response handling", () => {
  it("unwraps the envelope exactly once on read", async () => {
    get.mockResolvedValue({ data: { storeName: "CEX", version: 4 } });

    const result = await api.fetchSettings();

    // The axios interceptor returns the whole envelope; returning `res` rather
    // than `res.data` would hand callers `{data:{…}}` and every field would
    // read as undefined.
    expect(result).toEqual({ storeName: "CEX", version: 4 });
  });

  it("returns the server's post-merge document on write", async () => {
    // Callers seed their cache and baseVersion from this, so it must be the
    // server's state, not the optimistic guess.
    patch.mockResolvedValue({ data: { storeName: "CEX", version: 5 } });

    const result = await api.updateSettings({ storeName: "CEX" });

    expect(result).toEqual({ storeName: "CEX", version: 5 });
  });

  it("propagates transport errors instead of swallowing them", async () => {
    // 409 conflict and 400 constraint violations are handled by name upstream;
    // a resolved-with-undefined here would break both paths.
    patch.mockRejectedValue(new Error("SETTINGS_VERSION_CONFLICT"));

    await expect(api.updateSettings({ storeName: "CEX" })).rejects.toThrow(
      "SETTINGS_VERSION_CONFLICT"
    );
  });
});
