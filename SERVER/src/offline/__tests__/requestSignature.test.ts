// =============================================================================
// SYNC REQUEST SIGNING — SECURITY SUITE
//
// ⚠ This is a SECURITY test, not a feature test. It pins the properties that
// make the sync upload endpoint safe to expose, and every case below
// corresponds to a concrete attack rather than to a code path:
//
//   tampered body    rewrite the amounts in a captured upload
//   path swap        replay an upload signature against another endpoint
//   method swap      turn a read into a write
//   stale timestamp  replay a request captured yesterday
//   future dating    mint a signature that never expires
//
// A failure here after a refactor means the refactor is wrong. Do not relax
// these to make a change pass.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  computeSignature,
  generateNonce,
  hashBody,
  signRequest,
  verifyRequest,
} from "../security/requestSignature";

const SECRET = "s".repeat(48);
const TOLERANCE_MS = 5 * 60 * 1000;

const BODY = JSON.stringify({
  items: [{ queueId: 1, entity: "Sale", payload: '{"totalAmount":"199.00"}' }],
});

const REQUEST = {
  deviceId: "till-01",
  method: "POST",
  path: "/api/v1/sync/upload",
  body: BODY,
};

function verify(
  overrides: Partial<{
    headers: Record<string, string>;
    method: string;
    path: string;
    body: string;
    secret: string;
    now: number;
  }> = {}
) {
  const headers = overrides.headers ?? signRequest(REQUEST, SECRET);

  return verifyRequest(
    {
      headers,
      method: overrides.method ?? REQUEST.method,
      path: overrides.path ?? REQUEST.path,
      body: overrides.body ?? REQUEST.body,
    },
    overrides.secret ?? SECRET,
    TOLERANCE_MS,
    overrides.now ?? Date.now()
  );
}

// =============================================================================
// HAPPY PATH
// =============================================================================

describe("signRequest / verifyRequest", () => {
  it("accepts a well-formed request and reports the device", () => {
    const result = verify();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deviceId).toBe("till-01");
  });

  it("emits all four headers", () => {
    const headers = signRequest(REQUEST, SECRET);

    expect(Object.keys(headers).sort()).toEqual([
      "x-sync-device",
      "x-sync-nonce",
      "x-sync-signature",
      "x-sync-timestamp",
    ]);
  });

  it("is deterministic for identical inputs", () => {
    const nonce = generateNonce();
    const input = { ...REQUEST, timestamp: 1_700_000_000_000, nonce };

    expect(computeSignature(input, SECRET)).toBe(computeSignature(input, SECRET));
  });
});

// =============================================================================
// TAMPERING
// =============================================================================

describe("tamper resistance", () => {
  it("rejects a body whose amounts were rewritten in flight", () => {
    const tampered = JSON.stringify({
      items: [{ queueId: 1, entity: "Sale", payload: '{"totalAmount":"1.00"}' }],
    });

    const result = verify({ body: tampered });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("BAD_SIGNATURE");
  });

  it("rejects the same signature replayed against a different path", () => {
    const result = verify({ path: "/api/v1/sync/retry" });

    expect(result.ok).toBe(false);
  });

  it("rejects a path whose query string was altered", () => {
    // The download cursor lives in the query string. Without it in the signed
    // material, a cursor could be rewritten to make a till skip rows.
    const signed = signRequest(
      { ...REQUEST, method: "GET", path: "/api/v1/sync/download?entity=Product&since=A" },
      SECRET
    );

    const result = verifyRequest(
      {
        headers: signed,
        method: "GET",
        path: "/api/v1/sync/download?entity=Product&since=Z",
        body: "",
      },
      SECRET,
      TOLERANCE_MS
    );

    expect(result.ok).toBe(false);
  });

  it("rejects a method swap", () => {
    expect(verify({ method: "GET" }).ok).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verify({ secret: "w".repeat(48) }).ok).toBe(false);
  });

  it("rejects a truncated signature without throwing", () => {
    // timingSafeEqual throws on a length mismatch; the length check must come
    // first or a short signature 500s instead of being refused.
    const headers = signRequest(REQUEST, SECRET);
    headers["x-sync-signature"] = headers["x-sync-signature"].slice(0, 10);

    const result = verify({ headers });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("BAD_SIGNATURE");
  });

  it("rejects a non-hex signature without throwing", () => {
    const headers = signRequest(REQUEST, SECRET);
    headers["x-sync-signature"] = "zzzz";

    expect(() => verify({ headers })).not.toThrow();
    expect(verify({ headers }).ok).toBe(false);
  });
});

// =============================================================================
// FRESHNESS
// =============================================================================

describe("replay window", () => {
  it("rejects a request captured outside the window", () => {
    const headers = signRequest(REQUEST, SECRET, Date.now() - 10 * 60 * 1000);
    const result = verify({ headers });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("EXPIRED");
  });

  it("accepts a request inside the window", () => {
    const headers = signRequest(REQUEST, SECRET, Date.now() - 60 * 1000);

    expect(verify({ headers }).ok).toBe(true);
  });

  it("rejects a far-future timestamp", () => {
    // Without an upper bound, an attacker holding the secret could mint one
    // signature today that stays valid forever. Clock skew needs a window, not
    // a door.
    const headers = signRequest(REQUEST, SECRET, Date.now() + 24 * 3600 * 1000);
    const result = verify({ headers });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("FUTURE_DATED");
  });

  it("tolerates modest clock skew in both directions", () => {
    expect(verify({ headers: signRequest(REQUEST, SECRET, Date.now() + 30_000) }).ok).toBe(true);
    expect(verify({ headers: signRequest(REQUEST, SECRET, Date.now() - 30_000) }).ok).toBe(true);
  });
});

// =============================================================================
// NONCES
// =============================================================================

describe("nonces", () => {
  it("differ between two signings of an identical request", () => {
    // The freshness window alone is not enough: without a per-request nonce, a
    // batch of sales captured and resent inside five minutes would verify.
    const a = signRequest(REQUEST, SECRET);
    const b = signRequest(REQUEST, SECRET);

    expect(a["x-sync-nonce"]).not.toBe(b["x-sync-nonce"]);
  });

  it("produces 128 bits of hex", () => {
    expect(generateNonce()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("binds the nonce into the signature", () => {
    const headers = signRequest(REQUEST, SECRET);
    headers["x-sync-nonce"] = generateNonce();

    expect(verify({ headers }).ok).toBe(false);
  });
});

// =============================================================================
// MALFORMED INPUT
// =============================================================================

describe("malformed requests", () => {
  it.each([
    "x-sync-device",
    "x-sync-timestamp",
    "x-sync-nonce",
    "x-sync-signature",
  ])("rejects a request missing %s", (header) => {
    const headers: Record<string, string> = { ...signRequest(REQUEST, SECRET) };
    delete headers[header];

    const result = verify({ headers });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("MISSING_HEADERS");
  });

  it("rejects a non-numeric timestamp", () => {
    const headers = { ...signRequest(REQUEST, SECRET), "x-sync-timestamp": "yesterday" };
    const result = verify({ headers });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("MALFORMED_TIMESTAMP");
  });
});

// =============================================================================
// BODY HASH
// =============================================================================

describe("hashBody", () => {
  it("is stable and sensitive to a single character", () => {
    expect(hashBody("a")).toBe(hashBody("a"));
    expect(hashBody("a")).not.toBe(hashBody("b"));
  });

  it("distinguishes an empty body from a whitespace body", () => {
    expect(hashBody("")).not.toBe(hashBody(" "));
  });
});
