import { prisma } from "../../config/prisma";

/**
 * Tables wiped between tests. `settings` is deliberately absent — the
 * ConfigurationEngine reads store timezone, exchange window etc. from it, and
 * several suites depend on those defaults surviving.
 *
 * Physical table names (Prisma @@map), not model names, because this runs as
 * raw SQL.
 */
const TABLES = [
  "audit_logs",
  "employee_actions",
  "login_history",
  "notifications",
  "assets",
  "sale_items",
  "purchase_items",
  "exchange_return_items",
  "exchange_issued_items",
  "inventory_movements",
  "payments",
  "invoices",
  "exchanges",
  "sales",
  "purchases",
  "coupons",
  "promotions",
  "discount_history",
  "discount_rules",
  "cash_transactions",
  "cash_registers",
  "expenses",
  "expense_categories",
  "product_variants",
  "products",
  "categories",
  "brands",
  "sizes",
  "colors",
  "suppliers",
  "customer_addresses",
  "customers",
  "employees",
] as const;

/**
 * Erases all data from transactional tables before each test.
 *
 * Uses a single TRUNCATE ... CASCADE rather than 30-odd deleteMany() calls.
 * Two reasons, both learned the hard way:
 *
 *  - Ordering. Nearly every relation here is onDelete:Restrict, so a sequence of
 *    deletes only works if it is a perfect topological sort of the FK graph. Two
 *    separate edges (inventory_movements→exchanges, cash_registers→employees)
 *    were mis-ordered and aborted the transaction, failing every test in the
 *    suite rather than one. TRUNCATE CASCADE is order-independent, so adding a
 *    Restrict relation to the schema can no longer break the whole suite.
 *
 *  - Speed. Against a REMOTE Neon database each statement pays a network
 *    round-trip; the delete chain took ~40s and blew Prisma's 30s interactive
 *    transaction cap. One statement takes a single round-trip.
 */
export async function cleanDatabase() {
  assertSafeTestDatabase();
  const list = TABLES.map((t) => `"public"."${t}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
}

/**
 * Refuses to truncate anything unless the target database is clearly a test one.
 *
 * This exists because it already went wrong: the suite loads plain
 * `dotenv/config`, there is no .env.test, so DATABASE_URL pointed at the live
 * development database — and a single `npm test` wiped every product, customer
 * and login in it. Nothing about that failure was noisy; it looked like a normal
 * green-ish test run, and the damage only surfaced at the login screen.
 *
 * The opt-in is deliberate. A destructive default that depends on remembering to
 * set an env var is the same trap in a different costume, so a database whose
 * name does not say "test" must be named explicitly via ALLOW_DB_WIPE.
 */
function assertSafeTestDatabase(): void {
  const url = process.env["DATABASE_URL"] ?? "";
  if (!url) throw new Error("DATABASE_URL is not set; refusing to truncate.");

  // Everything after the last "/" and before any "?" is the database name.
  const dbName = (url.split("/").pop() ?? "").split("?")[0] ?? "";
  const looksLikeTest = /test/i.test(dbName);

  if (looksLikeTest || process.env["ALLOW_DB_WIPE"] === "yes") return;

  throw new Error(
    [
      "",
      "  REFUSING TO WIPE DATABASE.",
      "",
      `  DATABASE_URL points at "${dbName}", which is not recognised as a test`,
      "  database. cleanDatabase() TRUNCATEs every table, so running the",
      "  integration suite against it would destroy real data.",
      "",
      "  Fix (pick one):",
      "    • Point DATABASE_URL at a database whose name contains 'test'",
      "      (e.g. add a .env.test and load it in vitest.config.ts).",
      "    • If you really mean to wipe this one, set ALLOW_DB_WIPE=yes.",
      "",
    ].join("\n")
  );
}
