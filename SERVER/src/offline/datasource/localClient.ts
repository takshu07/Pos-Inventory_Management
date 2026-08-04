// =============================================================================
// LOCAL (SQLite) PRISMA CLIENT
//
// The operational database for an edge node. Same models, same relations, same
// constraints as Neon — generated from the same schema (see
// scripts/generate-local-schema.ts) — so every existing service keeps working
// against it without modification.
//
// ── Why better-sqlite3 ───────────────────────────────────────────────────────
// It is synchronous and in-process. A POS checkout writes a sale, its items,
// its payments and its stock movements in one transaction; against Neon that
// is a string of ~330ms network round trips (the reason the bulk-write pattern
// exists in this codebase at all), and against a local file it is microseconds
// with no round trip to amortize. Synchronous also means a transaction cannot
// interleave with another request's queries, which removes a whole class of
// concurrency bug from the offline path.
//
// ── Durability settings ──────────────────────────────────────────────────────
// The PRAGMAs below are the difference between "we lost the last 40 sales when
// the power went out" and "we lost nothing". They are set on every connection
// and explained individually at the call site.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient as LocalPrismaClient } from "../../../generated/local-prisma";
import { logger } from "../../config/logger";
import { offlineConfig } from "../config";
import { rawSqlBridgeExtension } from "./rawSqlBridge";
import { scalarListBridgeExtension } from "./scalarListBridge";

// =============================================================================
// TYPES
// =============================================================================

/**
 * The local client AFTER the scalar-list bridge is applied.
 *
 * `$extends` returns a structurally different type, so this alias is what the
 * rest of the offline layer should refer to.
 */
export type LocalClient = ReturnType<typeof buildLocalClient>;

// =============================================================================
// CONNECTION SETUP
// =============================================================================

/**
 * PRAGMAs applied to the local database.
 *
 * Ordering matters: `journal_mode` must be set before the first write for WAL
 * to take effect for this connection.
 */
const PRAGMAS: readonly string[] = [
  // ── Write-Ahead Logging ────────────────────────────────────────────────────
  // Readers no longer block the writer and vice versa. On a till this is what
  // lets the sync engine stream the queue out while the cashier keeps ringing
  // up sales on the same file.
  "PRAGMA journal_mode = WAL",

  // ── Durability ─────────────────────────────────────────────────────────────
  // FULL fsyncs the WAL on every commit — the setting that makes "power loss
  // during a sale loses nothing" true. NORMAL is the common recommendation and
  // is roughly 2-3x faster on commit, but it can lose the most recent
  // transactions on an OS crash or power cut. For money that is not a trade
  // worth making; a local fsync is still far cheaper than a network round trip.
  "PRAGMA synchronous = FULL",

  // ── Referential integrity ──────────────────────────────────────────────────
  // SQLite does NOT enforce foreign keys unless asked, per connection. Without
  // this the local database would happily accept a sale_item pointing at a
  // product that does not exist — and the same data would then be rejected by
  // Postgres at upload time, after the customer has left with the goods.
  "PRAGMA foreign_keys = ON",

  // ── Concurrency ────────────────────────────────────────────────────────────
  // Wait rather than immediately returning SQLITE_BUSY when another connection
  // holds the write lock. 5s comfortably covers a sync batch commit.
  "PRAGMA busy_timeout = 5000",

  // ── Performance ────────────────────────────────────────────────────────────
  // 64MB page cache (negative = KiB) and a 256MB mmap window. A full day of
  // sales plus the product catalog fits comfortably, so steady-state reads are
  // served from memory.
  "PRAGMA cache_size = -65536",
  "PRAGMA mmap_size = 268435456",

  // Keep temp b-trees (ORDER BY, GROUP BY in reports) off the disk.
  "PRAGMA temp_store = MEMORY",
];

function openDatabaseFile(databasePath: string): void {
  const directory = path.dirname(databasePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
    logger.info({ directory }, "offline: created local database directory");
  }
}

// =============================================================================
// CLIENT CONSTRUCTION
// =============================================================================

function buildLocalClient(databasePath: string) {
  openDatabaseFile(databasePath);

  const adapter = new PrismaBetterSqlite3({
    url: `file:${databasePath}`,
  });

  const base = new LocalPrismaClient({
    adapter,
    log: ["warn", "error"],
    // Local transactions have no network latency to wait out, so the generous
    // Neon-oriented windows in config/prisma.ts would only mask a real
    // deadlock here. These are still roomy enough for the largest single
    // transaction in the system (product creation with many variants).
    transactionOptions: {
      maxWait: 5000,
      timeout: 15000,
    },
  });

  // Order is not arbitrary. Prisma applies extensions outermost-last, and these
  // two never see the same call: the scalar-list bridge handles MODEL
  // operations, the raw bridge handles $queryRaw/$executeRaw. Keeping them as
  // separate extensions rather than one combined handler means each stays
  // readable and independently testable.
  return base.$extends(scalarListBridgeExtension).$extends(rawSqlBridgeExtension);
}

