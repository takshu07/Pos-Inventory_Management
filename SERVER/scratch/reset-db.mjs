// =============================================================================
// FULL DATABASE RESET — manual E2E testing from scratch
//
// Truncates every application table (RESTART IDENTITY CASCADE) while preserving
// `_prisma_migrations`, so the schema stays exactly where `migrate deploy` left
// it and only the data goes. Run `npm run db:seed` afterwards to recreate the
// three canonical portal accounts.
//
//     node scratch/reset-db.mjs --yes
//
// Requires --yes. Prints the target endpoint before doing anything.
// =============================================================================

import "dotenv/config";
import pg from "pg";

const url = process.env["DATABASE_URL"] ?? "";
if (url === "") {
  console.error("refusing: DATABASE_URL is not set");
  process.exit(2);
}

if (!process.argv.includes("--yes")) {
  console.error("refusing: pass --yes to confirm a full data wipe");
  process.exit(2);
}

const host = (/@([^/?]+)/.exec(url) ?? [, "?"])[1];
console.log(`target host : ${host}`);

const client = new pg.Client({ connectionString: url });
await client.connect();

const { rows } = await client.query(
  `SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename`
);

if (rows.length === 0) {
  console.error("no application tables found — is the schema migrated?");
  process.exit(1);
}

const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");

// One statement: CASCADE + a single TRUNCATE sidesteps every FK ordering
// problem, and RESTART IDENTITY resets sequences so codes start from 1 again.
await client.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);

console.log(`truncated   : ${rows.length} tables`);

let remaining = 0;
for (const r of rows) {
  const { rows: n } = await client.query(`SELECT count(*)::int AS c FROM "${r.tablename}"`);
  remaining += n[0].c;
}
console.log(`rows left   : ${remaining}`);

await client.end();
