// =============================================================================
// ENSURE THE WALK-IN CUSTOMER EXISTS
//
// Every checkout without a named customer resolves to the singleton row with
// `isWalkIn = true`. Without it the sale service throws "Walk-In customer not
// initialized." and the till cannot sell at all.
//
// It is easy to lose: it is a normal `customers` row, so any cleanup keyed on
// name can take it with the test data. This restores it idempotently.
//
//   DATABASE_URL=<url> npx tsx scripts/ensure-walkin.ts
// =============================================================================

import { Client } from "pg";

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error("✖ DATABASE_URL is not set.");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  const existing = await client.query<{ id: string; name: string }>(
    `select id, name from "customers" where "isWalkIn" = true limit 1`
  );

  if (existing.rows.length > 0) {
    console.log(`✔ Walk-In already present: "${existing.rows[0]!.name}" (${existing.rows[0]!.id})`);
    await client.end();
    return;
  }

  // cuid-shaped id, generated here so this script needs no Prisma client.
  const id = "c" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  // customerCode is NOT NULL and unique; the app mints them as CUS-######.
  // Take the next free number rather than a fixed one, so this works on a
  // database that already has customers.
  const seq = await client.query<{ next: number }>(
    `select coalesce(max(nullif(regexp_replace("customerCode", '\\D', '', 'g'), '')::int), 0) + 1 as next
     from "customers" where "customerCode" like 'CUS-%'`
  );
  const code = `CUS-${String(seq.rows[0]?.next ?? 1).padStart(6, "0")}`;

  await client.query(
    `insert into "customers" (id, "customerCode", name, phone, "isWalkIn", "isActive", "createdAt", "updatedAt")
     values ($1, $2, 'Walk-In Customer', $3, true, true, now(), now())`,
    [id, code, "0000000000"]
  );

  console.log(`✔ Walk-In customer created (${id}).`);
  console.log("  Re-provision or sync the till so it reaches the mirror.");
  await client.end();
}

main().catch((error: unknown) => {
  console.error("\nensure-walkin crashed:", error);
  process.exit(1);
});
