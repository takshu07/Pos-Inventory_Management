// =============================================================================
// REQUEST CONTEXT (AsyncLocalStorage)
//
// The problem this solves
// -----------------------
// `app.ts` mints a `reqId` per request and returns it as `X-Request-Id`, but
// nothing below the middleware could SEE it. A repository logging a slow query,
// or the global error handler logging a 500, had no way to say WHICH request it
// belonged to — so a user reporting "it failed at 2:41pm" could not be tied to
// the log line that explains it. Threading a `reqId` parameter through
// Routes → Controllers → Services → Engines → Repositories would mean touching
// every signature in the codebase, which is exactly the kind of architectural
// churn this phase must avoid.
//
// AsyncLocalStorage gives us ambient, per-request state instead: the value is
// bound to the async execution chain, so any code awaited (however deep) inside
// `runWithRequestContext` reads the same object without being handed it.
//
// What is deliberately NOT in here
// --------------------------------
// This is observability metadata only — never authorization state. `req.user`
// remains the single source of truth for who the caller is; `userId` is
// duplicated here purely so log lines can be grouped by actor. Nothing may make
// an access-control decision from this store, because a missing context (a
// background job, the print queue, a test) must never read as "authorized".
//
// Cost: AsyncLocalStorage on modern Node is a few hundred nanoseconds per
// request — immaterial next to a Neon round-trip.
// =============================================================================

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  /** Correlation id, also returned to the client as the `X-Request-Id` header. */
  readonly reqId: string;
  readonly method: string;
  readonly path: string;
  /** Populated after `authenticate` runs; absent for anonymous requests. */
  userId?: string;
  role?: string;
  /** Number of SQL statements this request has issued (see queryInstrumentation). */
  dbQueryCount: number;
  /** Cumulative milliseconds this request has spent waiting on SQL. */
  dbTimeMs: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with `context` bound to the current async execution chain.
 * Everything awaited inside — however deep — sees the same context object.
 */
export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T
): T {
  return storage.run(context, fn);
}

/**
 * The active request's context, or `undefined` outside a request.
 *
 * `undefined` is a normal, expected result — the print queue worker, the
 * presence heartbeat and unit tests all run outside any request. Callers must
 * treat it as optional metadata and never as a failure.
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Convenience accessor for the correlation id alone. */
export function getRequestId(): string | undefined {
  return storage.getStore()?.reqId;
}

/**
 * Records one SQL statement against the active request.
 *
 * Called by the instrumented pg pool. A no-op outside a request context, so
 * background queries are timed for the slow-query log without needing a
 * request to attribute them to.
 */
export function recordDbTime(durationMs: number): void {
  const context = storage.getStore();
  if (!context) return;

  context.dbQueryCount += 1;
  context.dbTimeMs += durationMs;
}

/**
 * Attaches the authenticated actor to the active request's log context.
 * Called from `authenticate` once the token has been verified.
 */
export function setContextActor(userId: string, role: string): void {
  const context = storage.getStore();
  if (!context) return;

  context.userId = userId;
  context.role = role;
}
