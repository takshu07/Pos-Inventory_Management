/**
 * Applies a migration folder's SQL through the `pg` driver and records it in
 * _prisma_migrations, then exits.
 *
 * Why this exists: `prisma migrate dev` cannot run in this repo (the historical
 * _perf migration fails shadow-DB replay), and the Prisma CLI's own connector
 * cannot reach the Neon pooler from this environment, while the app's `pg`
 * adapter can. This script is the documented workflow for applying migrations
 * here — see the pos-prisma-neon-tx-timeout / product-module memories.
 *
 * Usage: node prisma/apply-migration.cjs <migration_folder_name>
 */
require("dotenv/config");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Client } = require("pg");

const folder = process.argv[2];
if (!folder) {
  console.error("Usage: node prisma/apply-migration.cjs <migration_folder_name>");
  process.exit(1);
}

const dir = path.join(__dirname, "migrations", folder);
const sqlPath = path.join(dir, "migration.sql");
if (!fs.existsSync(sqlPath)) {
  console.error(`No migration.sql at ${sqlPath}`);
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, "utf8");
const checksum = crypto.createHash("sha256").update(sql).digest("hex");

/**
 * Splits the script into statements on semicolons that terminate a line,
 * ignoring those inside string literals. Prisma-generated DDL is one statement
 * per line-group, so this is sufficient and avoids pulling in a SQL parser.
 */
function splitStatements(script) {
  const out = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < script.length; i += 1) {
    const ch = script[i];
    const prev = script[i - 1];
    if (ch === "'" && prev !== "\\" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && prev !== "\\" && !inSingle) inDouble = !inDouble;
    if (ch === ";" && !inSingle && !inDouble) {
      const stmt = buf.trim();
      if (stmt) out.push(stmt);
      buf = "";
    } else {
      buf += ch;
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const already = await client.query(
      `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL`,
      [folder]
    );
    if (already.rowCount > 0) {
      console.log(`[skip] ${folder} is already applied.`);
      return;
    }

    const statements = splitStatements(sql);
    // PostgreSQL forbids using a new enum value in the same transaction that
    // added it. ALTER TYPE ... ADD VALUE therefore runs OUTSIDE a transaction,
    // and the remaining DDL runs inside one so a failure rolls back cleanly.
    const enumAdds = statements.filter((s) => /ALTER TYPE .* ADD VALUE/i.test(s));
    const rest = statements.filter((s) => !/ALTER TYPE .* ADD VALUE/i.test(s));

    console.log(`[run] ${enumAdds.length} enum additions (non-transactional)`);
    for (const stmt of enumAdds) {
      // IF NOT EXISTS makes re-runs safe if a previous attempt partially applied.
      const safe = stmt.replace(/ADD VALUE\s+'/i, "ADD VALUE IF NOT EXISTS '");
      await client.query(safe);
    }

    console.log(`[run] ${rest.length} DDL statements (transactional)`);
    await client.query("BEGIN");
    for (const stmt of rest) {
      await client.query(stmt);
    }
    await client.query(
      `INSERT INTO "_prisma_migrations"
         (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)`,
      [crypto.randomUUID(), checksum, folder]
    );
    await client.query("COMMIT");

    console.log(`[ok] Applied ${folder}`);
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* no transaction open */
    }
    console.error(`[fail] ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
