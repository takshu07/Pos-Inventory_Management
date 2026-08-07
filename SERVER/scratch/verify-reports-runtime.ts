// =============================================================================
// POST-REWRITE SMOKE CHECK — the REAL repository functions
//
// The equivalence harness proved the SQL SHAPES are interchangeable. This runs
// the actual production functions that were edited, so the check covers the
// real query text — every filter, cast, window function and ORDER BY that the
// isolated comparison necessarily left out. A syntax error or a broken
// reference shows up here and nowhere else.
//
//     npx tsx scratch/verify-reports-runtime.ts
//
// Read-only.
// =============================================================================

import "dotenv/config";
import { reportsRepository } from "../src/repositories/reports.repository";

const startDate = new Date();
startDate.setFullYear(startDate.getFullYear() - 5);
const endDate = new Date();

async function probe(name: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    const out = await fn();
    const n = Array.isArray(out) ? out.length : 1;
    console.log(`OK   ${name} — executed, ${n} row(s)`);
    return true;
  } catch (e) {
    console.log(`FAIL ${name} — ${(e as Error).message.split("\n").slice(0, 5).join(" | ")}`);
    return false;
  }
}

async function main() {
  const f = { startDate, endDate } as never;
  let ok = true;

  // productPerformance — rewrote 2 LATERALs (exchange return/issued units).
  ok = (await probe("productPerformance", () =>
    reportsRepository.productPerformance(f, {
      sortBy: "revenue", sortOrder: "desc", limit: 25, offset: 0,
    })
  )) && ok;

  // Sorting BY a rewritten column: exercises the ORDER BY path over the
  // pre-aggregated join, which the default sort does not.
  ok = (await probe("productPerformance sortBy=returns", () =>
    reportsRepository.productPerformance(f, {
      sortBy: "returns", sortOrder: "desc", limit: 25, offset: 0,
    })
  )) && ok;

  ok = (await probe("productPerformance sortBy=exchanges", () =>
    reportsRepository.productPerformance(f, {
      sortBy: "exchanges", sortOrder: "asc", limit: 25, offset: 0,
    })
  )) && ok;

  // inventoryPosition — rewrote 2 LATERALs (units sold, last movement).
  ok = (await probe("inventoryPosition bucket=ALL", () =>
    reportsRepository.inventoryPosition({
      velocityDays: 30, bucket: "ALL", limit: 25, offset: 0,
    })
  )) && ok;

  // Buckets read the rewritten aggregate in their predicate, so each is a
  // distinct code path over the new join.
  for (const bucket of ["DEAD", "FAST", "SLOW", "LOW", "OUT", "OVERSTOCK"] as const) {
    ok = (await probe(`inventoryPosition bucket=${bucket}`, () =>
      reportsRepository.inventoryPosition({
        velocityDays: 30, bucket, limit: 25, offset: 0,
      })
    )) && ok;
  }

  // The categoryId filter is a SEPARATE code path — it appends a predicate that
  // the unfiltered call never emits. Probed deliberately.
  ok = (await probe("inventoryPosition + categoryId filter", () =>
    reportsRepository.inventoryPosition({
      velocityDays: 30, bucket: "ALL", limit: 25, offset: 0, categoryId: "probe-nonexistent-id",
    })
  )) && ok;

  // exchangeList — rewrote 2 LATERALs (return/issued units per exchange).
  ok = (await probe("exchangeList", () =>
    reportsRepository.exchangeList(f, { limit: 25, offset: 0 })
  )) && ok;

  console.log(
    ok ? "\n✓ every rewritten query executes" : "\n✗ a rewritten query failed — see above"
  );
  process.exit(ok ? 0 : 1);
}

void main();
