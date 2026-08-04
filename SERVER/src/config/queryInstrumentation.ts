// =============================================================================
// SQL QUERY INSTRUMENTATION — slow-query detection
//
// Why instrument the pg.Pool rather than Prisma
// ---------------------------------------------
// Two other approaches were considered and rejected:
//
//   1. `prisma.$extends({ query: ... })` — the documented Prisma hook. Rejected
//      because `$extends` returns a DIFFERENT client type, and `config/prisma.ts`
//      exports `prisma` explicitly typed as `PrismaClient`. Every repository in
//      the codebase imports that symbol, so adopting the extended type would
//      ripple through ~100 files — architectural churn this phase must avoid.
//      It also times the Prisma operation, not the statement, so a single
//      `findMany` with relations reports one number for several statements.
//
//   2. `log: [{ emit: "event", level: "query" }]` — emits an event per query,
//      but the serialization cost is paid on EVERY query even when nothing is
//      slow, which is precisely the overhead the previous phase removed.
//
// Instrumenting the pool measures the real thing: one timing per SQL statement
// actually sent over the wire, including statements issued inside interactive
// transactions. `PrismaPg` accepts an existing `pg.Pool`, so this is a
// supported composition rather than a patch — and the exported `prisma` keeps
// its exact `PrismaClient` type, so no consumer changes.
//
// SECURITY: statement TEXT is logged; parameter VALUES never are.
// -----------------------------------------------------------------------------
// pg sends parameterized SQL — the text carries `$1`, `$2` placeholders and the
// values travel separately. Logging `query.text` is therefore safe, while
// logging `query.values` would leak password hashes, customer phone numbers and
// payment amounts into the log aggregator. The values array is deliberately
// never touched here. This is not merely a default; it is the reason this file
// only ever reads `.text`.
// =============================================================================

import pg from "pg";

import { logger } from "./logger";
import { getRequestContext, recordDbTime } from "./requestContext";

/**
 * Statements slower than this are logged at WARN with their SQL text.
 *
 * 300ms is chosen for Neon specifically: every query is a real network
 * round-trip (~15-40ms baseline from us-east-1), so a threshold tuned for a
 * local Postgres would fire constantly and train the team to ignore the log.
 * 300ms is roughly 10x the floor — comfortably "this is doing real work".
 */
const DEFAULT_SLOW_QUERY_MS = 300;

export const SLOW_QUERY_THRESHOLD_MS = Number.parseInt(
  process.env["SLOW_QUERY_THRESHOLD_MS"] ?? String(DEFAULT_SLOW_QUERY_MS),
  10
);

/**
 * Longest SQL text written to a log line. Prisma generates very wide SELECTs
 * (every column, explicitly listed), and an untruncated one can run to several
 * kilobytes — enough to blow up log ingest cost for no diagnostic gain. The
 * leading clause is what identifies the query.
 */
const MAX_SQL_LOG_LENGTH = 500;

function truncateSql(sql: string): string {
  const collapsed = sql.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_SQL_LOG_LENGTH
    ? `${collapsed.slice(0, MAX_SQL_LOG_LENGTH)}…`
    : collapsed;
}

// =============================================================================
// LOG THROTTLING — why a slow-query log MUST be rate limited
//
// Found by this instrumentation on its first run: the print-queue worker polls
// `print_jobs` every 2 seconds forever, whether or not anything is queued. The
// query itself is optimal — `EXPLAIN ANALYZE` reports 0.045ms server-side on a
// Bitmap Index Scan — but the round-trip to Neon measured ~980ms, so EVERY idle
// poll crossed the threshold. In one five-minute run that produced 106 warnings
// from a single harmless statement.
//
// Unthrottled, that behavior makes the slow-query log worse than useless in
// production: it costs money to ingest, and it buries the one genuinely slow
// checkout query under thousands of identical background lines.
//
// Suppression is NOT silence. Each distinct statement logs immediately, then at
// most once per window, and the throttled line carries `occurrences` and
// `maxDurationMs` for the interval — so the signal ("this is slow, this often,
// this badly") survives at a bounded cost.
// =============================================================================

