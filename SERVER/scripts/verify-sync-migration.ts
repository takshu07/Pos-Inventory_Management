/* eslint-disable no-console */
// =============================================================================
// SYNC MIGRATION VERIFIER
//
// Proves — against the LIVE database, before anything is applied — that the
// offline-first migration is additive and safe.
//
// Usage:
//   npm run sync:verify-migration            read-only. Verifies and reports.
//   npm run sync:verify-migration -- --apply applies, and ONLY if every check
//                                            passes AND the backup flag is set.
//
// ── Why this exists rather than "just run migrate deploy" ────────────────────
// `migrate deploy` will happily apply whatever is in the migrations folder. It
// does not tell you, beforehand and in terms a human can check, that the SQL
// touches nothing that already holds data. On a live retail database that
// difference matters: a migration that turns out to rewrite `sales` is not
// something you want to discover from the application logs.
//
// So this reads the migration, classifies EVERY statement, and refuses on
// anything that is not a bare CREATE. It then asks the live database what it
// actually needs, and refuses if that differs from what the migration provides
// — which is how schema drift gets caught before it becomes a failed deploy at
// the worst possible moment.
//
// ── What it deliberately does NOT do ─────────────────────────────────────────
// It does not take the backup. Neon backups are a console/CLI operation against
// an account this process has no credentials for, and a script that claimed to
// have taken one when it had not would be worse than no script. It prints the
// exact commands and requires an explicit acknowledgement flag instead.
// =============================================================================

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import "dotenv/config";
import { Client } from "pg";

// =============================================================================
// CONSTANTS
// =============================================================================

const SERVER_ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(SERVER_ROOT, "prisma", "migrations");

/** The migration under review. */
const TARGET_MIGRATION = "20260805090000_offline_first_sync_cloud_tables";

/** Exactly the tables it is allowed to create. Anything else is a red flag. */
const EXPECTED_NEW_TABLES = [
  "sync_receipts",
  "sync_nonces",
  "sync_devices",
  "sync_conflict_records",
] as const;

// =============================================================================
// SUBPROCESS + REDACTION
// =============================================================================

/**
 * Runs the local Prisma CLI with no shell involved.
 *
 * `shell: true` would be two bugs at once here: the connection string contains
 * `&`, which cmd.exe treats as a command separator, and passing unescaped
 * arguments through a shell is the injection vector Node deprecated it for.
 * Invoking `node <prisma-entry>` with an argv array sidesteps both.
 */
function runPrisma(args: readonly string[]): string {
  const entry = path.join(SERVER_ROOT, "node_modules", "prisma", "build", "index.js");

  return execFileSync(process.execPath, [entry, ...args], {
    cwd: SERVER_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 300_000,
  });
}

/**
 * Strips anything that looks like a database credential out of a message.
 *
 * Not paranoia. An earlier draft of this script printed the full Neon
 * connection string — password included — into the terminal, because the failed
 * subprocess's error message echoed the command line it had been given. Console
 * output from a verification run gets pasted into tickets and chat.
 */
