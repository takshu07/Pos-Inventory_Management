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

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log:
      process.env["NODE_ENV"] === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
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
