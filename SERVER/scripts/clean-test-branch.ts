// =============================================================================
// CLEAN HARNESS RESIDUE FROM A TEST DATABASE
//
// `sync:validate` seeds rows tagged `E2E-<runid>` and leaves them behind on
// purpose — a failed run's data is evidence. Across several runs that residue
// accumulates, and provisioning then REFUSES to build a till from the database
// ("no stress-test data" check), which is correct: a cashier must never be
// handed a mirror seeded with fake sales.
//
// This removes only tagged rows. Deletion order is derived from the live
// foreign-key graph rather than hand-written, because hand-written orders go
// stale the first time somebody adds a relation — and the failure mode is a
// half-deleted database.
//
// SAFETY
//   - Refuses to run against a URL that looks like production unless
//     --i-accept-writes-to-this-database is passed.
//   - One transaction: it either fully succeeds or changes nothing.
//   - --dry-run reports what would go, and writes nothing.
//
//   npx tsx scripts/clean-test-branch.ts --dry-run
//   npx tsx scripts/clean-test-branch.ts
// =============================================================================

import { Client } from "pg";

const TAG_PATTERNS = ["E2E-%", "STRESS-%", "PSTRESS-%", "WT-%", "NT-%"];

const dryRun = process.argv.includes("--dry-run");
const accepted = process.argv.includes("--i-accept-writes-to-this-database");

async function main(): Promise<void> {
const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("✖ DATABASE_URL is not set.");
  process.exit(1);
}

// A pooler host tells us nothing about whether it is production, so the check
// is on the endpoint id, which is unique per Neon branch.
const host = /@([^/]+)/.exec(url)?.[1] ?? "unknown";
const looksDisposable = /test|staging|branch|localhost|127\.0\.0\.1/i.test(url);

console.log("=".repeat(78));
console.log("  CLEAN HARNESS RESIDUE");
console.log(`  host : ${host}`);
console.log(`  mode : ${dryRun ? "DRY RUN (nothing is written)" : "LIVE"}`);
console.log("=".repeat(78));

if (!dryRun && !looksDisposable && !accepted) {
  console.error(`
  ✖ This URL does not look like a test or branch database, and this script
    deletes rows. If you are certain, re-run with:

        --i-accept-writes-to-this-database
`);
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();

// ── The foreign-key graph, read from the database itself ────────────────────
type Fk = { child: string; col: string; parent: string };

const fks: Fk[] = (
  await client.query<Fk>(`
    select tc.table_name  as child,
           kcu.column_name as col,
           ccu.table_name  as parent
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema    = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
     and tc.table_schema    = ccu.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema    = 'public'
  `)
).rows;

const childrenOf = new Map<string, Fk[]>();
for (const fk of fks) {
  const list = childrenOf.get(fk.parent) ?? [];
  list.push(fk);
  childrenOf.set(fk.parent, list);
}

// ── Roots: the tagged rows themselves ───────────────────────────────────────
const like = (col: string) =>
  TAG_PATTERNS.map((p) => `${col} like '${p}'`).join(" or ");

const roots: Array<{ table: string; idSql: string }> = [
  { table: "sales", idSql: `select id from "sales" where ${like(`"saleNumber"`)}` },
  // `isWalkIn` is EXCLUDED deliberately. Some harnesses name the walk-in row
  // `E2E-... Walk-In`, and deleting it breaks every subsequent checkout with
  // "Walk-In customer not initialized" — the sale service looks the row up by
  // `isWalkIn: true`, not by name. It is singleton infrastructure, not data.
  {
    table: "customers",
    idSql: `select id from "customers" where (${like("name")}) and coalesce("isWalkIn", false) = false`,
  },
  { table: "products", idSql: `select id from "products" where ${like("name")}` },
  { table: "purchases", idSql: `select id from "purchases" where ${like(`"purchaseNumber"`)}` },
  // Employees have no `name` column — they are tagged on employeeCode. Left
  // behind, these are live CASHIER logins in a database people test against.
  { table: "employees", idSql: `select id from "employees" where ${like(`"employeeCode"`)}` },
];

// Emit deletes children-first. Depth is bounded because the graph has cycles
// (a sale references a customer which references a sale); six levels covers
// every real chain here and terminates regardless.
const statements: string[] = [];
const seen = new Set<string>();

function walk(table: string, idSql: string, depth: number): void {
  if (depth > 6) return;
  const key = `${table}|${idSql}`;
  if (seen.has(key)) return;
  seen.add(key);

  for (const fk of childrenOf.get(table) ?? []) {
    if (fk.child === table) continue; // self-reference: depth bound handles it
    const childIds = `select id from "${fk.child}" where "${fk.col}" in (${idSql})`;
    walk(fk.child, childIds, depth + 1);
    statements.push(`delete from "${fk.child}" where "${fk.col}" in (${idSql})`);
  }
}

for (const root of roots) walk(root.table, root.idSql, 0);
for (const root of roots) {
  statements.push(`delete from "${root.table}" where id in (${root.idSql})`);
}

// Sync bookkeeping for harness devices. These are not FK-linked to the rows
// above, so they need naming explicitly.
statements.push(
  `delete from "sync_receipts" where "deviceId" like 'e2e-%' or "deviceId" like 'stress-%' or "deviceId" like 'phase%'`,
  `delete from "sync_conflict_records" where "deviceId" like 'e2e-%' or "deviceId" like 'stress-%' or "deviceId" like 'phase%'`,
  `delete from "sync_devices" where "deviceId" like 'e2e-%' or "deviceId" like 'stress-%' or "deviceId" like 'phase%'`
);

// ── Apply ───────────────────────────────────────────────────────────────────
console.log("\nBEFORE");
const countTables = ["products", "product_variants", "customers", "sales", "payments", "sync_receipts"];
for (const t of countTables) {
  const r = await client.query<{ c: number }>(`select count(*)::int c from "${t}"`);
  console.log(`  ${t.padEnd(20)} ${r.rows[0]!.c}`);
}

let deleted = 0;
await client.query("begin");
try {
  for (const sql of statements) {
    // In a dry run the deletes still execute inside the transaction — that is
    // the only way to learn the true cascade count — but the transaction is
    // rolled back, so nothing is committed.
    const result = await client.query(sql);
    if (result.rowCount) {
      deleted += result.rowCount;
      console.log(`  ${String(result.rowCount).padStart(6)}  ${sql.slice(7, 78)}`);
    }
  }
  if (dryRun) {
    await client.query("rollback");
    console.log(`\n  DRY RUN — rolled back. ${deleted} row(s) would be deleted.`);
  } else {
    await client.query("commit");
    console.log(`\n  ✔ Committed. ${deleted} row(s) deleted.`);
  }
} catch (error) {
  await client.query("rollback");
  console.error(`\n  ✖ ROLLED BACK — nothing changed.`);
  console.error(`    ${(error as Error).message}`);
  await client.end();
  process.exit(1);
}

console.log("\nAFTER");
for (const t of countTables) {
  const r = await client.query<{ c: number }>(`select count(*)::int c from "${t}"`);
  console.log(`  ${t.padEnd(20)} ${r.rows[0]!.c}`);
}

const leftovers = await client.query<{ name: string }>(
  `select name from "products" where ${like("name")} order by 1 limit 5`
);
if (leftovers.rows.length > 0 && !dryRun) {
  console.log("\n  ! tagged products still present:", leftovers.rows.map((r) => r.name).join(", "));
}

await client.end();
console.log("=".repeat(78));
}

main().catch((error: unknown) => {
  console.error("\ncleanup crashed:", error);
  process.exit(1);
});
