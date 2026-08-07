/**
 * @file lib/errorReporting.ts
 *
 * Purpose: one funnel for client-side errors that reach an error boundary.
 *
 * Why this exists
 * ---------------
 * The boundary previously called `console.error` directly, which means a crash
 * on a cashier's terminal exists only in a devtools console nobody has open.
 * Routing through one function gives a single place to install a real sink
 * (Sentry, Datadog RUM) at startup.
 *
 * No placeholder delivery
 * -----------------------
 * MODULE_STATUS §5.1 forbids stubs that report success without delivering.
 * There is deliberately no built-in "remote reporting" here that quietly
 * discards errors: until a sink is registered, the console IS the destination,
 * and nothing claims otherwise.
 *
 * Deliberately NOT auto-posting to our own API: a render loop that throws on
 * every frame would turn one broken widget into a self-inflicted flood against
 * the same server the store is trying to sell on.
 */

export interface ClientErrorContext {
  /** React component stack from `componentDidCatch`. */
  componentStack?: string | undefined;
  /** Which boundary caught it — "app" or a route label. */
  boundary?: string | undefined;
  /** Server correlation id, when the error originated from an API call. */
  requestId?: string | undefined;
  /**
   * True when the failure was a rejected dynamic `import()` rather than an
   * application throw.
   *
   * Worth separating in the logs: a cluster of these means clients are running
   * against chunk names a deploy has already removed — an infrastructure signal
   * (roll forward, or serve old chunks through the transition), not a code bug
   * to go hunting for.
   */
  isChunkError?: boolean | undefined;
  /** HTTP status, when the router surfaced an ErrorResponse from a loader. */
  status?: number | undefined;
}

export type ClientErrorReporter = (
  error: Error,
  context: ClientErrorContext
) => void;

let reporter: ClientErrorReporter | null = null;

/**
 * Installs an external error sink. Call once during bootstrap.
 * Until called, errors go to the console only.
 */
export function registerClientErrorReporter(next: ClientErrorReporter): void {
  reporter = next;
}

/** Test seam — removes any registered sink. */
export function clearClientErrorReporter(): void {
  reporter = null;
}

/**
 * Reports a client error to the console and to any registered sink.
 *
 * Never throws: this runs from `componentDidCatch`, and an exception raised
 * while handling an exception would escape the boundary and blank the screen —
 * precisely the outcome the boundary exists to prevent.
 */
export function reportClientError(
  error: Error,
  context: ClientErrorContext = {}
): void {
  try {
    console.error("[ClientError]", {
      message: error.message,
      boundary: context.boundary,
      requestId: context.requestId,
      // Omitted unless set, so the common case reads exactly as before.
      ...(context.isChunkError !== undefined && { isChunkError: context.isChunkError }),
      ...(context.status !== undefined && { status: context.status }),
      stack: error.stack,
      componentStack: context.componentStack,
    });
  } catch {
    // Console unavailable — nothing further to do.
  }

  if (!reporter) return;

  try {
    reporter(error, context);
  } catch {
    // A broken reporter must not escalate the error it was asked to report.
  }
}
