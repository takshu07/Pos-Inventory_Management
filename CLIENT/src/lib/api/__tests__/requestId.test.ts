/**
 * Regression tests for correlation-id resolution.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This is a transport-layer decision of exactly the kind the client testing
 * policy calls out: nothing crashes when it breaks. If the header name or the
 * precedence silently changes, every error the UI shows simply stops carrying
 * its "Reference:" id — the support path degrades to "an error happened this
 * afternoon" and nobody notices until someone needs to trace a failed sale.
 */

import { describe, expect, it } from "vitest";

import { resolveRequestId } from "../requestId";

describe("resolveRequestId", () => {
  it("reads the lowercase header axios produces", () => {
    expect(resolveRequestId({ "x-request-id": "req-1" }, undefined)).toBe("req-1");
  });

  it("accepts the canonical header casing too", () => {
    expect(resolveRequestId({ "X-Request-Id": "req-2" }, undefined)).toBe("req-2");
  });

  it("falls back to the body when the header did not survive a proxy", () => {
    expect(resolveRequestId({}, { requestId: "req-3" })).toBe("req-3");
  });

  it("prefers the header over the body", () => {
    // The header is present on EVERY response; the body field only on a 500.
    expect(
      resolveRequestId({ "x-request-id": "from-header" }, { requestId: "from-body" })
    ).toBe("from-header");
  });

  it("returns undefined when neither source carries an id", () => {
    expect(resolveRequestId({}, {})).toBeUndefined();
    expect(resolveRequestId(undefined, undefined)).toBeUndefined();
  });

  it("ignores an empty-string header rather than showing a blank reference", () => {
    expect(resolveRequestId({ "x-request-id": "" }, { requestId: "req-4" })).toBe(
      "req-4"
    );
  });

  it("ignores non-string values instead of rendering them", () => {
    // A malformed body must not put "[object Object]" on the user's error screen.
    expect(resolveRequestId({ "x-request-id": 42 }, { requestId: {} })).toBeUndefined();
  });

  it("tolerates a null headers object", () => {
    expect(resolveRequestId(null, { requestId: "req-5" })).toBe("req-5");
  });
});
