// =============================================================================
// CENTRALIZED ERROR REPORTING
//
// The delivered path is the structured log — not a stub
// -----------------------------------------------------
// MODULE_STATUS §5.1 forbids placeholder delivery logic: a channel that reports
// success without delivering is worse than an absent one. That rule applies
// here, so this module does NOT ship an inert "Sentry integration" that
// swallows errors and pretends they were sent.
//
// Instead, reporting IS the structured log. Pino already writes JSON to stdout,
// which in production is collected by the platform's log pipeline — that is a
// real, working delivery path, not a placeholder. What this module adds is
// making every unhandled error arrive there COMPLETE: with its stack, its
// correlation id, and the actor it happened to.
//
// An external reporter (Sentry, Datadog) can be registered at startup via
// `registerErrorReporter`. Until one is, there is no second channel and nothing
// claims there is.
// =============================================================================

import { logger } from "./logger";
import { getRequestContext } from "./requestContext";

export interface ErrorReport {
  /** Correlation id, when the error occurred inside a request. */
  reqId?: string;
  route?: string;
  userId?: string;
  role?: string;
  statusCode: number;
  /** How many SQL statements the failing request had issued before it died. */
  dbQueryCount?: number;
}

/**
 * An external error sink. Receives the error plus its request context.
 *
 * MUST NOT throw and MUST NOT return a promise the caller has to await — the
 * error path is already degraded, and a reporting failure must not turn a
 * handled 500 into a crashed process.
 */
export type ErrorReporter = (error: Error, report: ErrorReport) => void;

let externalReporter: ErrorReporter | null = null;

/**
 * Registers an external error sink. Call once, at startup, before `listen`.
 *
 * Deliberately unregistered by default: with no reporter installed, errors go
 * to the structured log and nothing pretends otherwise (§5.1).
 */
export function registerErrorReporter(reporter: ErrorReporter): void {
  externalReporter = reporter;
}

/** Test seam — drops any registered reporter. */
export function clearErrorReporter(): void {
  externalReporter = null;
}

/**
 * Reports an unhandled error to every configured destination.
 *
 * The structured log always receives it, including in production. The previous
 * implementation logged only `error.message` in production, which meant a live
 * 500 arrived as a single line with no stack and no request id — undiagnosable
 * without reproducing it locally, which for an intermittent checkout failure is
 * exactly what cannot be done. Pino's `redact` config already strips
 * credentials from log output, so the stack is safe to keep.
 */
export function reportError(error: Error, statusCode: number): ErrorReport {
  const context = getRequestContext();

  const report: ErrorReport = {
    statusCode,
    ...(context && {
      reqId: context.reqId,
      route: `${context.method} ${context.path}`,
      dbQueryCount: context.dbQueryCount,
      ...(context.userId !== undefined && { userId: context.userId }),
      ...(context.role !== undefined && { role: context.role }),
    }),
  };

  logger.error({ err: error, ...report }, "Unhandled error");

  if (externalReporter) {
    try {
      externalReporter(error, report);
    } catch (reporterError) {
      // A broken reporter must never escalate the original failure.
      logger.error(
        { err: reporterError },
        "Error reporter threw while reporting an error"
      );
    }
  }

  return report;
}
