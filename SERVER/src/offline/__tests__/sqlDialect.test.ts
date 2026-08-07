// =============================================================================
// SQL DIALECT TRANSLATION
//
// These queries compute revenue, margins, stock valuation and payroll. The
// property under test is therefore not "does it produce SQLite syntax" but
// "does it produce the SAME NUMBER". So the assertions run the translated SQL
// against a real SQLite database and compare results, rather than comparing
// strings — a string assertion would happily pass on a translation that parses
// and silently computes something else.
//
// The refusal cases matter just as much: a construct with no safe translation
// must throw, because a wrong total gets banked and an error gets fixed.
// =============================================================================

import Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";

import {
  assertTranslatable,
  needsTranslation,
  translateCasts,
  translateSql,
} from "../datasource/sqlDialect";

let db: Database.Database;

beforeAll(() => {
  db = new Database(":memory:");

  db.exec(`
    CREATE TABLE m (
      "variantId" TEXT, "quantityChanged" INTEGER,
      "createdAt" TEXT, "type" TEXT
    );
    INSERT INTO m VALUES
      ('v1',  5, '2026-08-01 10:00:00', 'PURCHASE'),
      ('v1', -2, '2026-08-01 11:00:00', 'SALE'),
      ('v2',  7, '2026-08-02 09:00:00', 'PURCHASE'),
      ('v2', -9, '2026-08-02 12:00:00', 'SALE');

    CREATE TABLE lh ("loginAt" TEXT, "durationMinutes" INTEGER);
    INSERT INTO lh VALUES ('2026-08-05 08:00:00', NULL), ('2026-08-05 06:30:00', NULL);

    CREATE TABLE p ("dueDate" TEXT, amt REAL);
    INSERT INTO p VALUES
      ('2026-08-01', 100), ('2026-07-01', 200),
      ('2026-06-01', 300), ('2026-04-01', 400);
  `);
});

function run<T = Record<string, unknown>>(sql: string): T[] {
  return db.prepare(translateSql(sql)).all() as T[];
}

// =============================================================================
// CASTS
// =============================================================================

describe("cast translation", () => {
  it("casts an aggregate expression, not just its closing paren", () => {
    const rows = run<{ total: number }>(
      `SELECT COALESCE(SUM(m."quantityChanged"), 0)::bigint AS total FROM m`
    );

    expect(rows[0]?.total).toBe(1);
  });

  it("casts a qualified quoted column", () => {
    const rows = run<{ q: number }>(
      `SELECT m."quantityChanged"::numeric AS q FROM m WHERE m."variantId" = 'v2'`
    );

    expect(rows.map((r) => r.q)).toEqual([7, -9]);
  });

  it("does NOT swallow the alias after the type", () => {
    // The original bug: the type pattern allowed spaces, so `)::bigint AS total`
    // captured "bigint AS total", failed the type lookup, skipped the cast
    // entirely and left a bare `::` for SQLite to reject.
    const translated = translateCasts(
      `SELECT COUNT(*)::bigint AS total FROM m`
    );

    expect(translated).toContain("AS total");
    expect(translated).not.toContain("::");
  });

  it("unwinds a chained cast from the inside out", () => {
    // Right-to-left rewriting produced `CAST(bigint AS TEXT)` here — the outer
    // cast took the inner cast's TYPE NAME as its expression.
    const rows = run<{ c: string }>(`SELECT COUNT(*)::bigint::text AS c FROM m`);

    expect(rows[0]?.c).toBe("4");
  });

  it("casts a string literal operand", () => {
    const rows = run<{ d: string }>(`SELECT '2026-08-01'::text AS d`);

    expect(rows[0]?.d).toBe("2026-08-01");
  });

  it("casts an aggregate together with its FILTER clause", () => {
    // The FILTER parens look like an ordinary parenthesized group to the
    // backward scan, so the cast wrapped only them and emitted
    // `COUNT(*) FILTER CAST((WHERE …) AS INTEGER)` — SQLite rejected it with
    // "near CAST: syntax error", which is what 500'd the inventory dashboard
    // for every offline (SQLite) request.
    const rows = run<{ inflow: number; outflow: number }>(`
      SELECT
        COALESCE(SUM(m."quantityChanged") FILTER (WHERE m."quantityChanged" > 0), 0)::bigint AS inflow,
        COALESCE(ABS(SUM(m."quantityChanged") FILTER (WHERE m."quantityChanged" < 0)), 0)::bigint AS outflow
      FROM m
    `);

    expect(rows[0]).toEqual({ inflow: 12, outflow: 11 });
  });

  it("casts COUNT(*) FILTER over a multi-condition predicate", () => {
    const rows = run<{ n: number }>(`
      SELECT COUNT(*) FILTER (
        WHERE m."quantityChanged" > 0
          AND m."type" = 'PURCHASE'
      )::bigint AS n
      FROM m
    `);

    expect(rows[0]?.n).toBe(2);
  });

  it("leaves an unrecognized type alone rather than guessing", () => {
    // It will fail at the database, which is the correct outcome — silently
    // inventing a mapping is how a money column becomes a float.
    expect(translateCasts(`SELECT x::hstore FROM m`)).toContain("::hstore");
  });
});

