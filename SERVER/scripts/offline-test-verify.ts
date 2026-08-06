// =============================================================================
// OFFLINE TEST RIG — RECONCILE THE TILL AGAINST THE CLOUD
//
// After a manual offline day and a sync, this answers the only question that
// matters: did everything the till recorded reach the cloud, with the same
// money?
//
// It reads both databases directly — SQLite on this machine, Postgres on the
// test branch — rather than trusting either side's own report of itself.
//
//   npx tsx scripts/offline-test-verify.ts
//
// Driven by:  .\scripts\offline-test.ps1 verify
// =============================================================================

import path from "node:path";

import Database from "better-sqlite3";
import { Client } from "pg";

const tillPath = path.resolve(
  process.env["LOCAL_DATABASE_PATH"] ?? "./data/offline-test-till.db"
);
const cloudUrl = process.env["TEST_DATABASE_URL"];

if (!cloudUrl) {
  console.error("✖ TEST_DATABASE_URL is not set.");
  process.exit(1);
}

type Check = { label: string; local: string; cloud: string; ok: boolean; note?: string };
const checks: Check[] = [];

function compare(label: string, local: unknown, cloud: unknown, note?: string): void {
  const l = String(local ?? "0");
  const c = String(cloud ?? "0");
  checks.push({ label, local: l, cloud: c, ok: l === c, note });
}

