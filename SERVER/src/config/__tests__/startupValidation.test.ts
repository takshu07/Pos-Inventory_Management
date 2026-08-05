// =============================================================================
// STARTUP ENVIRONMENT VALIDATION
//
// Covers `validateEnvironment()`, with the emphasis on ONE scenario that is
// otherwise only discovered in production, at the worst possible moment:
//
//   A till runs Offline Mode on local SQLite and has NO DATABASE_URL — by
//   design, because production database credentials do not belong on
//   shop-floor hardware. Disabling Offline Mode moves it back onto the cloud
//   database, so it suddenly requires a variable it has never had, and the
//   server refuses to boot.
//
// The refusal is correct: the alternative is a till that starts fine and then
// fails at the first sale. But "Missing required environment variables:
// DATABASE_URL" gives whoever is performing the rollback no way to connect the
// error to the change they just made — and the intuitive fix (clear the local
// database and start over) is the one action that destroys every un-uploaded
// sale.
//
// So the message itself is behaviour worth pinning, not just cosmetics.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateEnvironment } from "../prisma";
import { resetOfflineConfigCache } from "../../offline/config";

// =============================================================================
// ENV ISOLATION
// =============================================================================

const KEYS = [
  "DATABASE_URL",
  "JWT_SECRET",
  "OFFLINE_MODE_ENABLED",
  "OFFLINE_ROLE",
  "OFFLINE_DEVICE_ID",
  "SYNC_CLOUD_URL",
  "SYNC_DEVICE_SECRET",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  resetOfflineConfigCache();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetOfflineConfigCache();
});

// =============================================================================
// BASELINE
// =============================================================================

describe("validateEnvironment", () => {
  it("passes when both required variables are present", () => {
    process.env["DATABASE_URL"] = "postgresql://user:pw@host/db";
    process.env["JWT_SECRET"] = "j".repeat(48);
    resetOfflineConfigCache();

    expect(() => validateEnvironment()).not.toThrow();
  });

  it("rejects a missing JWT_SECRET", () => {
    process.env["DATABASE_URL"] = "postgresql://user:pw@host/db";
    resetOfflineConfigCache();

    expect(() => validateEnvironment()).toThrow(/JWT_SECRET/);
  });

  it("treats a whitespace-only value as missing", () => {
    process.env["DATABASE_URL"] = "postgresql://user:pw@host/db";
    process.env["JWT_SECRET"] = "   ";
    resetOfflineConfigCache();

    expect(() => validateEnvironment()).toThrow(/JWT_SECRET/);
  });
});

// =============================================================================
// THE EDGE-NODE WAIVER
// =============================================================================

describe("DATABASE_URL waiver for an enabled edge node", () => {
  it("does not require DATABASE_URL while Offline Mode is enabled", () => {
    // This is what lets a till run without cloud credentials at all.
    process.env["JWT_SECRET"] = "j".repeat(48);
    process.env["OFFLINE_MODE_ENABLED"] = "true";
    process.env["OFFLINE_ROLE"] = "edge";
    process.env["OFFLINE_DEVICE_ID"] = "store-01-till-01";
    process.env["SYNC_CLOUD_URL"] = "https://cloud.example.com";
    process.env["SYNC_DEVICE_SECRET"] = "s".repeat(48);
    resetOfflineConfigCache();

    expect(() => validateEnvironment()).not.toThrow();
  });

  it("still requires DATABASE_URL on an enabled CLOUD node", () => {
    // The waiver is for edge nodes only; a cloud node with no database is
    // simply broken.
    process.env["JWT_SECRET"] = "j".repeat(48);
    process.env["OFFLINE_MODE_ENABLED"] = "true";
    process.env["OFFLINE_ROLE"] = "cloud";
    process.env["SYNC_DEVICE_SECRET"] = "s".repeat(48);
    resetOfflineConfigCache();

    expect(() => validateEnvironment()).toThrow(/DATABASE_URL/);
  });
});

// =============================================================================
// THE ROLLBACK MESSAGE
// =============================================================================

describe("the rollback diagnostic", () => {
  /** A till mid-rollback: switch off, edge variables still present, no DB URL. */
  function applyRolledBackTill(): void {
    process.env["JWT_SECRET"] = "j".repeat(48);
    process.env["OFFLINE_MODE_ENABLED"] = "false";
    process.env["OFFLINE_ROLE"] = "edge";
    process.env["OFFLINE_DEVICE_ID"] = "store-01-till-01";
    process.env["SYNC_DEVICE_SECRET"] = "s".repeat(48);
    resetOfflineConfigCache();
  }

  it("still refuses to start — failing closed is the correct behaviour", () => {
    // Booting without a database would defer the failure to the first sale.
    applyRolledBackTill();

    expect(() => validateEnvironment()).toThrow(/DATABASE_URL/);
  });

  it("names the rollback as the likely cause", () => {
    applyRolledBackTill();

    expect(() => validateEnvironment()).toThrow(/rollback/i);
  });

  it("tells the operator to set DATABASE_URL and clear OFFLINE_ROLE", () => {
    applyRolledBackTill();

    let message = "";
    try {
      validateEnvironment();
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/Set DATABASE_URL/i);
    expect(message).toMatch(/OFFLINE_ROLE/);
    expect(message).toMatch(/restart/i);
  });

  it("offers cancelling the rollback as the alternative", () => {
    applyRolledBackTill();

    expect(() => validateEnvironment()).toThrow(/OFFLINE_MODE_ENABLED=true/);
  });

  it("warns against the action that would destroy the queue", () => {
    // The intuitive fix for "the till won't start" is to rebuild its local
    // database. That is the ONE irreversible mistake in the whole rollback
    // path, so the error message has to head it off explicitly.
    applyRolledBackTill();

    let message = "";
    try {
      validateEnvironment();
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/db:local:setup/);
    expect(message).toMatch(/NOT lost|not lost/);
    expect(message).toMatch(/OFFLINE_ROLLBACK_RUNBOOK\.md/);
  });

  it("fires on a leftover device id even when OFFLINE_ROLE was cleared", () => {
    // A half-tidied rollback still deserves the diagnostic.
    process.env["JWT_SECRET"] = "j".repeat(48);
    process.env["OFFLINE_MODE_ENABLED"] = "false";
    process.env["OFFLINE_DEVICE_ID"] = "store-01-till-01";
    resetOfflineConfigCache();

    expect(() => validateEnvironment()).toThrow(/rollback/i);
  });

  it("stays quiet on a plain cloud server that never ran Offline Mode", () => {
    // No offline variables anywhere: this is an ordinary misconfiguration and
    // must get the plain message, not a confusing lecture about tills.
    process.env["JWT_SECRET"] = "j".repeat(48);
    resetOfflineConfigCache();

    let message = "";
    try {
      validateEnvironment();
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/DATABASE_URL/);
    expect(message).not.toMatch(/rollback/i);
  });

  it("stays quiet when only JWT_SECRET is missing on a rolled-back till", () => {
    // The rollback story belongs to DATABASE_URL alone.
    process.env["DATABASE_URL"] = "postgresql://user:pw@host/db";
    process.env["OFFLINE_MODE_ENABLED"] = "false";
    process.env["OFFLINE_ROLE"] = "edge";
    resetOfflineConfigCache();

    let message = "";
    try {
      validateEnvironment();
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/JWT_SECRET/);
    expect(message).not.toMatch(/rollback/i);
  });
});
