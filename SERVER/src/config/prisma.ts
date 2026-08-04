// =============================================================================
// PRISMA CLIENT SINGLETON WITH pg ADAPTER
//
// Prisma v7 ships with the "client" engine type which requires an explicit
// database adapter (driver adapter pattern). This replaces the old "binary"
// and "library" engines. The adapter wraps a native `pg.Pool` and passes it
// to PrismaClient — this is the production-correct approach for Prisma 7+.
//
// Why @prisma/adapter-pg?
// -----------------------
// 1. Reuses a single pg.Pool across the process → avoids connection exhaustion
// 2. Neon serverless-compatible (the pooler URL is used automatically)
// 3. Type-safe integration via the official Prisma adapter interface
//
// Why a singleton?
// ----------------
// In development with tsx watch, modules are re-evaluated on every file change.
// Without the globalThis guard, a new PrismaClient (and pg.Pool) would be
// created on every reload — old connections are never closed, exhausting the
// Neon serverless connection limit quickly. Storing on globalThis survives
// module re-evaluation within the same process.
//
// In production, each process gets exactly one client and one pool.
// =============================================================================

import { PrismaPg } from "@prisma/adapter-pg";
import type pg from "pg";

import { PrismaClient } from "../../generated/prisma";
import { createInstrumentedPool } from "./queryInstrumentation";

// =============================================================================
// STARTUP ENVIRONMENT VALIDATION
// Called in server.ts BEFORE app.listen() — fail-fast prevents a server start
// with broken configuration.
// =============================================================================

const REQUIRED_ENV_VARS = ["DATABASE_URL", "JWT_SECRET"] as const;

export function validateEnvironment(): void {
  const missing = REQUIRED_ENV_VARS.filter(
    (key) => !process.env[key]?.trim()
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Server cannot start without them."
    );
  }
}

// =============================================================================
// PRISMA CLIENT FACTORY
// =============================================================================

/**
 * The pg.Pool backing the Prisma adapter.
 *
 * Held at module scope because passing an EXTERNAL pool to `PrismaPg` makes
 * this module its owner: `prisma.$disconnect()` releases Prisma's handle but
 * does not end a pool it did not create, so shutdown must close it explicitly.
 * See `closeDatabasePool()`.
 */
let pool: pg.Pool | undefined;

function createPrismaClient(): PrismaClient {
  const connectionString = process.env["DATABASE_URL"];

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Cannot initialize Prisma client."
    );
  }

  const isProduction = process.env["NODE_ENV"] === "production";

  // ===========================================================================
  // CONNECTION POOL TUNING (Neon serverless)
  // ---------------------------------------------------------------------------
  // The pg.Pool sits between this process and Neon's pooler endpoint. Neon caps
  // the number of simultaneous connections, so an unbounded pool (pg's default
  // max is 10, but multiple app instances multiply that) can exhaust Neon and
  // cause "remaining connection slots are reserved" errors under load.
  //
  //  - max                       Upper bound on concurrent connections THIS
  //                              process holds. Kept modest so N app instances
  //                              stay within Neon's ceiling. Override per
  //                              deployment via DB_POOL_MAX.
  //  - idleTimeoutMillis         Return idle connections to Neon promptly.
  //                              Neon bills/limits by active connection, so we
  //                              don't want to hoard idle sockets.
  //  - connectionTimeoutMillis   Fail fast instead of hanging a request for the
  //                              default (no timeout) when the pool is saturated.
  //  - allowExitOnIdle           Lets the process exit cleanly in dev/tests
  //                              when all connections are idle.
  //
  // These values only change pool *management* — they never alter query
  // results or business behavior.
  // ===========================================================================
  const poolMax = Number.parseInt(
    process.env["DB_POOL_MAX"] ?? (isProduction ? "10" : "5"),
    10
  );

  // The pool is created HERE rather than letting PrismaPg build it from a
  // config object, so every statement passes through the slow-query
  // instrumentation (see queryInstrumentation.ts). PrismaPg accepts an existing
  // pg.Pool, so this changes nothing about how queries execute — only that they
  // are timed. Pool options below are unchanged from the tuned values.
  pool = createInstrumentedPool({
    connectionString,
    max: poolMax,
    idleTimeoutMillis: Number.parseInt(
      process.env["DB_POOL_IDLE_TIMEOUT_MS"] ?? "10000",
      10
    ),
    connectionTimeoutMillis: Number.parseInt(
      process.env["DB_POOL_CONNECT_TIMEOUT_MS"] ?? "10000",
      10
    ),
    // ── Neon serverless resilience ───────────────────────────────────────────
    // Neon (and its pooler) silently drops idle server connections. A long-lived
    // pg.Pool can otherwise keep handing out dead sockets, which surfaces as
    // "Unable to start a transaction in the given time" on the NEXT request that
    // needs a connection — every $transaction call then 500s until restart.
    //   • maxLifetimeSeconds  Proactively retire each connection after a bounded
    //                         lifetime so a socket is never reused long enough to
    //                         go stale on Neon's side.
    //   • keepAlive           Send TCP keep-alives so idle-but-live sockets don't
    //                         get reaped by intermediate NAT/idle timeouts.
    maxLifetimeSeconds: Number.parseInt(
      process.env["DB_POOL_MAX_LIFETIME_S"] ?? "300",
      10
    ),
    keepAlive: true,
    allowExitOnIdle: !isProduction,
  });

  const adapter = new PrismaPg(pool);

  // Query logging is expensive at scale (serialization + I/O on every query).
  // Production emits only warnings and errors; development additionally logs
  // slow/each query via the "query" level for visibility.
  return new PrismaClient({
    adapter,
    log: isProduction ? ["warn", "error"] : ["warn", "error"],
    // ── Transaction acquisition tuning (Neon serverless) ─────────────────────
    // Prisma's default maxWait to ACQUIRE a connection for a $transaction is
    // 2000ms. Against Neon that's too tight: a cold connection must complete a
    // TLS + channel_binding handshake (and Neon may cold-start the compute),
    // which regularly exceeds 2s — surfacing as "Unable to start a transaction
    // in the given time" and a 500 on every transactional endpoint. We give the
    // client a realistic window to obtain a connection, and a generous per-
    // transaction timeout so the multi-step product-creation transaction (many
    // variants + opening-stock movements) can complete.
    transactionOptions: {
      maxWait: Number.parseInt(process.env["DB_TX_MAX_WAIT_MS"] ?? "15000", 10),
      timeout: Number.parseInt(process.env["DB_TX_TIMEOUT_MS"] ?? "30000", 10),
    },
  });
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Ends the underlying pg.Pool.
 *
 * `prisma.$disconnect()` is not sufficient on its own here: because we hand
 * `PrismaPg` a pool we constructed, Prisma treats it as externally owned and
 * leaves it open. Without this call, shutdown would close Prisma's handle while
 * leaving TCP connections established against Neon until the process was killed
 * — which, on a rolling deploy, holds connection slots the NEW instance needs.
 *
 * Safe to call when no pool was ever created (unit tests that never touch the
 * database), and safe to call twice.
 */
export async function closeDatabasePool(): Promise<void> {
  if (!pool) return;

  const closing = pool;
  pool = undefined;
  await closing.end();
}