// =============================================================================
// FUNCTIONS
// =============================================================================

describe("function translation", () => {
  it("maps GREATEST to SQLite's scalar max()", () => {
    const rows = run<{ g: number }>(
      `SELECT GREATEST(m."quantityChanged", 0) AS g FROM m ORDER BY m."createdAt"`
    );

    expect(rows.map((r) => r.g)).toEqual([5, 0, 7, 0]);
  });

  it("maps LEAST to min()", () => {
    const rows = run<{ l: number }>(
      `SELECT LEAST(m."quantityChanged", 0) AS l FROM m ORDER BY m."createdAt"`
    );

    expect(rows.map((r) => r.l)).toEqual([0, -2, 0, -9]);
  });

  it("does not rewrite a genuine MAX() aggregate into a scalar", () => {
    const rows = run<{ m: number }>(`SELECT MAX(m."quantityChanged") AS m FROM m`);

    expect(rows[0]?.m).toBe(7);
  });

  it("maps ILIKE to LIKE, which SQLite already treats case-insensitively", () => {
    const rows = run(`SELECT * FROM m WHERE m."variantId" ILIKE 'V1'`);

    expect(rows).toHaveLength(2);
  });
});

// =============================================================================
// DATE_TRUNC
// =============================================================================

describe("DATE_TRUNC translation", () => {
  it("groups by day exactly as Postgres would", () => {
    const rows = run<{ day: string; n: number }>(`
      SELECT DATE_TRUNC('day', m."createdAt") AS day, COUNT(*) AS n
      FROM m GROUP BY 1 ORDER BY 1
    `);

    expect(rows).toEqual([
      { day: "2026-08-01 00:00:00", n: 2 },
      { day: "2026-08-02 00:00:00", n: 2 },
    ]);
  });

  it("keeps a full timestamp so ordering matches the Postgres original", () => {
    // Truncating to a bare 'YYYY-MM-DD' would sort shorter strings against
    // longer ones elsewhere in the same query.
    const rows = run<{ day: string }>(
      `SELECT DATE_TRUNC('month', m."createdAt") AS day FROM m LIMIT 1`
    );

    expect(rows[0]?.day).toBe("2026-08-01 00:00:00");
  });

  it("refuses a unit it cannot express rather than approximating", () => {
    expect(() => translateSql(`SELECT DATE_TRUNC('week', x) FROM m`)).toThrow(
      /no SQLite translation/i
    );
  });
});

// =============================================================================
// TIME ARITHMETIC
// =============================================================================

describe("EXTRACT(EPOCH …) translation", () => {
  it("computes the same minute count as Postgres", () => {
    db.exec(
      translateSql(
        `UPDATE lh SET "durationMinutes" =
           GREATEST(0, ROUND(EXTRACT(EPOCH FROM ('2026-08-05 10:00:00'::timestamp - "loginAt")) / 60)::int)`
      )
    );

    const rows = db
      .prepare(`SELECT "durationMinutes" AS d FROM lh ORDER BY "loginAt"`)
      .all() as Array<{ d: number }>;

    // 06:30 → 10:00 is 210 minutes; 08:00 → 10:00 is 120.
    expect(rows.map((r) => r.d)).toEqual([210, 120]);
  });

  it("refuses a non-difference argument", () => {
    expect(() =>
      translateSql(`SELECT EXTRACT(EPOCH FROM (now())) FROM m`)
    ).toThrow(/not a simple difference/i);
  });

  it("refuses EXTRACT of a field other than EPOCH", () => {
    expect(() => assertTranslatable(`SELECT EXTRACT(YEAR FROM x) FROM m`)).toThrow(
      /no safe SQLite translation/i
    );
  });
});