async function main(): Promise<void> {
  const till = new Database(tillPath, { readonly: true });
  const cloud = new Client({ connectionString: cloudUrl });
  await cloud.connect();

  const sq = (sql: string): Record<string, unknown> =>
    (till.prepare(sql).get() ?? {}) as Record<string, unknown>;
  const pq = async (sql: string): Promise<Record<string, unknown>> =>
    (await cloud.query(sql)).rows[0] as Record<string, unknown>;

  console.log("=".repeat(78));
  console.log("  TILL vs CLOUD");
  console.log(`  till  : ${tillPath}`);
  console.log(`  cloud : ${/@([^/]+)/.exec(cloudUrl)?.[1] ?? "?"}`);
  console.log("=".repeat(78));

  // ── The queue: anything still here has NOT reached the cloud ──────────────
  const queue = sq(`
    select
      sum(case when status='PENDING'   then 1 else 0 end) pending,
      sum(case when status='IN_FLIGHT' then 1 else 0 end) inflight,
      sum(case when status='SYNCED'    then 1 else 0 end) synced,
      sum(case when status='FAILED'    then 1 else 0 end) failed,
      count(*) total
    from sync_queue
  `);
  console.log("\nQUEUE ON THE TILL");
  console.log(`  pending   ${queue["pending"] ?? 0}`);
  console.log(`  in-flight ${queue["inflight"] ?? 0}`);
  console.log(`  synced    ${queue["synced"] ?? 0}`);
  console.log(`  failed    ${queue["failed"] ?? 0}`);

  const undrained = Number(queue["pending"] ?? 0) + Number(queue["inflight"] ?? 0);
  if (undrained > 0) {
    console.log(`\n  ! ${undrained} item(s) have NOT been uploaded yet.`);
    console.log(`    Row counts below will legitimately differ. Run 'sync' first.`);
  }

  // ── Sales, money, and the things that move with them ──────────────────────
  //
  // Comparison is scoped to the sales THIS TILL authored, by sale number.
  // Comparing raw totals is wrong and produces false failures: the cloud
  // legitimately holds rows the till never had — sales from head office, from
  // another till, or predating this mirror — and a bare `count(*)` counts them.
  // (Observed: a 28-July sale of ₹1000.02 made every money check "fail" while
  // the sync was in fact perfect.)
  const tillSaleNumbers = (
    till.prepare(`select saleNumber from sales`).all() as Array<{ saleNumber: string }>
  ).map((r) => r.saleNumber);

  if (tillSaleNumbers.length === 0) {
    console.log("\n  (no sales on the till yet — ring some up first)");
  }

  // Parameterized IN-list; empty list degenerates to a never-true predicate.
  const inList =
    tillSaleNumbers.length > 0
      ? tillSaleNumbers.map((_, i) => `$${i + 1}`).join(",")
      : "null";
  const cloudScoped = async (sql: string): Promise<Record<string, unknown>> =>
    (await cloud.query(sql, tillSaleNumbers)).rows[0] as Record<string, unknown>;

  compare(
    "sale count",
    sq(`select count(*) c from sales`)["c"],
    (await cloudScoped(`select count(*)::int c from "sales" where "saleNumber" in (${inList})`))["c"]
  );
  compare(
    "sale revenue",
    Number(sq(`select coalesce(sum("grandTotal"),0) s from sales`)["s"] ?? 0).toFixed(2),
    Number(
      (
        await cloudScoped(
          `select coalesce(sum("grandTotal"),0) s from "sales" where "saleNumber" in (${inList})`
        )
      )["s"] ?? 0
    ).toFixed(2),
    "must match to the paisa"
  );
  compare(
    "sale items",
    sq(`select count(*) c from sale_items`)["c"],
    (
      await cloudScoped(
        `select count(*)::int c from "sale_items" si
         join "sales" s on s.id = si."saleId" where s."saleNumber" in (${inList})`
      )
    )["c"]
  );
  compare(
    "payment count",
    sq(`select count(*) c from payments`)["c"],
    (
      await cloudScoped(
        `select count(*)::int c from "payments" p
         join "sales" s on s.id = p."saleId" where s."saleNumber" in (${inList})`
      )
    )["c"]
  );
  compare(
    "payment total",
    Number(sq(`select coalesce(sum(amount),0) s from payments`)["s"] ?? 0).toFixed(2),
    Number(
      (
        await cloudScoped(
          `select coalesce(sum(p.amount),0) s from "payments" p
           join "sales" s on s.id = p."saleId" where s."saleNumber" in (${inList})`
        )
      )["s"] ?? 0
    ).toFixed(2),
    "must match to the paisa"
  );
  compare(
    "inventory movements",
    sq(`select count(*) c from inventory_movements`)["c"],
    (
      await cloudScoped(
        `select count(*)::int c from "inventory_movements" m
         join "sales" s on s.id = m."relatedSaleId" where s."saleNumber" in (${inList})`
      )
    )["c"],
    "movements this till's sales caused"
  );

  // Every customer the till holds must exist in the cloud. The reverse is not
  // required: head office may know customers this till has never downloaded.
  const localCustomers = (
    till.prepare(`select id from customers`).all() as Array<{ id: string }>
  ).map((r) => r.id);
  const cloudHas =
    localCustomers.length === 0
      ? 0
      : Number(
          (
            await cloud.query(
              `select count(*)::int c from "customers" where id = any($1::text[])`,
              [localCustomers]
            )
          ).rows[0]!.c
        );
  compare("customers reached cloud", localCustomers.length, cloudHas);

  // ── Duplicates: the thing idempotency exists to prevent ───────────────────
  const dupes = await pq(`
    select count(*)::int c from (
      select "saleNumber" from "sales" group by "saleNumber" having count(*) > 1
    ) d
  `);
  checks.push({
    label: "no duplicate sales in cloud",
    local: "-",
    cloud: String(dupes["c"]),
    ok: Number(dupes["c"]) === 0,
    note: "a re-sent batch must not double-post",
  });

  // ── Every synced item should have exactly one receipt ─────────────────────
  const receipts = await pq(`select count(*)::int c from "sync_receipts"`);
  compare("synced items / receipts", queue["synced"], receipts["c"], "one receipt per item");

  // ── Report ────────────────────────────────────────────────────────────────
  console.log("\nRECONCILIATION");
  let failed = 0;
  for (const c of checks) {
    const mark = c.ok ? "✔" : "✖";
    if (!c.ok) failed += 1;
    const detail = c.local === "-" ? c.cloud : `local ${c.local}  cloud ${c.cloud}`;
    console.log(`  ${mark} ${c.label.padEnd(28)} ${detail}${c.note && !c.ok ? `   <- ${c.note}` : ""}`);
  }

  console.log(`\n${"=".repeat(78)}`);
  if (failed === 0 && undrained === 0) {
    console.log("  ✔ The till and the cloud agree. The offline day reconciled.");
  } else if (failed === 0) {
    console.log("  ✔ Everything uploaded so far reconciles — but the queue is not empty.");
  } else if (undrained > 0) {
    console.log(`  ! ${failed} difference(s), with ${undrained} item(s) still queued.`);
    console.log("    Run 'sync' and re-check before treating these as failures.");
  } else {
    console.log(`  ✖ ${failed} MISMATCH(ES) with an empty queue. This is a real problem.`);
  }
  console.log("=".repeat(78));

  till.close();
  await cloud.end();
  if (failed > 0 && undrained === 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("\nverify crashed:", error);
  process.exit(1);
});
