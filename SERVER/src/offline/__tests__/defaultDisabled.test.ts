// =============================================================================
// OFFLINE MODE IS OFF BY DEFAULT
//
// ⚠ This is a SAFETY suite, not a feature suite. It pins the single property
// that makes shipping this branch safe at all: with no offline environment
// variables set, the server is the one that existed before the feature.
//
// Why it needs a test rather than a comment. The default lives in one `readBool`
// call, and the ways it could flip are all mundane:
//
//   • someone changes the fallback while debugging an edge node and does not
//     change it back;
//   • `OFFLINE_MODE_ENABLED=true` gets committed to `.env.example` and copied
//     into a production deployment by whoever sets that server up;
//   • a truthiness helper starts treating `"false"` or `"0"` as enabled.
//
// Each of those turns a production cloud server into one that opens a SQLite
// file it has no schema for and installs triggers on the live database. The
// failure is not subtle, but it is entirely preventable, and it happens on a
// deploy rather than in a code review.
//
// MODULE_STATUS §0.4 states that offline stays disabled until the operational
// validation is signed off. This is that statement, enforced.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  assertOfflineConfigValid,
  isCloudNode,
  isEdgeNode,
  resetOfflineConfigCache,
  resolveOfflineConfig,
} from "../config";

// =============================================================================
// ENV ISOLATION
// =============================================================================

const OFFLINE_KEYS = [
  "OFFLINE_MODE_ENABLED",
  "OFFLINE_ROLE",
  "OFFLINE_DEVICE_ID",
  "LOCAL_DATABASE_PATH",
  "LOCAL_DATABASE_URL",
  "SYNC_CLOUD_URL",
  "SYNC_DEVICE_SECRET",
  "SYNC_AUTO_ENABLED",
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
});

// =============================================================================
// THE DEFAULT
// =============================================================================

describe("offline mode default", () => {
  it("is DISABLED when no offline variables are set", () => {
    expect(resolveOfflineConfig().enabled).toBe(false);
  });

  it("defaults to the cloud role, never edge", () => {
    // A node that defaulted to `edge` would try to serve business traffic from
    // a SQLite file that was never created.
    expect(resolveOfflineConfig().role).toBe("cloud");
  });

  it("reports neither edge nor cloud behaviour while disabled", () => {
    // Both helpers gate on `enabled` first, so a disabled node takes no offline
    // code path at all — not even the cloud half.
    expect(isEdgeNode()).toBe(false);
    expect(isCloudNode()).toBe(false);
  });

  it("validates trivially while disabled, demanding no secrets", () => {
    // An existing deployment must be able to take this code without setting a
    // single new variable. If this ever throws, every current server fails to
    // boot on upgrade.
    expect(() => {
      assertOfflineConfigValid(resolveOfflineConfig());
    }).not.toThrow();
  });
});

// =============================================================================
// TRUTHINESS
// =============================================================================

describe("enable flag parsing", () => {
  it.each(["false", "0", "no", "off", "", "  "])(
    "treats %o as disabled",
    (value) => {
      process.env["OFFLINE_MODE_ENABLED"] = value;
      resetOfflineConfigCache();

      expect(resolveOfflineConfig().enabled).toBe(false);
    }
  );

  it.each(["true", "1", "yes", "on", "TRUE", "True"])(
    "treats %o as enabled",
    (value) => {
      process.env["OFFLINE_MODE_ENABLED"] = value;
      resetOfflineConfigCache();

      expect(resolveOfflineConfig().enabled).toBe(true);
    }
  );

  it("treats an unrecognized value as disabled, not enabled", () => {
    // Fail safe. A typo like `OFFLINE_MODE_ENABLED=ture` must leave production
    // on the path it was already on.
    process.env["OFFLINE_MODE_ENABLED"] = "ture";
    resetOfflineConfigCache();

    expect(resolveOfflineConfig().enabled).toBe(false);
  });

  it("only treats OFFLINE_ROLE=edge as edge", () => {
    process.env["OFFLINE_MODE_ENABLED"] = "true";
    process.env["OFFLINE_ROLE"] = "EDGE_NODE";
    resetOfflineConfigCache();

    expect(resolveOfflineConfig().role).toBe("cloud");
  });
});

// =============================================================================
// ENABLING REQUIRES A COMPLETE CONFIGURATION
// =============================================================================