describe("INTERVAL translation", () => {
  it("produces the same ageing buckets as the Postgres original", () => {
    const rows = run<{ d0: number; d31: number; d90: number }>(`
      SELECT
        COALESCE((SELECT SUM(amt) FROM p
                  WHERE p."dueDate" >= '2026-08-05'::timestamp - INTERVAL '30 days'), 0)::numeric AS d0,
        COALESCE((SELECT SUM(amt) FROM p
                  WHERE p."dueDate" <  '2026-08-05'::timestamp - INTERVAL '30 days'
                    AND p."dueDate" >= '2026-08-05'::timestamp - INTERVAL '60 days'), 0)::numeric AS d31,
        COALESCE((SELECT SUM(amt) FROM p
                  WHERE p."dueDate" <  '2026-08-05'::timestamp - INTERVAL '90 days'), 0)::numeric AS d90
    `);

    // Aug 1 → 0-30 days. Jul 1 → 31-60. Apr 1 → 90+.
    expect(rows[0]).toEqual({ d0: 100, d31: 200, d90: 400 });
  });

  it("takes the whole cast expression as the operand, not just the type name", () => {
    // The original bug produced `'2026-08-05'::datetime(timestamp, '-30 days')`
    // — the scan stopped at the bare identifier `timestamp`.
    const translated = translateSql(`SELECT '2026-08-05'::timestamp - INTERVAL '30 days' AS d`);

    expect(translated).toContain("datetime(CAST('2026-08-05' AS TEXT), '-30 days')");
  });

  it("refuses an unsupported interval unit", () => {
    expect(() =>
      translateSql(`SELECT x - INTERVAL '2 fortnights' FROM m`)
    ).toThrow(/no SQLite translation/i);
  });
});

// =============================================================================
// UNTOUCHED CONSTRUCTS
// =============================================================================

describe("constructs modern SQLite already supports", () => {
  it("leaves FILTER on an aggregate alone and computes it correctly", () => {
    const rows = run<{ inQty: number; outQty: number }>(`
      SELECT
        COALESCE(SUM(m."quantityChanged") FILTER (WHERE m."quantityChanged" > 0), 0)::bigint AS "inQty",
        COALESCE(ABS(SUM(m."quantityChanged") FILTER (WHERE m."quantityChanged" < 0)), 0)::bigint AS "outQty"
      FROM m
    `);

    expect(rows[0]).toEqual({ inQty: 12, outQty: 11 });
  });

  it("leaves window functions alone", () => {
    const rows = run<{ variantId: string; rn: number }>(`
      SELECT m."variantId",
             ROW_NUMBER() OVER (PARTITION BY m."variantId" ORDER BY m."createdAt" DESC) AS rn
      FROM m
    `);

    expect(rows.filter((r) => r.rn === 1)).toHaveLength(2);
  });

  it("skips translation entirely for plain ANSI SQL", () => {
    expect(needsTranslation(`SELECT COUNT(*) FROM m WHERE "type" = 'SALE'`)).toBe(false);
  });
});

// =============================================================================
// REFUSALS
// =============================================================================

describe("refusals", () => {
  it.each([
    ["DISTINCT ON", `SELECT DISTINCT ON (m."variantId") m."variantId" FROM m`],
    ["= ANY(array)", `SELECT * FROM m WHERE m."variantId" = ANY($1::text[])`],
    ["generate_series", `SELECT * FROM generate_series(1, 10)`],
    [
      "LATERAL join",
      `SELECT c.id, agg.total FROM "customers" c
         LEFT JOIN LATERAL (
           SELECT SUM(s."grandTotal") AS total FROM "sales" s WHERE s."customerId" = c.id
         ) agg ON true`,
    ],
    ["trigram similarity", `SELECT similarity(a, b) FROM m`],
    ["array cast", `SELECT $1::text[] FROM m`],
  ])("refuses %s with an actionable message", (_name, sql) => {
    let thrown: Error | undefined;

    try {
      assertTranslatable(sql);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    // The message must say what to do, not merely that something is wrong —
    // whoever hits this has 63 raw queries to search through otherwise.
    expect(thrown?.message).toMatch(/Fix:/);
  });

  it("accepts the grouped-subquery form that replaces a LATERAL", () => {
    // The counterpart to the refusal above: the rewrite the error message tells
    // you to make must actually pass. Without this, the guidance could send
    // someone toward a form that trips a different rule.
    //
    // This is the shape customer.repository.ts now uses — pre-aggregate by the
    // join key, LEFT JOIN on it, COALESCE in the outer select.
    expect(() =>
      assertTranslatable(`
        SELECT c.id, COALESCE(agg."totalSpend", 0) AS "totalSpend"
          FROM "customers" c
          LEFT JOIN (
            SELECT s."customerId" AS "customerId", SUM(s."grandTotal") AS "totalSpend"
              FROM "sales" s
             WHERE s."status" = 'COMPLETED'
             GROUP BY s."customerId"
          ) agg ON agg."customerId" = c.id
      `)
    ).not.toThrow();
  });

  it("refuses BEFORE translating, so nothing is half-rewritten", () => {
    // A partially translated statement that happens to parse is the worst
    // possible outcome: it runs and returns a different number.
    expect(() =>
      translateSql(`SELECT DISTINCT ON (a) GREATEST(a, 0)::bigint FROM m`)
    ).toThrow(/DISTINCT ON/);
  });
});