// =============================================================================
// SINGLETON
//
// Mirrors the globalThis guard in config/prisma.ts: `tsx watch` re-evaluates
// modules on every save, and a fresh better-sqlite3 handle per reload would
// leak file descriptors and eventually collide on the WAL lock.
// =============================================================================

const globalForLocal = globalThis as unknown as {
  offlineLocalClient: LocalClient | undefined;
  offlineLocalPragmasApplied: boolean | undefined;
};

let client: LocalClient | undefined = globalForLocal.offlineLocalClient;

/**
 * Returns the local client, constructing it on first use.
 *
 * Deliberately lazy: a cloud-role deployment must never open a SQLite file, and
 * importing this module must stay free of side effects so that the existing
 * test suite — which does not know the offline layer exists — is unaffected.
 */
export function getLocalClient(): LocalClient {
  if (client === undefined) {
    const { localDatabasePath } = offlineConfig();
    client = buildLocalClient(localDatabasePath);

    if (process.env["NODE_ENV"] !== "production") {
      globalForLocal.offlineLocalClient = client;
    }

    logger.info({ path: localDatabasePath }, "offline: local SQLite client initialized");
  }

  return client;
}

/** True when the local client has been constructed in this process. */
export function isLocalClientInitialized(): boolean {
  return client !== undefined;
}

/**
 * Applies the connection PRAGMAs and verifies the mirror is actually present.
 *
 * Called once from `initializeOfflineRuntime()` at boot rather than lazily,
 * because a missing local schema must fail at startup — discovering it on the
 * first sale of the day is far more expensive.
 */
export async function prepareLocalDatabase(): Promise<void> {
  const local = getLocalClient();

  if (globalForLocal.offlineLocalPragmasApplied !== true) {
    for (const pragma of PRAGMAS) {
      await local.$executeRawUnsafe(pragma);
    }
    globalForLocal.offlineLocalPragmasApplied = true;
  }

  // Prove the mirror was pushed. `sync_queue` is the last table the generator
  // appends, so its presence means the whole schema landed.
  const presence = await local.$queryRawUnsafe<Array<{ present: number | bigint }>>(
    "SELECT COUNT(*) AS present FROM sqlite_master WHERE type='table' AND name='sync_queue'"
  );

  if (Number(presence[0]?.present ?? 0) === 0) {
    throw new Error(
      "The local SQLite mirror has no sync_queue table — the schema was never " +
        "pushed. Run: npm run db:local:setup"
    );
  }

  // ── Verify the per-connection PRAGMAs actually took ───────────────────────
  // `foreign_keys` and `synchronous` are per-CONNECTION settings, not stored in
  // the database file, so a driver that silently opened a second connection (or
  // ran the PRAGMA inside an implicit transaction, where SQLite ignores it)
  // would leave the till running without referential integrity and without
  // durable commits — both silent until the day they cost money.
  //
  // A PRAGMA read returns a column named after the pragma itself, so the value
  // is taken positionally rather than by a guessed property name.
  const readPragma = async (pragma: string): Promise<string> => {
    const rows = await local.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `PRAGMA ${pragma}`
    );
    return String(Object.values(rows[0] ?? {})[0] ?? "");
  };

  const [journalMode, foreignKeys, synchronous] = await Promise.all([
    readPragma("journal_mode"),
    readPragma("foreign_keys"),
    readPragma("synchronous"),
  ]);

  if (foreignKeys !== "1") {
    throw new Error(
      "Local SQLite refused PRAGMA foreign_keys=ON. Refusing to serve: without " +
        "it the local database accepts orphan rows that Postgres will reject at " +
        "upload time, after the goods have left the store."
    );
  }

  logger.info(
    {
      journalMode,
      foreignKeys: true,
      // 2 === FULL. Anything lower can lose committed sales on power loss.
      synchronous,
      durable: synchronous === "2",
    },
    "offline: local database ready"
  );
}

/** Closes the local client. Called from the server's shutdown handler. */
export async function closeLocalClient(): Promise<void> {
  if (client === undefined) return;

  const closing = client;
  client = undefined;
  globalForLocal.offlineLocalClient = undefined;
  globalForLocal.offlineLocalPragmasApplied = undefined;

  await closing.$disconnect();
}

/**
 * Test seam: points the singleton at a specific database file.
 *
 * Integration tests build a throwaway mirror per suite; without this they would
 * share the developer's real local database.
 */
export function __setLocalClientForTesting(databasePath: string): LocalClient {
  client = buildLocalClient(databasePath);
  globalForLocal.offlineLocalClient = undefined;
  globalForLocal.offlineLocalPragmasApplied = undefined;
  return client;
}
