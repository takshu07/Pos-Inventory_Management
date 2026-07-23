import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAuthContextCache,
  getAuthContext,
  invalidateAuthContext,
  setAuthContext,
} from "../authContextCache";

describe("authContextCache", () => {
  beforeEach(() => {
    clearAuthContextCache();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearAuthContextCache();
  });

  it("returns null on a miss", () => {
    expect(getAuthContext("nobody")).toBeNull();
  });

  it("returns the stored context on a hit", () => {
    setAuthContext("emp-1", { refreshTokenVersion: 3, isActive: true });
    expect(getAuthContext("emp-1")).toEqual({
      refreshTokenVersion: 3,
      isActive: true,
    });
  });

  it("invalidation forces the next read to miss (security-critical)", () => {
    setAuthContext("emp-1", { refreshTokenVersion: 3, isActive: true });
    invalidateAuthContext("emp-1");
    expect(getAuthContext("emp-1")).toBeNull();
  });

  it("expires entries after the TTL so stale state self-heals", () => {
    vi.useFakeTimers();
    setAuthContext("emp-1", { refreshTokenVersion: 1, isActive: true });

    // Just before TTL: still cached.
    vi.advanceTimersByTime(29_000);
    expect(getAuthContext("emp-1")).not.toBeNull();

    // Past the default 30s TTL: gone.
    vi.advanceTimersByTime(2_000);
    expect(getAuthContext("emp-1")).toBeNull();
  });

  it("keeps entries isolated per employee", () => {
    setAuthContext("emp-1", { refreshTokenVersion: 1, isActive: true });
    setAuthContext("emp-2", { refreshTokenVersion: 9, isActive: false });
    invalidateAuthContext("emp-1");
    expect(getAuthContext("emp-1")).toBeNull();
    expect(getAuthContext("emp-2")).toEqual({
      refreshTokenVersion: 9,
      isActive: false,
    });
  });
});
