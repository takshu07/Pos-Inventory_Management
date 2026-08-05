// =============================================================================
// RAW BODY CAPTURE — THE SIGNED SYNC ENDPOINTS
//
// ⚠ A SECURITY-ADJACENT REGRESSION SUITE. It exists because of a bug that was
// invisible to every other test:
//
//   `app.ts` mounted a global `express.json()` ahead of the sync router. It
//   drained the request stream, so the sync router's own parser — the one whose
//   `verify` hook keeps the raw bytes — had nothing left to read.
//   `req.rawSyncBody` stayed undefined, the device verifier fell back to
//   hashing "", and EVERY signed upload failed with a 401 that looked exactly
//   like a bad credential. The sync engine was completely non-functional and
//   the symptom pointed at the wrong subsystem entirely.
//
// The failure is silent, the symptom is misleading, and the fix is one line of
// middleware ordering that a future refactor could undo without noticing. So
// the invariant is pinned here rather than left to integration testing.
// =============================================================================

import { describe, expect, it } from "vitest";

import { computeSignature, hashBody } from "../security/requestSignature";
import { isSignedSyncPath, SYNC_MOUNT_PATH } from "../api/sync.routes";

// =============================================================================
// WHICH PATHS MUST BYPASS THE GLOBAL PARSER
// =============================================================================

describe("isSignedSyncPath", () => {
  it("matches the two machine-to-machine endpoints", () => {
    expect(isSignedSyncPath(`${SYNC_MOUNT_PATH}/upload`)).toBe(true);
    expect(isSignedSyncPath(`${SYNC_MOUNT_PATH}/download`)).toBe(true);
  });

  it("does NOT match the operator endpoints", () => {
    // These are ordinary JSON routes behind a staff JWT. Excluding them from
    // the global parser would leave req.body undefined and break the dashboard.
    for (const path of ["/status", "/history", "/queue", "/conflicts", "/run"]) {
      expect(isSignedSyncPath(`${SYNC_MOUNT_PATH}${path}`)).toBe(false);
    }
  });

  it("does not match unrelated routes, or a prefix of the real ones", () => {
    expect(isSignedSyncPath("/api/v1/sales")).toBe(false);
    expect(isSignedSyncPath(SYNC_MOUNT_PATH)).toBe(false);
    expect(isSignedSyncPath("/upload")).toBe(false);
  });
});

// =============================================================================
// WHY IT MATTERS: AN EMPTY BODY IS A DIFFERENT SIGNATURE
// =============================================================================

describe("body hashing", () => {
  const secret = "test-secret-".padEnd(48, "x");

  const inputFor = (body: string) => ({
    deviceId: "till-1",
    timestamp: 1_700_000_000_000,
    nonce: "abcdef0123456789",
    method: "POST",
    path: `${SYNC_MOUNT_PATH}/upload`,
    body,
  });

  it("a dropped body produces a DIFFERENT signature, not a lenient one", () => {
    // This is the whole bug in one assertion: if the raw body is lost, the
    // server computes this second signature and no honest client can match it.
    const real = computeSignature(inputFor(JSON.stringify({ items: [1, 2, 3] })), secret);
    const dropped = computeSignature(inputFor(""), secret);

    expect(real).not.toBe(dropped);
  });

  it("hashes byte-for-byte — re-serialization is not equivalent", () => {
    // Key order survives JSON.parse -> JSON.stringify only by luck, which is
    // why the raw bytes are captured instead of re-serializing req.body.
    expect(hashBody('{"a":1,"b":2}')).not.toBe(hashBody('{"b":2,"a":1}'));
  });

  it("is stable for identical bytes", () => {
    expect(hashBody('{"a":1}')).toBe(hashBody('{"a":1}'));
  });
});
