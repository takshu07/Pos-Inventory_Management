// =============================================================================
// LATERAL → GROUPED-SUBQUERY EQUIVALENCE HARNESS
//
// Proves that rewriting `LEFT JOIN LATERAL (scalar aggregate) ON TRUE` as a
// pre-aggregated `LEFT JOIN (… GROUP BY key)` returns identical numbers, by
// running BOTH forms against real Postgres and diffing every row of every
// column.
//
// Why a harness and not a unit test: these queries compute REVENUE, MARGIN and
// STOCK VALUATION. A subtly wrong rewrite does not error — it banks a different
// number. The bar is row-for-row equality against data containing the shapes
// that actually break this class of rewrite, not "looks about right".
//
// ── The four ways this rewrite can go wrong ──────────────────────────────────
// The fixture below deliberately contains all of them:
//
//   1. NO MATCHING ROWS. A LATERAL with COALESCE inside still returns one row
//      (0). A grouped subquery returns NO row, so the LEFT JOIN yields NULL.
//      This is why the COALESCE must move to the OUTER select — the single
//      most likely mistake, and the one that silently turns 0 into NULL.
//   2. FAN-OUT. If the GROUP BY key is not unique in the subquery, the join
//      multiplies rows and every total inflates.
//   3. FILTERED AGGREGATE. Rows excluded by the LATERAL's WHERE (a non-COMPLETED
//      sale) must be excluded by the subquery's WHERE too, or totals drift.
//   4. NULL vs ZERO. MAX() over no rows is NULL, and NULL is meaningfully
//      different from 0 for "last movement date" — it must stay NULL.
//
// ── Safety ───────────────────────────────────────────────────────────────────
// Everything runs inside a transaction that ALWAYS rolls back, so the database
// is unchanged whether the check passes, fails, or throws. Nothing is committed.
//
//     npx tsx scratch/verify-lateral-equivalence.ts
// =============================================================================

import "dotenv/config";
import { prisma } from "../src/config/prisma";
import { Prisma } from "../generated/prisma";

type Row = Record<string, unknown>;

/** Stable serialization so BigInt/Decimal/Date compare by VALUE. */
function normalize(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "bigint") return `n:${value.toString()}`;
  if (value instanceof Date) return `d:${value.toISOString()}`;
  if (typeof value === "object" && value !== null && "toFixed" in value) {
    return `n:${String(value)}`; // Prisma.Decimal — compare as its decimal string
  }
  if (typeof value === "number") return `n:${value}`;
  return `s:${String(value)}`;
}

/**
 * Row preview for the log. Goes through `normalize` because these result sets
 * contain BigInt (SUM/COUNT) and Prisma.Decimal, and `JSON.stringify` throws on
 * BigInt — which silently aborted the run after the first comparison.
 */
function preview(rows: Row[]): string {
  return rows
    .map((r) =>
      `{${Object.entries(r).map(([k, v]) => `${k}:${normalize(v)}`).join(", ")}}`
    )
    .join(" ");
}

const failures: string[] = [];

function diff(name: string, a: Row[], b: Row[]): void {
  if (a.length !== b.length) {
    failures.push(`${name}: ROW COUNT lateral=${a.length} grouped=${b.length}`);
    console.log(`  ✗ ${name}: ROW COUNT differs — lateral=${a.length} grouped=${b.length}`);
    return;
  }

  for (let i = 0; i < a.length; i++) {
    const rowA = a[i] as Row;
    const rowB = b[i] as Row;
    for (const key of new Set([...Object.keys(rowA), ...Object.keys(rowB)])) {
      const va = normalize(rowA[key]);
      const vb = normalize(rowB[key]);
      if (va !== vb) {
        failures.push(`${name}: row ${i} "${key}" lateral=${va} grouped=${vb}`);
        console.log(`  ✗ ${name}: row ${i} column "${key}" — lateral=${va} grouped=${vb}`);
        return;
      }
    }
  }

  const cols = a[0] ? Object.keys(a[0]).length : 0;
  console.log(`  ✓ ${name}: ${a.length} rows × ${cols} columns identical`);
}