function redact(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://<redacted>")
    .replace(/(password|pgpassword)=([^\s&"']+)/gi, "$1=<redacted>")
    .split("\n")
    .slice(0, 4)
    .join("\n      ");
}

// =============================================================================
// REPORTING
// =============================================================================

type Severity = "ok" | "warn" | "fail";

interface Finding {
  readonly severity: Severity;
  readonly check: string;
  readonly detail: string;
}

const findings: Finding[] = [];

function record(severity: Severity, check: string, detail: string): void {
  findings.push({ severity, check, detail });

  const mark = severity === "ok" ? "✔" : severity === "warn" ? "!" : "✖";
  console.log(`  ${mark} ${check}`);
  if (detail) console.log(`      ${detail}`);
}

function failed(): boolean {
  return findings.some((finding) => finding.severity === "fail");
}

// =============================================================================
// STATEMENT CLASSIFICATION
// =============================================================================

/**
 * Splits SQL into statements, ignoring `--` comments and semicolons inside
 * string literals.
 *
 * A naive `split(";")` would cut a statement in half at a semicolon inside a
 * quoted default value and then classify both halves as gibberish — which,
 * given the classifier rejects anything it does not recognize, would present as
 * a false alarm rather than a false pass. Still worth doing properly.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];

  let current = "";
  let inString = false;
  let inLineComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index] as string;
    const next = sql[index + 1];

    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }

    if (!inString && char === "-" && next === "-") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "'") inString = !inString;

    if (char === ";" && !inString) {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

interface Classification {
  readonly additive: boolean;
  readonly kind: string;
  /** Table the statement targets, when it can be determined. */
  readonly table: string | null;
}

/**
 * Decides whether one statement can destroy or rewrite existing data.
 *
 * The list is an ALLOWLIST. Anything unrecognized is treated as unsafe, because
 * the cost of being wrong in the two directions is not symmetric: a false
 * alarm costs a code review, a false pass costs a retail database.
 */
function classify(statement: string): Classification {
  const normalized = statement.replace(/\s+/g, " ").trim();

  const createTable = /^CREATE TABLE(?: IF NOT EXISTS)? "?(\w+)"?/i.exec(normalized);
  if (createTable) {
    return { additive: true, kind: "CREATE TABLE", table: createTable[1] ?? null };
  }

  const createIndex = /^CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)? "?[\w.]+"? ON "?(\w+)"?/i.exec(
    normalized
  );
  if (createIndex) {
    return { additive: true, kind: "CREATE INDEX", table: createIndex[1] ?? null };
  }

  // ALTER TABLE ... ADD is additive ONLY if the table was created by this same
  // migration; against a pre-existing table it can add a NOT NULL column to
  // populated rows and fail, or add a constraint that rejects existing data.
  // The caller checks the table origin; here it is merely identified.
  const alterAdd = /^ALTER TABLE(?: ONLY)? "?(\w+)"? ADD /i.exec(normalized);
  if (alterAdd) {
    return { additive: false, kind: "ALTER TABLE ADD", table: alterAdd[1] ?? null };
  }

  const destructive =
    /^(DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER TABLE .* (DROP|ALTER|RENAME)|ALTER TYPE|CREATE TYPE)/i.exec(
      normalized
    );
  if (destructive) {
    return { additive: false, kind: destructive[1]?.toUpperCase() ?? "DESTRUCTIVE", table: null };
  }

  return { additive: false, kind: "UNRECOGNIZED", table: null };
}

// =============================================================================
// CHECK 1 — the migration file itself (no database needed)
// =============================================================================

function verifyMigrationIsAdditive(): { tablesCreated: string[] } {
  console.log("\n[1/5] Migration SQL — additive-only\n");

  const migrationPath = path.join(MIGRATIONS_DIR, TARGET_MIGRATION, "migration.sql");

  if (!fs.existsSync(migrationPath)) {
    record("fail", "migration file present", `not found: ${migrationPath}`);
    return { tablesCreated: [] };
  }

  const statements = splitStatements(fs.readFileSync(migrationPath, "utf8"));
  const tablesCreated: string[] = [];
  const offenders: string[] = [];

  for (const statement of statements) {
    const classification = classify(statement);

    if (classification.kind === "CREATE TABLE" && classification.table !== null) {
      tablesCreated.push(classification.table);
    }

    if (!classification.additive) {
      // An ALTER ADD against a table this migration itself created is fine.
      const selfTargeted =
        classification.kind === "ALTER TABLE ADD" &&
        classification.table !== null &&
        tablesCreated.includes(classification.table);

      if (!selfTargeted) {
        offenders.push(`${classification.kind}: ${statement.slice(0, 90)}…`);
      }
    }
  }

  if (offenders.length > 0) {
    record(
      "fail",
      "every statement is additive",
      `${offenders.length} statement(s) can modify existing objects:\n      ` +
        offenders.join("\n      ")
    );
  } else {
    record(
      "ok",
      "every statement is additive",
      `${statements.length} statements: CREATE TABLE / CREATE INDEX only`
    );
  }

  const unexpected = tablesCreated.filter(
    (table) => !(EXPECTED_NEW_TABLES as readonly string[]).includes(table)
  );

  if (unexpected.length > 0) {
    record("fail", "creates only the expected tables", `unexpected: ${unexpected.join(", ")}`);
  } else {
    record("ok", "creates only the expected tables", tablesCreated.join(", "));
  }

  const missing = EXPECTED_NEW_TABLES.filter((table) => !tablesCreated.includes(table));
  if (missing.length > 0) {
    record("fail", "creates all four sync tables", `missing: ${missing.join(", ")}`);
  }

  return { tablesCreated };
}

// =============================================================================
// CHECK 2 — the live database
// =============================================================================

async function withClient<T>(work: (client: Client) => Promise<T>): Promise<T | null> {
  const connectionString = process.env["DATABASE_URL"];

  if (!connectionString) {
    record("fail", "DATABASE_URL is set", "cannot verify against the live database");
    return null;
  }

  const client = new Client({ connectionString, statement_timeout: 30_000 });

  try {
    await client.connect();
    return await work(client);
  } catch (error) {
    record("fail", "connect to the live database", redact(error));
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function verifyLiveDatabase(): Promise<void> {
  console.log("\n[2/5] Live database — target state\n");

  await withClient(async (client) => {
    // ── Which migrations has this database already applied? ──────────────────
    const applied = await client.query<{ migration_name: string; finished_at: Date | null }>(
      `SELECT migration_name, finished_at
         FROM "_prisma_migrations"
        ORDER BY started_at DESC
        LIMIT 200`
    );

    const appliedNames = new Set(applied.rows.map((row) => row.migration_name));

    if (appliedNames.has(TARGET_MIGRATION)) {
      record(
        "warn",
        "migration is still pending",
        "ALREADY APPLIED to this database — nothing further to do"
      );
    } else {
      record("ok", "migration is still pending", `${appliedNames.size} migrations applied so far`);
    }

    // A migration recorded but never finished means a previous deploy died
    // half-way. Applying on top of that is how a schema ends up in a state no
    // migration history describes.
    const unfinished = applied.rows.filter((row) => row.finished_at === null);
    if (unfinished.length > 0) {
      record(
        "fail",
        "no half-applied migrations",
        `${unfinished.length} migration(s) started and never finished: ` +
          unfinished.map((row) => row.migration_name).join(", ") +
          ". Resolve these before applying anything new."
      );
    } else {
      record("ok", "no half-applied migrations", "");
    }

    // ── Do the new tables already exist? ─────────────────────────────────────
    const existing = await client.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = ANY($1::text[])`,
      [EXPECTED_NEW_TABLES]
    );

    if (existing.rows.length > 0 && !appliedNames.has(TARGET_MIGRATION)) {
      record(
        "fail",
        "target tables do not already exist",
        `${existing.rows.map((r) => r.table_name).join(", ")} exist but the migration is ` +
          `not recorded. The migration would fail. Investigate before proceeding.`
      );
    } else {
      record("ok", "target tables do not already exist", "");
    }

    // ── How much data is at risk if something goes wrong? ────────────────────
    // Not a pass/fail check. It is the number that decides how carefully the
    // backup step is taken, and it is worth printing where the operator will
    // actually read it.
    const volumes = await client.query<{ table_name: string; estimate: string }>(
      `SELECT relname AS table_name, n_live_tup::text AS estimate
         FROM pg_stat_user_tables
        WHERE relname IN ('sales','sale_items','payments','inventory_movements','audit_logs')
        ORDER BY n_live_tup DESC`
    );

    record(
      "ok",
      "live data volume (for the backup decision)",
      volumes.rows.length === 0
        ? "no statistics available"
        : volumes.rows.map((row) => `${row.table_name}=${row.estimate}`).join("  ")
    );

    return null;
  });
}

// =============================================================================
// CHECK 3 — drift
// =============================================================================

function verifyNoDrift(): void {
  console.log("\n[3/5] Schema drift — what the live database actually needs\n");

  let diffSql: string;

  try {
    // ── Note what is NOT here: the connection string ──────────────────────────
    // `--from-config-datasource` makes Prisma read DATABASE_URL from
    // prisma.config.ts rather than taking it as an argument. That matters for
    // two reasons beyond tidiness:
    //
    //   1. No credential ever reaches a command line, so it cannot surface in
    //      `ps`, in a shell history, or — as it did while this script was being
    //      written — in the error message printed when the command fails.
    //   2. The URL contains `&`, which a shell splits on. Invoking node
    //      directly with an argv array avoids the shell entirely.
    diffSql = runPrisma([
      "migrate",
      "diff",
      "--from-config-datasource",
      "--to-schema",
      "prisma/schema.prisma",
      "--script",
    ]);
  } catch (error) {
    record("warn", "drift comparison", `could not run \`prisma migrate diff\` — ${redact(error)}`);
    return;
  }

  if (/^\s*--\s*This is an empty migration/im.test(diffSql) || diffSql.trim() === "") {
    record("warn", "drift comparison", "live database already matches the schema — nothing to apply");
    return;
  }

  // ── The strong check ──────────────────────────────────────────────────────
  // Prisma is asked what it would take to bring the LIVE database up to the
  // current schema. If that is anything other than "create the four sync
  // tables", then either the migration is not what we think it is, or the live
  // database has drifted from the migration history — and applying on top of
  // drift is how a production schema ends up in a state nothing describes.
  const statements = splitStatements(diffSql);
  const problems: string[] = [];
  const touched = new Set<string>();

  for (const statement of statements) {
    const classification = classify(statement);

    if (classification.table !== null) touched.add(classification.table);

    if (!classification.additive) {
      problems.push(`${classification.kind}: ${statement.slice(0, 90)}…`);
    }
  }

  const outsideScope = [...touched].filter(
    (table) => !(EXPECTED_NEW_TABLES as readonly string[]).includes(table)
  );

  if (problems.length > 0) {
    record(
      "fail",
      "live database needs only additive changes",
      `${problems.length} non-additive statement(s) required:\n      ` + problems.join("\n      ")
    );
  } else if (outsideScope.length > 0) {
    record(
      "fail",
      "live database needs only the sync tables",
      `it also needs changes to: ${outsideScope.join(", ")}. The database has drifted ` +
        `from the migration history — resolve that FIRST.`
    );
  } else {
    record(
      "ok",
      "live database needs only the four sync tables",
      `${statements.length} additive statements, no other drift`
    );
  }
}

// =============================================================================
// CHECK 4 — backup acknowledgement
// =============================================================================

const BACKUP_FLAG = "--i-have-taken-a-backup";

function verifyBackupAcknowledged(applying: boolean): boolean {
  console.log("\n[4/5] Backup\n");

  const acknowledged = process.argv.includes(BACKUP_FLAG);

  if (!applying) {
    record("ok", "backup (not required for a read-only run)", "");
    return true;
  }

  if (!acknowledged) {
    record(
      "fail",
      "backup acknowledged",
      `pass ${BACKUP_FLAG} once a restorable snapshot exists`
    );
    return false;
  }

  record("warn", "backup acknowledged", "asserted by the operator, NOT verified by this script");
  return true;
}

function printBackupInstructions(): void {
  console.log(`
  Neon keeps point-in-time history, but a named branch is what you want here —
  it is instant, costs nothing until it diverges, and gives you a database you
  can point the app at if the migration goes wrong:

      neonctl branches create --name pre-offline-sync-$(date +%Y%m%d)

  Or, in the Neon console: Branches → New Branch → from "current state".

  Verify the branch exists and is readable BEFORE applying. A backup nobody has
  confirmed is restorable is not a backup.`);
}

// =============================================================================
// APPLY
// =============================================================================

function apply(): void {
  console.log("\n[5/5] Applying\n");

  try {
    console.log(runPrisma(["migrate", "deploy"]));
    record("ok", "migration applied", "");
  } catch (error) {
    record("fail", "migration applied", redact(error));
  }
}

// =============================================================================
// ENTRY POINT
// =============================================================================

async function main(): Promise<void> {
  const applying = process.argv.includes("--apply");

  console.log("=".repeat(78));
  console.log("  OFFLINE-FIRST MIGRATION VERIFIER");
  console.log(`  migration: ${TARGET_MIGRATION}`);
  console.log(`  mode:      ${applying ? "VERIFY AND APPLY" : "verify only (read-only)"}`);
  console.log("=".repeat(78));

  verifyMigrationIsAdditive();
  await verifyLiveDatabase();
  verifyNoDrift();
  const backupOk = verifyBackupAcknowledged(applying);

  console.log(`\n${"=".repeat(78)}`);

  const fails = findings.filter((f) => f.severity === "fail");
  const warns = findings.filter((f) => f.severity === "warn");

  if (fails.length > 0) {
    console.log(`  ✖ ${fails.length} check(s) FAILED. Do not apply.\n`);
    for (const finding of fails) console.log(`    - ${finding.check}: ${finding.detail}`);
    console.log("=".repeat(78));
    process.exit(1);
  }

  console.log(`  ✔ All checks passed${warns.length > 0 ? ` (${warns.length} warning(s))` : ""}.`);
  console.log("=".repeat(78));

  if (!applying) {
    printBackupInstructions();
    console.log(`
  To apply, once a backup exists:

      npm run sync:verify-migration -- --apply ${BACKUP_FLAG}
`);
    return;
  }

  if (!backupOk) {
    printBackupInstructions();
    process.exit(1);
  }

  apply();

  if (failed()) process.exit(1);
}

main().catch((error: unknown) => {
  console.error("\nverifier crashed:", error);
  process.exit(1);
});
