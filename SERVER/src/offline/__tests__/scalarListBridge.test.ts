// =============================================================================
// SCALAR LIST BRIDGE — ARGUMENT WALKING
//
// The bridge rewrites `imageUrls` / `workingDays` anywhere in a Prisma args
// tree. To do that it walks the tree, and anything it walks into it may rebuild
// with `{ ...source }`.
//
// That is safe for plain objects and catastrophic for values whose identity
// lives in their prototype. `Prisma.Decimal` is the case that actually broke a
// till: it holds its digits in own ENUMERABLE properties, so spreading one
// yields a plain `{constructor, s, e, d}` and Prisma refuses the write with
// "Invalid value for argument `constructor`". Opening a cash register carries a
// Decimal, and a till that cannot open a register cannot sell.
//
// These tests are about that class of bug, not about the two field names.
// =============================================================================

import { describe, expect, it } from "vitest";

import { Prisma } from "../../../generated/prisma";
import { __testing } from "../datasource/scalarListBridge";

const { encodeArgs, decodeResult } = __testing;

describe("scalarListBridge — values that must survive the walk", () => {
  it("passes a Decimal through by reference, preserving its prototype", () => {
    const amount = new Prisma.Decimal("5000.50");
    const args = { data: { openingBalance: amount, registerNumber: "REG-01" } };

    const encoded = encodeArgs(args) as typeof args;

    expect(encoded.data.openingBalance).toBe(amount);
    expect(encoded.data.openingBalance).toBeInstanceOf(Prisma.Decimal);
    expect(encoded.data.openingBalance.toString()).toBe("5000.5");
  });

  it("does not leak a `constructor` key when a Decimal is present", () => {
    // The exact failure: `{ ...decimal }` produces an own `constructor`
    // property holding a function, which Prisma cannot serialize.
    const encoded = encodeArgs({
      data: { openingBalance: new Prisma.Decimal(5000) },
    }) as { data: Record<string, unknown> };

    expect(Object.keys(encoded.data)).not.toContain("constructor");
    expect(encoded.data["openingBalance"]).toBeInstanceOf(Prisma.Decimal);
  });

  it("keeps the Decimal intact when a scalar list forces a rebuild", () => {
    // The dangerous combination: a rewritten field sits beside a Decimal, so
    // the containing object IS copied. The Decimal must still come through.
    const price = new Prisma.Decimal("199.99");
    const encoded = encodeArgs({
      data: { imageUrls: ["a.png", "b.png"], sellingPrice: price },
    }) as { data: Record<string, unknown> };

    expect(encoded.data["imageUrls"]).toBe('["a.png","b.png"]');
    expect(encoded.data["sellingPrice"]).toBe(price);
    expect(encoded.data["sellingPrice"]).toBeInstanceOf(Prisma.Decimal);
  });

  it("survives a Decimal nested inside a relation write", () => {
    const amount = new Prisma.Decimal("450.72");
    const encoded = encodeArgs({
      data: {
        saleNumber: "INV-1",
        items: { create: [{ quantity: 2, unitPrice: amount }] },
      },
    }) as { data: { items: { create: Array<Record<string, unknown>> } } };

    expect(encoded.data.items.create[0]!["unitPrice"]).toBe(amount);
  });

  it("passes Dates through untouched", () => {
    const when = new Date("2026-08-06T10:00:00.000Z");
    const encoded = encodeArgs({ data: { openedAt: when, imageUrls: [] } }) as {
      data: Record<string, unknown>;
    };

    expect(encoded.data["openedAt"]).toBe(when);
  });

  it("does not walk into a Decimal on the way back out", () => {
    const price = new Prisma.Decimal("12.50");
    const row = { id: "x", sellingPrice: price, imageUrls: '["a.png"]' };

    const decoded = decodeResult(row) as Record<string, unknown>;

    expect(decoded["sellingPrice"]).toBe(price);
    expect(decoded["sellingPrice"]).toBeInstanceOf(Prisma.Decimal);
    expect(decoded["imageUrls"]).toEqual(["a.png"]);
  });
});

describe("scalarListBridge — the encoding it exists to do", () => {
  it("encodes a scalar list to JSON text and decodes it back", () => {
    const encoded = encodeArgs({ data: { imageUrls: ["x.png"] } }) as {
      data: Record<string, unknown>;
    };
    expect(encoded.data["imageUrls"]).toBe('["x.png"]');

    const decoded = decodeResult({ imageUrls: '["x.png"]' }) as Record<string, unknown>;
    expect(decoded["imageUrls"]).toEqual(["x.png"]);
  });

  it("leaves an args object untouched when nothing needs rewriting", () => {
    const args = { where: { id: "abc" } };
    expect(encodeArgs(args)).toBe(args);
  });
});