const THROTTLE_WINDOW_MS = Number.parseInt(
  process.env["SLOW_QUERY_LOG_WINDOW_MS"] ?? "60000",
  10
);

/**
 * Cap on tracked statements. Prisma emits a bounded set of query shapes, so
 * this is generous — it exists only so a pathological caller issuing unique SQL
 * (string-concatenated raw queries) cannot grow the map without limit.
 */
const MAX_TRACKED_STATEMENTS = 500;

interface ThrottleEntry {
  lastLoggedAt: number;
  /** Slow occurrences since the last emitted line. */
  suppressed: number;
  /** Worst duration seen since the last emitted line. */
  maxDurationMs: number;
}

const throttleState = new Map<string, ThrottleEntry>();

export interface ThrottleDecision {
  shouldLog: boolean;
  /** Slow occurrences this line accounts for (1 = not throttled). */
  occurrences: number;
  /** Worst duration across those occurrences. */
  maxDurationMs: number;
}

/**
 * Decides whether this slow statement should produce a log line now.
 *
 * Exported for direct unit testing: driving it through a real pg.Pool would
 * require a database, and the throttling rule is the part worth pinning.
 */
export function shouldLogSlowQuery(
  sql: string,
  durationMs: number
): ThrottleDecision {
  const now = Date.now();
  const entry = throttleState.get(sql);

  if (!entry) {
    if (throttleState.size >= MAX_TRACKED_STATEMENTS) {
      // Full: log this one but don't start tracking it, so the map stays
      // bounded. Losing throttling for an unusual statement is a far better
      // failure than unbounded memory growth.
      return { shouldLog: true, occurrences: 1, maxDurationMs: durationMs };
    }

    throttleState.set(sql, {
      lastLoggedAt: now,
      suppressed: 0,
      maxDurationMs: 0,
    });
    return { shouldLog: true, occurrences: 1, maxDurationMs: durationMs };
  }

  if (now - entry.lastLoggedAt >= THROTTLE_WINDOW_MS) {
    const occurrences = entry.suppressed + 1;
    const maxDurationMs = Math.max(entry.maxDurationMs, durationMs);

    entry.lastLoggedAt = now;
    entry.suppressed = 0;
    entry.maxDurationMs = 0;

    return { shouldLog: true, occurrences, maxDurationMs };
  }

  entry.suppressed += 1;
  if (durationMs > entry.maxDurationMs) entry.maxDurationMs = durationMs;

  return { shouldLog: false, occurrences: 0, maxDurationMs: 0 };
}

/** Test seam — clears throttling state between cases. */
export function resetSlowQueryThrottle(): void {
  throttleState.clear();
}

/**
 * Records one statement's duration and logs it if it crossed the threshold.
 * Never throws — instrumentation must not be able to fail a query.
 */
function report(sql: string, durationMs: number): void {
  try {
    recordDbTime(durationMs);

    if (durationMs < SLOW_QUERY_THRESHOLD_MS) return;

    const statement = truncateSql(sql);
    const decision = shouldLogSlowQuery(statement, durationMs);
    if (!decision.shouldLog) return;

    const context = getRequestContext();

    logger.warn(
      {
        durationMs: Math.round(durationMs),
        thresholdMs: SLOW_QUERY_THRESHOLD_MS,
        sql: statement,
        // Present when this statement was slow repeatedly inside the throttle
        // window. `occurrences: 1` means it genuinely happened once.
        ...(decision.occurrences > 1 && {
          occurrences: decision.occurrences,
          windowMs: THROTTLE_WINDOW_MS,
          maxDurationMs: Math.round(decision.maxDurationMs),
        }),
        // Correlation fields — absent for queries outside a request (print
        // queue, heartbeat), which is meaningful information in itself.
        ...(context && {
          reqId: context.reqId,
          route: `${context.method} ${context.path}`,
          ...(context.userId !== undefined && { userId: context.userId }),
        }),
      },
      "Slow SQL query"
    );
  } catch {
    // A logging failure must never surface as a query failure.
  }
}

