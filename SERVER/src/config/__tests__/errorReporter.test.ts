// =============================================================================
// ERROR REPORTER — regression suite
//
// Two behaviors are pinned here because losing either one silently destroys the
// ability to diagnose production:
//
//   1. The STACK survives. The previous implementation logged only
//      `error.message` in production, so a live 500 was a single line with no
//      stack and no request id. A refactor that "cleans up" the log payload
//      must fail this suite rather than ship.
//   2. A broken external reporter cannot escalate a handled 500 into a crash.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../logger";
import {
  clearErrorReporter,
  registerErrorReporter,
  reportError,
} from "../errorReporter";
import {
  runWithRequestContext,
  setContextActor,
  recordDbTime,
  type RequestContext,
} from "../requestContext";

function makeContext(reqId: string): RequestContext {
  return {
    reqId,
    method: "POST",
    path: "/api/v1/sales",
    dbQueryCount: 0,
    dbTimeMs: 0,
  };
}

describe("errorReporter", () => {
  beforeEach(() => {
    clearErrorReporter();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearErrorReporter();
    vi.restoreAllMocks();
  });

  it("logs the full error object, preserving the stack", () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const error = new Error("checkout exploded");

    reportError(error, 500);

    expect(spy).toHaveBeenCalledTimes(1);
    const [payload] = spy.mock.calls[0] as [Record<string, unknown>, string];

    // `err` must be the Error itself — Pino serializes its stack. Logging
    // `{ message }` instead is the regression this asserts against.
    expect(payload["err"]).toBe(error);
    expect((payload["err"] as Error).stack).toBeDefined();
  });

  it("includes correlation fields when inside a request", () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    const report = runWithRequestContext(makeContext("req-500"), () => {
      setContextActor("emp-7", "CASHIER");
      recordDbTime(15);
      return reportError(new Error("boom"), 500);
    });

    expect(report.reqId).toBe("req-500");
    expect(report.route).toBe("POST /api/v1/sales");
    expect(report.userId).toBe("emp-7");
    expect(report.role).toBe("CASHIER");
    expect(report.dbQueryCount).toBe(1);

    const [payload] = spy.mock.calls[0] as [Record<string, unknown>, string];
    expect(payload["reqId"]).toBe("req-500");
    expect(payload["userId"]).toBe("emp-7");
  });

  it("omits correlation fields outside a request instead of inventing them", () => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);

    const report = reportError(new Error("background job failed"), 500);

    // Absence is meaningful: it says the failure was NOT request-driven.
    expect(report.reqId).toBeUndefined();
    expect(report.route).toBeUndefined();
    expect(report.statusCode).toBe(500);
  });

  it("forwards the error and its report to a registered external reporter", () => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const sink = vi.fn();
    registerErrorReporter(sink);

    const error = new Error("send me");
    runWithRequestContext(makeContext("req-ext"), () => {
      reportError(error, 500);
    });

    expect(sink).toHaveBeenCalledTimes(1);
    const [receivedError, receivedReport] = sink.mock.calls[0] as [
      Error,
      { reqId?: string },
    ];
    expect(receivedError).toBe(error);
    expect(receivedReport.reqId).toBe("req-ext");
  });

  it("does not send to a reporter once it has been cleared", () => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const sink = vi.fn();
    registerErrorReporter(sink);
    clearErrorReporter();

    reportError(new Error("nobody listening"), 500);

    expect(sink).not.toHaveBeenCalled();
  });

  it("survives a reporter that throws, without escalating the original error", () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    registerErrorReporter(() => {
      throw new Error("Sentry is down");
    });

    // The whole point: a broken observability sink must not turn a handled 500
    // into an unhandled exception that takes the process down.
    expect(() => reportError(new Error("original"), 500)).not.toThrow();

    // Both the original error and the reporter's own failure are logged.
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
