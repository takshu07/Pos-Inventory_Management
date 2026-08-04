// =============================================================================
// REQUEST CONTEXT — regression suite
//
// The property that matters here is ISOLATION. AsyncLocalStorage is ambient
// state, and ambient state that leaks between concurrent requests would attach
// one cashier's id to another's log lines — and, worse, would be a tempting
// thing for future code to read as identity. These tests pin the isolation
// guarantee under genuine interleaved concurrency, not just sequential calls.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  getRequestContext,
  getRequestId,
  recordDbTime,
  runWithRequestContext,
  setContextActor,
  type RequestContext,
} from "../requestContext";

function makeContext(reqId: string): RequestContext {
  return {
    reqId,
    method: "GET",
    path: `/${reqId}`,
    dbQueryCount: 0,
    dbTimeMs: 0,
  };
}

describe("requestContext", () => {
  it("returns undefined outside any request", () => {
    expect(getRequestContext()).toBeUndefined();
    expect(getRequestId()).toBeUndefined();
  });

  it("exposes the active context inside the run callback", () => {
    runWithRequestContext(makeContext("req-1"), () => {
      expect(getRequestId()).toBe("req-1");
      expect(getRequestContext()?.path).toBe("/req-1");
    });
  });

  it("propagates across await boundaries", async () => {
    await runWithRequestContext(makeContext("req-async"), async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      // The whole point of AsyncLocalStorage: still visible after the await,
      // several layers deep, without being passed as an argument.
      expect(getRequestId()).toBe("req-async");

      await (async () => {
        await new Promise((resolve) => setImmediate(resolve));
        expect(getRequestId()).toBe("req-async");
      })();
    });
  });

  it("keeps concurrent requests isolated from each other", async () => {
    // Interleaved on purpose: B starts and finishes while A is suspended.
    const observed: string[] = [];

    const requestA = runWithRequestContext(makeContext("A"), async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      observed.push(`A saw ${getRequestId()}`);
      recordDbTime(10);
      return getRequestContext()?.dbQueryCount;
    });

    const requestB = runWithRequestContext(makeContext("B"), async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      observed.push(`B saw ${getRequestId()}`);
      recordDbTime(1);
      recordDbTime(2);
      return getRequestContext()?.dbQueryCount;
    });

    const [countA, countB] = await Promise.all([requestA, requestB]);

    expect(observed).toEqual(["B saw B", "A saw A"]);
    // Each request accumulated only its OWN queries.
    expect(countA).toBe(1);
    expect(countB).toBe(2);
  });

  it("accumulates db time and query count on the active context", () => {
    const context = makeContext("req-db");

    runWithRequestContext(context, () => {
      recordDbTime(12.4);
      recordDbTime(7.6);
    });

    expect(context.dbQueryCount).toBe(2);
    expect(context.dbTimeMs).toBeCloseTo(20, 5);
  });

  it("recordDbTime is a no-op outside a request rather than throwing", () => {
    // Background work (print queue, presence heartbeat) issues queries with no
    // request to attribute them to. That must not crash the query.
    expect(() => recordDbTime(50)).not.toThrow();
  });

  it("setContextActor is a no-op outside a request", () => {
    expect(() => setContextActor("emp-1", "OWNER")).not.toThrow();
  });

  it("attaches the authenticated actor to the active context", () => {
    const context = makeContext("req-actor");

    runWithRequestContext(context, () => {
      setContextActor("emp-42", "MANAGER");
    });

    expect(context.userId).toBe("emp-42");
    expect(context.role).toBe("MANAGER");
  });

  it("leaves the actor absent for anonymous requests", () => {
    const context = makeContext("req-anon");

    runWithRequestContext(context, () => {
      // no setContextActor call — an unauthenticated request
    });

    expect(context.userId).toBeUndefined();
    expect(context.role).toBeUndefined();
  });
});
