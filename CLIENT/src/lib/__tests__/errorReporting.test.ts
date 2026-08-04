/**
 * Regression tests for the client error-reporting funnel.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `reportClientError` is called from `componentDidCatch` — the one place in the
 * app where throwing is catastrophic. An exception raised while HANDLING an
 * exception escapes the boundary and unmounts the tree, producing the blank
 * screen the boundary exists to prevent. So the contract under test is not
 * "does it report", it is "can it ever throw". The answer must be no, including
 * when the registered sink itself is broken.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearClientErrorReporter,
  registerClientErrorReporter,
  reportClientError,
} from "../errorReporting";

describe("reportClientError", () => {
  beforeEach(() => {
    clearClientErrorReporter();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    clearClientErrorReporter();
    vi.restoreAllMocks();
  });

  it("logs to the console when no sink is registered", () => {
    reportClientError(new Error("widget exploded"));

    expect(console.error).toHaveBeenCalledTimes(1);
    const [tag, payload] = (console.error as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0] as [string, Record<string, unknown>];

    expect(tag).toBe("[ClientError]");
    expect(payload["message"]).toBe("widget exploded");
  });

  it("forwards the error and context to a registered sink", () => {
    const sink = vi.fn();
    registerClientErrorReporter(sink);

    const error = new Error("boom");
    reportClientError(error, {
      boundary: "route",
      requestId: "req-123",
      componentStack: "\n at SalesTable",
    });

    expect(sink).toHaveBeenCalledTimes(1);
    const [receivedError, context] = sink.mock.calls[0] as [
      Error,
      { boundary?: string; requestId?: string },
    ];
    expect(receivedError).toBe(error);
    expect(context.boundary).toBe("route");
    expect(context.requestId).toBe("req-123");
  });

  it("stops forwarding once the sink is cleared", () => {
    const sink = vi.fn();
    registerClientErrorReporter(sink);
    clearClientErrorReporter();

    reportClientError(new Error("nobody listening"));

    expect(sink).not.toHaveBeenCalled();
  });

  it("does not throw when the registered sink throws", () => {
    registerClientErrorReporter(() => {
      throw new Error("Sentry SDK is broken");
    });

    // The contract that matters: a broken reporter cannot escalate into a
    // second exception inside componentDidCatch.
    expect(() => reportClientError(new Error("original"))).not.toThrow();
  });

  it("does not throw when the console itself is unavailable", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console is gone");
    });

    expect(() => reportClientError(new Error("original"))).not.toThrow();
  });

  it("carries the server correlation id through to the sink", () => {
    const sink = vi.fn();
    registerClientErrorReporter(sink);

    reportClientError(new Error("api failed"), { requestId: "abc-def" });

    const [, context] = sink.mock.calls[0] as [Error, { requestId?: string }];
    // This id is what ties the client-side report to the server log line.
    expect(context.requestId).toBe("abc-def");
  });
});