describe("enabling refuses a half-configured node", () => {
  it("refuses an edge node with no device id", () => {
    // Two stores sharing a device id would produce colliding idempotency keys
    // and the cloud would silently discard one store's sales as duplicates.
    process.env["OFFLINE_MODE_ENABLED"] = "true";
    process.env["OFFLINE_ROLE"] = "edge";
    process.env["SYNC_CLOUD_URL"] = "https://cloud.example.com";
    process.env["SYNC_DEVICE_SECRET"] = "s".repeat(48);
    resetOfflineConfigCache();

    expect(() => {
      assertOfflineConfigValid(resolveOfflineConfig());
    }).toThrow(/OFFLINE_DEVICE_ID/);
  });

  it("refuses an edge node with no cloud URL", () => {
    process.env["OFFLINE_MODE_ENABLED"] = "true";
    process.env["OFFLINE_ROLE"] = "edge";
    process.env["OFFLINE_DEVICE_ID"] = "till-01";
    process.env["SYNC_DEVICE_SECRET"] = "s".repeat(48);
    resetOfflineConfigCache();

    expect(() => {
      assertOfflineConfigValid(resolveOfflineConfig());
    }).toThrow(/SYNC_CLOUD_URL/);
  });

  it("refuses any enabled node with no device secret", () => {
    process.env["OFFLINE_MODE_ENABLED"] = "true";
    resetOfflineConfigCache();

    expect(() => {
      assertOfflineConfigValid(resolveOfflineConfig());
    }).toThrow(/SYNC_DEVICE_SECRET/);
  });

  it("refuses a device secret short enough to guess", () => {
    // It is the only credential protecting /sync/upload.
    process.env["OFFLINE_MODE_ENABLED"] = "true";
    process.env["SYNC_DEVICE_SECRET"] = "short";
    resetOfflineConfigCache();

    expect(() => {
      assertOfflineConfigValid(resolveOfflineConfig());
    }).toThrow(/at least 32 characters/);
  });

  it("accepts a fully configured edge node", () => {
    process.env["OFFLINE_MODE_ENABLED"] = "true";
    process.env["OFFLINE_ROLE"] = "edge";
    process.env["OFFLINE_DEVICE_ID"] = "store-01-till-01";
    process.env["SYNC_CLOUD_URL"] = "https://cloud.example.com";
    process.env["SYNC_DEVICE_SECRET"] = "s".repeat(48);
    resetOfflineConfigCache();

    expect(() => {
      assertOfflineConfigValid(resolveOfflineConfig());
    }).not.toThrow();
  });
});

// =============================================================================
// NOTHING COMMITTED TURNS IT ON
// =============================================================================

describe("committed configuration", () => {
  const SERVER_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

  it("does not enable offline mode in .env.example", () => {
    // `.env.example` is what someone copies when standing up a new server. A
    // stray `OFFLINE_MODE_ENABLED=true` there reaches production by way of
    // somebody following the setup instructions correctly.
    const examplePath = path.join(SERVER_ROOT, ".env.example");
    if (!fs.existsSync(examplePath)) return;

    const contents = fs.readFileSync(examplePath, "utf8");
    const enabling = contents
      .split(/\r?\n/)
      .filter((line) => /^\s*OFFLINE_MODE_ENABLED\s*=\s*(1|true|yes|on)\b/i.test(line));

    expect(enabling).toEqual([]);
  });

  it("does not enable offline mode in the Dockerfile or compose file", () => {
    for (const file of ["Dockerfile", "docker-compose.yml"]) {
      const target = path.join(SERVER_ROOT, file);
      if (!fs.existsSync(target)) continue;

      const contents = fs.readFileSync(target, "utf8");
      expect(
        /OFFLINE_MODE_ENABLED\s*[:=]\s*["']?(1|true|yes|on)\b/i.test(contents),
        `${file} enables offline mode`
      ).toBe(false);
    }
  });

  it("does not enable offline mode in any CI workflow", () => {
    // A workflow that exports OFFLINE_MODE_ENABLED=true turns the pipeline
    // green against SQLite while production runs on Neon — the suite would
    // then be proving the wrong server. Worse, CI files are the usual place a
    // deploy step reads its environment from, so a value set here can travel
    // to a real host without ever appearing in .env.example.
    //
    // Discovered as a gap during pre-deployment review: the three checks above
    // existed, this one did not, and CI is the file least likely to be re-read
    // before a release.
    const workflowDir = path.join(SERVER_ROOT, ".github", "workflows");
    if (!fs.existsSync(workflowDir)) return;

    const workflows = fs
      .readdirSync(workflowDir)
      .filter((name) => /\.ya?ml$/i.test(name));

    for (const file of workflows) {
      const contents = fs.readFileSync(path.join(workflowDir, file), "utf8");
      expect(
        /OFFLINE_MODE_ENABLED\s*[:=]\s*["']?(1|true|yes|on)\b/i.test(contents),
        `.github/workflows/${file} enables offline mode`
      ).toBe(false);
    }
  });
});