const ROLLBACK = "__rollback__";

async function main() {
  console.log("Seeding an in-transaction fixture (always rolled back)…\n");

  try {
    await prisma.$transaction(async (tx) => {
      // ── Fixture ───────────────────────────────────────────────────────────
      const now = new Date();
      const old = new Date();
      old.setFullYear(old.getFullYear() - 10); // outside the 5-year window

      await tx.$executeRaw`INSERT INTO "categories" (id, name, "updatedAt") VALUES ('vc_cat', 'VerifyCat', ${now})`;
      await tx.$executeRaw`INSERT INTO "colors" (id, name, "updatedAt") VALUES ('vc_color', 'VerifyColor', ${now})`;
      await tx.$executeRaw`INSERT INTO "products" (id, name, "categoryId", "updatedAt") VALUES ('vc_prod', 'VerifyProduct', 'vc_cat', ${now})`;

      // One size per variant: product_variants has a UNIQUE
      // (productId, sizeId, colorId), so four variants of one product need four
      // distinct sizes. (Found by the constraint firing — worth stating, since
      // it is exactly the kind of real-schema detail a fixture has to respect.)
      for (const i of [1, 2, 3, 4]) {
        await tx.$executeRaw`
          INSERT INTO "sizes" (id, name, "updatedAt")
          VALUES (${`vc_size${i}`}, ${`VerifySize${i}`}, ${now})`;
      }

      // Four variants covering the interesting shapes.
      //   v1 — several sales + several exchange rows (fan-out risk, case 2)
      //   v2 — exactly one of each (the ordinary case)
      //   v3 — NO sales, NO exchanges, NO movements (case 1 + case 4)
      //   v4 — only NON-COMPLETED sales and out-of-window rows (case 3)
      for (const [i, id] of ["vc_v1", "vc_v2", "vc_v3", "vc_v4"].entries()) {
        await tx.$executeRaw`
          INSERT INTO "product_variants"
            (id, "productId", "sizeId", "colorId", sku, "costPrice", "sellingPrice", mrp, "currentStock", "updatedAt")
          VALUES (${id}, 'vc_prod', ${`vc_size${i + 1}`}, 'vc_color', ${`VC-SKU-${i}`}, 100, 200, 250, 10, ${now})`;
      }

      await tx.$executeRaw`INSERT INTO "customers" (id, "customerCode", name, phone, "updatedAt") VALUES ('vc_cust', 'VC001', 'Verify Cust', '9990000001', ${now})`;

      const emp = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "employees" LIMIT 1`;
      const empId = emp[0]?.id;
      if (empId === undefined) throw new Error("no employee row to reference — seed the DB first");

      // Sales: two COMPLETED for v1, one COMPLETED for v2, one VOIDED for v4.
      const sales: Array<[string, string, string, Date]> = [
        ["vc_s1", "VC-S1", "COMPLETED", now],
        ["vc_s2", "VC-S2", "COMPLETED", now],
        ["vc_s3", "VC-S3", "COMPLETED", now],
        ["vc_s4", "VC-S4", "CANCELLED", now],
        ["vc_s5", "VC-S5", "COMPLETED", old], // outside the window
      ];
      for (const [id, num, status, date] of sales) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "sales" (id, "saleNumber", "customerId", "employeeId", subtotal, "grandTotal", status, "saleDate", "updatedAt")
           VALUES ($1, $2, 'vc_cust', $3, 200, 200, $4::"SaleStatus", $5, $6)`,
          id, num, empId, status, date, now
        );
      }

      const items: Array<[string, string, string, number]> = [
        ["vc_si1", "vc_s1", "vc_v1", 3],
        ["vc_si2", "vc_s2", "vc_v1", 4], // v1 has TWO sales → fan-out risk
        ["vc_si3", "vc_s3", "vc_v2", 5],
        ["vc_si4", "vc_s4", "vc_v4", 9], // CANCELLED — must be excluded
        ["vc_si5", "vc_s5", "vc_v4", 7], // out of window — must be excluded
      ];
      for (const [id, saleId, variantId, qty] of items) {
        await tx.$executeRaw`
          INSERT INTO "sale_items"
            (id, "saleId", "variantId", "productName", "sizeName", "colorName", sku, quantity, "sellingPrice", "costAtSale", "totalPrice")
          VALUES (${id}, ${saleId}, ${variantId}, 'VerifyProduct', 'VerifySize', 'VerifyColor', 'VC-SKU', ${qty}, 200, 100, ${qty * 200})`;
      }

      // Exchanges: e1 COMPLETED with TWO return rows for v1 (fan-out risk) and
      // one issued row; e2 CANCELLED, so its rows must be excluded entirely.
      for (const [id, num, status] of [
        ["vc_e1", "VC-E1", "COMPLETED"],
        ["vc_e2", "VC-E2", "CANCELLED"],
      ] as Array<[string, string, string]>) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "exchanges"
             (id, "exchangeNumber", "originalSaleId", "customerId", "employeeId",
              "returnedValue", "issuedValue", "priceDifference", status, "exchangeDate", "updatedAt")
           VALUES ($1, $2, 'vc_s1', 'vc_cust', $3, 100, 100, 0, $4::"ExchangeStatus", $5, $6)`,
          id, num, empId, status, now, now
        );
      }

      for (const [id, exId, variantId, qty] of [
        ["vc_ri1", "vc_e1", "vc_v1", 2],
        ["vc_ri2", "vc_e1", "vc_v1", 3], // second row, same variant+exchange
        ["vc_ri3", "vc_e2", "vc_v2", 8], // CANCELLED — must be excluded
      ] as Array<[string, string, string, number]>) {
        await tx.$executeRaw`
          INSERT INTO "exchange_return_items" (id, "exchangeId", "variantId", quantity, "priceAtSale", "totalValue")
          VALUES (${id}, ${exId}, ${variantId}, ${qty}, 200, ${qty * 200})`;
      }

      for (const [id, exId, variantId, qty] of [
        ["vc_ii1", "vc_e1", "vc_v2", 1],
        ["vc_ii2", "vc_e2", "vc_v2", 6], // CANCELLED — must be excluded
      ] as Array<[string, string, string, number]>) {
        await tx.$executeRaw`
          INSERT INTO "exchange_issued_items" (id, "exchangeId", "variantId", quantity, "sellingPrice", "totalValue")
          VALUES (${id}, ${exId}, ${variantId}, ${qty}, 200, ${qty * 200})`;
      }

      // Movements: two for v1 (MAX must pick the later), none for v3 (NULL).
      for (const [id, variantId, when] of [
        ["vc_m1", "vc_v1", old],
        ["vc_m2", "vc_v1", now],
        ["vc_m3", "vc_v2", now],
      ] as Array<[string, string, Date]>) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "inventory_movements"
             (id, "variantId", type, "quantityChanged", "stockBefore", "stockAfter", "employeeId", "createdAt")
           VALUES ($1, $2, 'SALE'::"MovementType", -1, 10, 9, $3, $4)`,
          id, variantId, empId, when
        );
      }

      const since = new Date();
      since.setFullYear(since.getFullYear() - 5);
      const onlyFixture = Prisma.sql`WHERE v.id LIKE 'vc_v%'`;

      console.log("Comparing LATERAL vs grouped-subquery on the fixture:\n");

      // ── 1. productReport: exchange return/issue units per variant ─────────
      {
        const lateral = await tx.$queryRaw<Row[]>`
          SELECT v.id AS "variantId",
                 COALESCE(ret.units, 0) AS "returnedUnits",
                 COALESCE(exc.units, 0) AS "exchangedUnits"
            FROM "product_variants" v
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(ri.quantity), 0) AS units
                FROM "exchange_return_items" ri
                JOIN "exchanges" e ON e.id = ri."exchangeId"
               WHERE ri."variantId" = v.id AND e.status = 'COMPLETED'
            ) ret ON TRUE
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(ii.quantity), 0) AS units
                FROM "exchange_issued_items" ii
                JOIN "exchanges" e ON e.id = ii."exchangeId"
               WHERE ii."variantId" = v.id AND e.status = 'COMPLETED'
            ) exc ON TRUE
            ${onlyFixture}
           ORDER BY v.id`;

        const grouped = await tx.$queryRaw<Row[]>`
          SELECT v.id AS "variantId",
                 COALESCE(ret.units, 0) AS "returnedUnits",
                 COALESCE(exc.units, 0) AS "exchangedUnits"
            FROM "product_variants" v
            LEFT JOIN (
              SELECT ri."variantId" AS "variantId", SUM(ri.quantity) AS units
                FROM "exchange_return_items" ri
                JOIN "exchanges" e ON e.id = ri."exchangeId"
               WHERE e.status = 'COMPLETED'
               GROUP BY ri."variantId"
            ) ret ON ret."variantId" = v.id
            LEFT JOIN (
              SELECT ii."variantId" AS "variantId", SUM(ii.quantity) AS units
                FROM "exchange_issued_items" ii
                JOIN "exchanges" e ON e.id = ii."exchangeId"
               WHERE e.status = 'COMPLETED'
               GROUP BY ii."variantId"
            ) exc ON exc."variantId" = v.id
            ${onlyFixture}
           ORDER BY v.id`;

        diff("productReport exchange units", lateral, grouped);
        console.log(`    (fixture: ${preview(lateral)})`);
      }

      // ── 2. velocity: units sold in-window + last movement ─────────────────
      {
        const lateral = await tx.$queryRaw<Row[]>`
          SELECT v.id AS "variantId", sold.units, mv.last_at AS "lastAt"
            FROM "product_variants" v
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(si.quantity), 0) AS units
                FROM "sale_items" si
                JOIN "sales" s ON s.id = si."saleId"
               WHERE si."variantId" = v.id AND s.status = 'COMPLETED' AND s."saleDate" >= ${since}
            ) sold ON TRUE
            LEFT JOIN LATERAL (
              SELECT MAX(im."createdAt") AS last_at
                FROM "inventory_movements" im WHERE im."variantId" = v.id
            ) mv ON TRUE
            ${onlyFixture}
           ORDER BY v.id`;

        const grouped = await tx.$queryRaw<Row[]>`
          SELECT v.id AS "variantId",
                 COALESCE(sold.units, 0) AS units,
                 mv.last_at AS "lastAt"
            FROM "product_variants" v
            LEFT JOIN (
              SELECT si."variantId" AS "variantId", SUM(si.quantity) AS units
                FROM "sale_items" si
                JOIN "sales" s ON s.id = si."saleId"
               WHERE s.status = 'COMPLETED' AND s."saleDate" >= ${since}
               GROUP BY si."variantId"
            ) sold ON sold."variantId" = v.id
            LEFT JOIN (
              SELECT im."variantId" AS "variantId", MAX(im."createdAt") AS last_at
                FROM "inventory_movements" im GROUP BY im."variantId"
            ) mv ON mv."variantId" = v.id
            ${onlyFixture}
           ORDER BY v.id`;

        diff("velocity units + lastMovement", lateral, grouped);
        console.log(`    (fixture: ${preview(lateral)})`);
      }

      // ── 3. exchange report: units per exchange ────────────────────────────
      {
        const onlyEx = Prisma.sql`WHERE e.id LIKE 'vc_e%'`;
        const lateral = await tx.$queryRaw<Row[]>`
          SELECT e.id AS "exchangeId",
                 COALESCE(ri.units, 0) AS "returnedUnits",
                 COALESCE(ii.units, 0) AS "issuedUnits"
            FROM "exchanges" e
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(x.quantity), 0) AS units
                FROM "exchange_return_items" x WHERE x."exchangeId" = e.id
            ) ri ON TRUE
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(x.quantity), 0) AS units
                FROM "exchange_issued_items" x WHERE x."exchangeId" = e.id
            ) ii ON TRUE
            ${onlyEx}
           ORDER BY e.id`;

        const grouped = await tx.$queryRaw<Row[]>`
          SELECT e.id AS "exchangeId",
                 COALESCE(ri.units, 0) AS "returnedUnits",
                 COALESCE(ii.units, 0) AS "issuedUnits"
            FROM "exchanges" e
            LEFT JOIN (
              SELECT x."exchangeId" AS "exchangeId", SUM(x.quantity) AS units
                FROM "exchange_return_items" x GROUP BY x."exchangeId"
            ) ri ON ri."exchangeId" = e.id
            LEFT JOIN (
              SELECT x."exchangeId" AS "exchangeId", SUM(x.quantity) AS units
                FROM "exchange_issued_items" x GROUP BY x."exchangeId"
            ) ii ON ii."exchangeId" = e.id
            ${onlyEx}
           ORDER BY e.id`;

        diff("exchange report units", lateral, grouped);
        console.log(`    (fixture: ${preview(lateral)})`);
      }

      // ── The negative control ──────────────────────────────────────────────
      // Proves the harness can actually SEE a difference. Without this, a
      // comparison that silently passes everything looks identical to a
      // correct result. COALESCE left in the subquery instead of the outer
      // select is the exact mistake this rewrite invites — case 1 above.
      {
        const correct = await tx.$queryRaw<Row[]>`
          SELECT v.id AS "variantId", COALESCE(sold.units, 0) AS units
            FROM "product_variants" v
            LEFT JOIN (
              SELECT si."variantId" AS "variantId", SUM(si.quantity) AS units
                FROM "sale_items" si JOIN "sales" s ON s.id = si."saleId"
               WHERE s.status = 'COMPLETED' GROUP BY si."variantId"
            ) sold ON sold."variantId" = v.id
            ${onlyFixture} ORDER BY v.id`;

        const buggy = await tx.$queryRaw<Row[]>`
          SELECT v.id AS "variantId", sold.units AS units
            FROM "product_variants" v
            LEFT JOIN (
              SELECT si."variantId" AS "variantId", COALESCE(SUM(si.quantity), 0) AS units
                FROM "sale_items" si JOIN "sales" s ON s.id = si."saleId"
               WHERE s.status = 'COMPLETED' GROUP BY si."variantId"
            ) sold ON sold."variantId" = v.id
            ${onlyFixture} ORDER BY v.id`;

        const before = failures.length;
        diff("NEGATIVE CONTROL (must FAIL)", correct, buggy);
        if (failures.length === before) {
          failures.push("NEGATIVE CONTROL did not fail — the harness cannot detect a real difference");
          console.log("  ✗ NEGATIVE CONTROL PASSED — harness is not actually comparing!");
        } else {
          failures.pop(); // expected failure; not a real one
          console.log("    ↑ expected: proves the harness detects the COALESCE mistake");
        }
      }

      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if ((e as Error).message !== ROLLBACK) throw e;
  }

  console.log("\nFixture rolled back — database unchanged.");
  console.log(
    failures.length === 0
      ? "\n✓ ALL FORMS EQUIVALENT on data containing empty keys, duplicate keys,\n  filtered-out rows and NULL aggregates."
      : `\n✗ ${failures.length} DIVERGENCE(S) — do not merge:\n  ${failures.join("\n  ")}`
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

void main();
