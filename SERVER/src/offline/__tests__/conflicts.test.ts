// =============================================================================
// CONFLICT RESOLUTION
//
// The rules are deterministic and clock-free by design, so these tests assert
// that identity: nowhere below does a timestamp decide an outcome. A till's
// clock is whatever someone set it to, and last-write-wins would let it
// overrule head office silently.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  describeDifferences,
  hasMeaningfulDifference,
  resolveDownloadConflict,
  resolveUploadConflict,
} from "../sync/conflicts";
import { requirePolicy } from "../sync/policy";

const PRODUCT = requirePolicy("Product"); // cloud-authoritative
const SALE = requirePolicy("Sale"); // local-authoritative
const CUSTOMER = requirePolicy("Customer"); // bidirectional, cloud wins

// =============================================================================
// DOWNLOAD
// =============================================================================

describe("resolveDownloadConflict", () => {
  it("is not a conflict when there is no local row", () => {
    const decision = resolveDownloadConflict(PRODUCT, null, { id: "p1", name: "Tee" });

    expect(decision.winner).toBe("CLOUD");
    expect(decision.logged).toBe(false);
  });

  it("is not a conflict when the rows are identical", () => {
    const row = { id: "p1", name: "Tee", sellingPrice: "199.00" };
    const decision = resolveDownloadConflict(PRODUCT, { ...row }, row);

    expect(decision.logged).toBe(false);
  });

  it("lets the cloud replace a differing local catalog row, and logs it", () => {
    const decision = resolveDownloadConflict(
      PRODUCT,
      { id: "p1", name: "Tee", gstRate: "5.00" },
      { id: "p1", name: "Tee", gstRate: "12.00" }
    );

    expect(decision.winner).toBe("CLOUD");
    // A manager who changed this on the till this morning must be able to find
    // out where it went.
    expect(decision.logged).toBe(true);
  });

  it("keeps the till's version of an event the cloud echoes back", () => {
    const decision = resolveDownloadConflict(
      SALE,
      { id: "s1", totalAmount: "500.00" },
      { id: "s1", totalAmount: "450.00" }
    );

    expect(decision.winner).toBe("LOCAL");
    expect(decision.logged).toBe(true);
  });

  it("ignores updatedAt when deciding whether anything changed", () => {
    // Otherwise every re-download of an untouched row is reported as a
    // conflict and the log fills with noise nobody can triage.
    const decision = resolveDownloadConflict(
      PRODUCT,
      { id: "p1", name: "Tee", updatedAt: "2026-08-01T00:00:00Z" },
      { id: "p1", name: "Tee", updatedAt: "2026-08-05T00:00:00Z" }
    );

    expect(decision.logged).toBe(false);
  });
});

// =============================================================================
// UPLOAD
// =============================================================================

describe("resolveUploadConflict", () => {
  it("inserts an UPDATE for a row the cloud has never seen", () => {
    // Routine, not an error: the CREATE may be later in the same batch, or an
    // earlier batch's response was lost. Refusing would discard a real sale
    // because its paperwork arrived out of order.
    const decision = resolveUploadConflict({
      policy: SALE,
      cloudRow: null,
      localRow: { id: "s1", totalAmount: "500.00" },
      operation: "UPDATE",
    });

    expect(decision.winner).toBe("LOCAL");
    expect(decision.logged).toBe(false);
  });

  it("treats a DELETE of an absent row as a no-op, not a failure", () => {
    const decision = resolveUploadConflict({
      policy: SALE,
      cloudRow: null,
      localRow: { id: "s1" },
      operation: "DELETE",
    });

    expect(decision.winner).toBe("LOCAL");
  });

  it("accepts the till's version of an event that already exists centrally", () => {
    const decision = resolveUploadConflict({
      policy: SALE,
      cloudRow: { id: "s1", totalAmount: "450.00" },
      localRow: { id: "s1", totalAmount: "500.00" },
      operation: "UPDATE",
    });

    expect(decision.winner).toBe("LOCAL");
  });

  it("keeps the cloud's customer record when both sides changed it", () => {
    // Head office merging duplicates must not be undone by a till that edited
    // a phone number.
    const decision = resolveUploadConflict({
      policy: CUSTOMER,
      cloudRow: { id: "c1", name: "A Sharma", phone: "9000000000" },
      localRow: { id: "c1", name: "A Sharma", phone: "9111111111" },
      operation: "UPDATE",
    });

    expect(decision.winner).toBe("CLOUD");
    expect(decision.logged).toBe(true);
  });

  it("does not log when an upload matches what the cloud already has", () => {
    const row = { id: "c1", name: "A Sharma", phone: "9000000000" };
    const decision = resolveUploadConflict({
      policy: CUSTOMER,
      cloudRow: { ...row },
      localRow: row,
      operation: "UPDATE",
    });

    expect(decision.logged).toBe(false);
  });
});

// =============================================================================
// COMPARISON
// =============================================================================

describe("hasMeaningfulDifference", () => {
  it("treats 12.50 and 12.5 as the same money", () => {
    // Postgres NUMERIC and SQLite REAL render differently. Flagging that as a
    // conflict would make every price row conflict on every sync.
    expect(hasMeaningfulDifference({ price: "12.50" }, { price: 12.5 })).toBe(false);
  });

  it("treats a Date and its ISO string as equal", () => {
    const when = new Date("2026-08-05T10:00:00.000Z");

    expect(
      hasMeaningfulDifference({ saleDate: when }, { saleDate: when.toISOString() })
    ).toBe(false);
  });

  it("treats null and undefined as the same absence", () => {
    expect(hasMeaningfulDifference({ note: null }, { note: undefined })).toBe(false);
  });

  it("detects a real change", () => {
    expect(hasMeaningfulDifference({ price: "12.50" }, { price: "13.00" })).toBe(true);
  });

  it("ignores columns absent from the other side", () => {
    // A partial projection must not read as "every other column was deleted".
    expect(hasMeaningfulDifference({ id: "1" }, { id: "1", extra: "x" })).toBe(false);
  });

  it("compares Prisma Decimal-like objects by value", () => {
    const decimalLike = { toString: () => "199.00", toFixed: () => "199.00" };

    expect(hasMeaningfulDifference({ amount: decimalLike }, { amount: "199.00" })).toBe(false);
  });
});

describe("describeDifferences", () => {
  it("reports only the fields that actually differ", () => {
    const diff = describeDifferences(
      { id: "p1", name: "Tee", price: "10.00", updatedAt: "x" },
      { id: "p1", name: "Tee", price: "12.00", updatedAt: "y" }
    );

    expect(Object.keys(diff)).toEqual(["price"]);
    expect(diff["price"]).toEqual({ local: "10.00", cloud: "12.00" });
  });

  it("returns nothing for identical rows", () => {
    expect(describeDifferences({ a: 1 }, { a: 1 })).toEqual({});
  });
});
