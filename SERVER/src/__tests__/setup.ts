import { beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../config/prisma";
import { cleanDatabase } from "./utils/db";

/**
 * Global test setup.
 *
 * DATABASE ACCESS IS OPT-IN, per file.
 *
 * This used to connect to Postgres and TRUNCATE 33 tables before EVERY test in
 * EVERY file. That made pure unit tests — engines, utils, formatters, none of
 * which touch a database — fail on a database concern, and on this project they
 * fail hard: `cleanDatabase()` deliberately refuses to run unless DATABASE_URL
 * names a "test" database, and the only database configured here is the live
 * one. So a suite of pure functions could not be run at all.
 *
 * A file that genuinely needs a database now says so:
 *
 *     import { useTestDatabase } from "../__tests__/setup";
 *     useTestDatabase();
 *
 * Everything else runs with no connection, no truncation and no network.
 *
 * The safety guard in utils/db.ts is unchanged and still the last line of
 * defence — this only stops innocent suites from tripping it.
 */

let databaseRequested = false;

/**
 * Whether a database safe to wipe is configured.
 *
 * Integration suites gate themselves on this (`describe.skipIf(!hasTestDatabase())`)
 * so that a checkout without a test database reports them as SKIPPED rather
 * than failed. A red suite that is red for want of infrastructure trains people
 * to ignore red suites; an explicitly skipped one states the gap honestly and
 * still goes green the moment a test database is pointed at.
 *
 * Mirrors the rule in utils/db.ts — keep the two in step.
 */
export function hasTestDatabase(): boolean {
  const url = process.env["DATABASE_URL"] ?? "";
  if (!url) return false;
  const dbName = (url.split("/").pop() ?? "").split("?")[0] ?? "";
  return /test/i.test(dbName) || process.env["ALLOW_DB_WIPE"] === "yes";
}

/**
 * Call at the top level of an integration suite to get a connected, wiped
 * database before each test in that file.
 */
export function useTestDatabase(): void {
  // Without a wipeable database the suite's tests are skipped, so registering
  // hooks that connect and truncate would fail the file anyway.
  if (!hasTestDatabase()) return;

  databaseRequested = true;

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    // Wipe transactional tables before each test for total isolation.
    await cleanDatabase();
  });
}

afterAll(async () => {
  // Only disconnect a connection we actually opened. Calling $disconnect on an
  // unused client is harmless but pointlessly spins up the Prisma engine in
  // every unit-test file.
  if (databaseRequested) {
    await prisma.$disconnect();
  }
});
