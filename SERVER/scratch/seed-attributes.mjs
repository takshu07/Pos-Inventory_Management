// =============================================================================
// SEED SIZE + COLOR VOCABULARY
//
// ProductVariant.sizeId and .colorId are NOT NULL in schema.prisma, and there is
// no API to create sizes or colors — the owner product wizard only offers the
// rows that already exist. A full truncate therefore leaves the catalog
// unbuildable: every variant insert fails on a missing FK target.
//
// This restores exactly the vocabulary seedProducts.ts used, and nothing else:
// no products, no categories, no stock. The catalog stays empty so it can be
// built through the UI.
//
//     node scratch/seed-attributes.mjs
//
// Idempotent — re-running it leaves the same rows.
// =============================================================================

import "dotenv/config";
import pg from "pg";

const SIZES = [
  ["Small", 1], ["Medium", 2], ["Large", 3], ["XL", 4],
  ["32", 5], ["34", 6], ["36", 7], ["38", 8],
];

const COLORS = [
  ["Black", "#000000"], ["Blue", "#0000FF"], ["Navy", "#000080"],
  ["White", "#FFFFFF"], ["Khaki", "#F0E68C"], ["Grey", "#808080"],
  ["Red", "#FF0000"], ["Green", "#008000"],
];

const newId = () => "c" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

const client = new pg.Client({ connectionString: process.env["DATABASE_URL"] ?? "" });
await client.connect();

for (const [name, sortOrder] of SIZES) {
  await client.query(
    `INSERT INTO "sizes" (id, name, "sortOrder", "isActive", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, now(), now())
     ON CONFLICT (name) DO NOTHING`,
    [newId(), name, sortOrder]
  );
}

for (const [name, hexCode] of COLORS) {
  await client.query(
    `INSERT INTO "colors" (id, name, "hexCode", "isActive", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, now(), now())
     ON CONFLICT (name) DO NOTHING`,
    [newId(), name, hexCode]
  );
}

const s = await client.query(`SELECT count(*)::int AS c FROM "sizes"`);
const c = await client.query(`SELECT count(*)::int AS c FROM "colors"`);
console.log(`sizes  : ${s.rows[0].c}`);
console.log(`colors : ${c.rows[0].c}`);

await client.end();
