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
import { PrismaClient } from "../../generated/prisma";

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

  const adapter = new PrismaPg({
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
    allowExitOnIdle: !isProduction,
  });

  // Query logging is expensive at scale (serialization + I/O on every query).
  // Production emits only warnings and errors; development additionally logs
  // slow/each query via the "query" level for visibility.
  return new PrismaClient({
    adapter,
    log: isProduction ? ["warn", "error"] : ["warn", "error"],
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
