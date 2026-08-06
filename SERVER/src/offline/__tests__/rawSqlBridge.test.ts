// =============================================================================
// RAW SQL BRIDGE — CALL SHAPES
//
// The dialect translator was always correct; what broke was the WIRING. Prisma
// hands a query extension the `Sql` object wrapped in a single-element array,
// and the bridge recognized only the bare object and the positional
// `[string, ...params]` form. An array containing a `Sql` matched neither, so
// every tagged-template raw query fell through to a WARN and ran against SQLite
// as untranslated Postgres.
//
// That is why these tests assert on the SHAPE the bridge returns rather than
// only on the translated text: `sqlDialect.test.ts` already proves the SQL is
// right, and it passed throughout — the defect was entirely in dispatch.
//
// Two properties are load-bearing and each has a test that fails loudly if lost:
//
//   1. The array-wrapped shape is translated at all.
//   2. The returned object keeps `Sql`'s PROTOTYPE. `sql`, `statement` and
//      `text` are getters derived from `strings`; a plain `{...args}` copy loses
//      them and the driver rejects it the same way it rejected the bug.
// =============================================================================

import { describe, expect, it } from "vitest";

import { __testing } from "../datasource/rawSqlBridge";

const { translateArgs } = __testing;

/**
 * A stand-in for Prisma's `Sql`, carrying the property that actually matters:
 * `sql` is a GETTER derived from `strings`, not stored text. Anything that
 * rebuilds the object without its prototype loses this.
 */
class FakeSql {
  constructor(
    public strings: string[],
    public values: unknown[]
  ) {}

  get sql(): string {
    return this.strings.join("?");
  }
}

/** Postgres-only constructs, so `needsTranslation` is guaranteed true. */
const PG_FRAGMENTS = [
  'UPDATE "t" SET "d" = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (',
  '::timestamp - "loginAt")) / 60)::int) WHERE "id" = ',
  "",
];

describe("translateArgs — array-wrapped tagged template ([Sql])", () => {
  it("translates it instead of passing Postgres through untouched", () => {
    const args = [new FakeSql([...PG_FRAGMENTS], [new Date(), "emp-1"])];

    const out = translateArgs(args, "$executeRaw") as [FakeSql];

    expect(Array.isArray(out)).toBe(true);
    const sql = out[0].sql;

    // The three Postgres-only constructs must all be gone.
    expect(sql).not.toMatch(/GREATEST/i);
    expect(sql).not.toMatch(/EXTRACT\s*\(\s*EPOCH/i);
    expect(sql).not.toMatch(/::/);

    // ...and replaced by their SQLite equivalents.
    expect(sql).toMatch(/max\s*\(/i);
    expect(sql).toMatch(/julianday/i);
  });

  it("preserves the Sql prototype, so the `sql` getter still works", () => {
    const args = [new FakeSql([...PG_FRAGMENTS], [new Date(), "emp-1"])];

    const out = translateArgs(args, "$executeRaw") as [FakeSql];

    // The regression that motivated this file: a spread copy is a plain object,
    // the getter is gone, and the driver throws "Expected first argument to be
    // a string" — with no hint that translation was ever involved.
    expect(out[0]).toBeInstanceOf(FakeSql);
    expect(typeof out[0].sql).toBe("string");
  });

  it("keeps the placeholder count, so values still bind in order", () => {
    const values = [new Date(), "emp-1"];
    const args = [new FakeSql([...PG_FRAGMENTS], values)];

    const out = translateArgs(args, "$executeRaw") as [FakeSql];

    // One fragment per gap between placeholders, unchanged.
    expect(out[0].strings.length).toBe(PG_FRAGMENTS.length);
    expect(out[0].values).toEqual(values);
  });

  it("returns the identical array when nothing needs translating", () => {
    const args = [new FakeSql(['SELECT 1 FROM "t" WHERE "id" = ', ""], ["x"])];

    // Not merely equal — the SAME array, so the common path stays allocation-free.
    expect(translateArgs(args, "$queryRaw")).toBe(args);
  });
});

describe("translateArgs — the shapes that already worked", () => {
  it("still translates a bare tagged template", () => {
    const args = new FakeSql([...PG_FRAGMENTS], [new Date(), "emp-1"]);

    const out = translateArgs(args, "$executeRaw") as FakeSql;

    expect(out.sql).toMatch(/julianday/i);
    expect(out.sql).not.toMatch(/EXTRACT/i);
  });

  it("still translates the positional $queryRawUnsafe form", () => {
    const args = ['SELECT GREATEST(0, "a") FROM "t" WHERE "id" = $1', "x"];

    const out = translateArgs(args, "$queryRawUnsafe") as [string, string];

    expect(out[0]).toMatch(/max\s*\(/i);
    expect(out[1]).toBe("x");
  });
});