/**
 * Extracts the SQL text from pg's several accepted `query()` call shapes:
 * a string, a config object, or a prepared-statement/Submittable object.
 * Returns null when the shape is one we can't read, so it is simply not logged.
 */
function extractSql(queryArg: unknown): string | null {
  if (typeof queryArg === "string") return queryArg;

  if (typeof queryArg === "object" && queryArg !== null) {
    const text = (queryArg as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }

  return null;
}

/**
 * Wraps a queryable's `query` method with timing.
 *
 * pg's `query()` supports both a promise and a callback form. We only wrap the
 * promise form — the callback form is detected (last arg is a function) and
 * passed straight through untouched, because timing it would mean wrapping the
 * user's callback and risking a behavior change on a path Prisma does not use.
 */
function instrumentQueryable(target: pg.Pool | pg.PoolClient): void {
  const original = target.query.bind(target) as (
    ...args: unknown[]
  ) => unknown;

  // Marked so a client borrowed twice from the pool isn't wrapped twice —
  // double-wrapping would double-count every statement in the metrics.
  const marker = target as { __posInstrumented?: boolean };
  if (marker.__posInstrumented === true) return;
  marker.__posInstrumented = true;

  (target as { query: unknown }).query = function instrumentedQuery(
    ...args: unknown[]
  ): unknown {
    // Callback form — pass through without timing (see doc comment).
    if (typeof args[args.length - 1] === "function") {
      return original(...args);
    }

    const sql = extractSql(args[0]);
    const start = performance.now();

    let result: unknown;
    try {
      result = original(...args);
    } catch (error) {
      // Synchronous throw (bad arguments) — nothing was executed, so nothing
      // to record.
      throw error;
    }

    if (result instanceof Promise && sql !== null) {
      // A failed query is still time spent waiting on the database, so both
      // outcomes are recorded. The rejection is re-thrown unchanged — this
      // wrapper is strictly an observer.
      return result.then(
        (value) => {
          report(sql, performance.now() - start);
          return value;
        },
        (error: unknown) => {
          report(sql, performance.now() - start);
          throw error;
        }
      );
    }

    return result;
  };
}

/**
 * Creates a `pg.Pool` whose statements are timed for slow-query detection.
 *
 * Both paths a statement can take are instrumented:
 *   • `pool.query(...)`   — one-off statements
 *   • `pool.connect()`    — the borrowed client used for interactive
 *                           transactions (checkout, void, product creation).
 *                           Without wrapping this, every statement inside a
 *                           `$transaction` — the slowest and most important
 *                           code in the system — would be invisible.
 */
export function createInstrumentedPool(config: pg.PoolConfig): pg.Pool {
  const pool = new pg.Pool(config);

  instrumentQueryable(pool);

  const originalConnect = pool.connect.bind(pool);

  (pool as { connect: unknown }).connect = function instrumentedConnect(
    ...args: unknown[]
  ): unknown {
    if (typeof args[0] === "function") {
      // Callback form of connect(): wrap the client before handing it over.
      const callback = args[0] as (
        err: Error | undefined,
        client: pg.PoolClient | undefined,
        done: unknown
      ) => void;

      return (originalConnect as unknown as (cb: typeof callback) => unknown)(
        (err, client, done) => {
          if (client) instrumentQueryable(client);
          callback(err, client, done);
        }
      );
    }

    const result = (
      originalConnect as unknown as (...a: unknown[]) => Promise<pg.PoolClient>
    )(...args);

    return result.then((client) => {
      instrumentQueryable(client);
      return client;
    });
  };

  // A pool-level error (Neon dropping an idle socket) is emitted on the pool,
  // not on any one query. Without a listener, Node treats it as an unhandled
  // 'error' event and CRASHES the process — which is the single most likely way
  // this server dies in production. Logging it lets pg discard the dead client
  // and carry on.
  pool.on("error", (error) => {
    logger.error({ err: error }, "Idle database client error (pool recovered)");
  });

  return pool;
}
