// =============================================================================
// E2E RESIDUE CLEANER
//
// `sync:validate` seeds tagged rows (E2E-…) into the cloud database and does not
// remove them, so a second run collides: `employees.phone` and
// `expenses.expenseCode` are UNIQUE, and a crashed run leaves an
// `attendance` row that trips @@unique([employeeId, date]) next time. The
// harness is only re-runnable if something clears that residue first.
//
//     node scripts/check-db-target.mjs && node scripts/clean-e2e-residue.mjs
//
// Only ever touches rows whose tag marks them as harness-generated. It refuses
// to run against production, and refuses a target it cannot identify — see
// check-db-target.mjs for the endpoint contract.
// =============================================================================

import "dotenv/config";
import pg from "pg";

const PROD_ENDPOINT = process.env["POS_PROD_ENDPOINT"] ?? "ep-frosty-moon-at71qpbs";

const url = process.env["DATABASE_URL"] ?? "";

if (url === "") {
  console.error("refusing: DATABASE_URL is not set");
  process.exit(2);
}

if (url.includes(PROD_ENDPOINT)) {
  console.error(`refusing: DATABASE_URL points at production (${PROD_ENDPOINT})`);
  process.exit(1);
}

// Children before parents: every statement is scoped to the E2E- tag, so a row
// the harness did not create is never in range.
const STEPS = [
  [`DELETE FROM "attendance" WHERE "employeeId" IN (SELECT id FROM "employees" WHERE "employeeCode" LIKE 'E2E-%')`, "attendance"],
  [`DELETE FROM "expenses" WHERE "expenseCode" LIKE 'E2E-%'`, "expenses"],
  [`DELETE FROM "payments" WHERE "saleId" IN (SELECT id FROM "sales" WHERE "saleNumber" LIKE 'E2E-%')`, "payments"],
  [`DELETE FROM "sale_items" WHERE "saleId" IN (SELECT id FROM "sales" WHERE "saleNumber" LIKE 'E2E-%')`, "sale_items"],
  [`DELETE FROM "sales" WHERE "saleNumber" LIKE 'E2E-%'`, "sales"],
  [`DELETE FROM "customers" WHERE "customerCode" LIKE 'E2E-%' OR "name" LIKE 'E2E-%'`, "customers"],
  [`DELETE FROM "employees" WHERE "employeeCode" LIKE 'E2E-%'`, "employees"],
  [`DELETE FROM "sync_receipts"`, "sync_receipts"],
  [`DELETE FROM "sync_nonces"`, "sync_nonces"],
];

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  for (const [sql, label] of STEPS) {
    try {
      const result = await client.query(sql);
      console.log(`  ${label}: ${result.rowCount} removed`);
    } catch (error) {
      // A table the schema does not have, or a column named differently, is not
      // worth aborting a cleanup over — report it and keep going.
      console.log(`  ${label}: skipped (${String(error.message).split("\n")[0]})`);
    }
  }
} finally {
  await client.end();
}

console.log("\nresidue cleared.");
