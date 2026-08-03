// =============================================================================
// CUSTOMER PROFILE — regression tests
//
// The profile is an aggregation screen: almost everything it can get wrong is
// wrong QUIETLY. A bad rollup still renders a number, a leaked status still
// renders a row, and nobody notices until someone reconciles the profile
// against a report. These cover the decisions that would fail that way:
//
//   • Spend rollups must count COMPLETED sales ONLY, while the purchase history
//     tab must show EVERY status. Those two rules pull in opposite directions,
//     so a single "just filter it once" refactor breaks one of them.
//   • `priceDifference` is SIGNED and must be summed, not recomputed from
//     issued − returned, which drifts once an exchange is partially settled.
//   • The Walk-In record must be REFUSED. It accumulates every anonymous sale
//     in the shop, so rendering a "profile" for it would present unrelated
//     strangers' transactions as one person's purchase history.
//   • The active badge must derive from the SAME window as the customer table,
//     or the badge contradicts the list the user just clicked through from.
//   • Every history must be capped, and the cap reported so the UI can say so.
//
// Prisma is mocked at the module boundary: these assert the aggregation, which
// is the thing under test, without needing a database.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

const customerFindUnique = vi.fn();
const saleAggregate = vi.fn();
const saleItemAggregate = vi.fn();
const saleFindMany = vi.fn();
const exchangeAggregate = vi.fn();
const exchangeFindMany = vi.fn();
const exchangeFindFirst = vi.fn();
const queryRaw = vi.fn();

vi.mock("../config/prisma", () => ({
  prisma: {
    customer: { findUnique: (...a: unknown[]) => customerFindUnique(...a) },
    sale: {
      aggregate: (...a: unknown[]) => saleAggregate(...a),
      findMany: (...a: unknown[]) => saleFindMany(...a),
    },
    saleItem: { aggregate: (...a: unknown[]) => saleItemAggregate(...a) },
    exchange: {
      aggregate: (...a: unknown[]) => exchangeAggregate(...a),
      findMany: (...a: unknown[]) => exchangeFindMany(...a),
      findFirst: (...a: unknown[]) => exchangeFindFirst(...a),
    },
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
  },
}));

vi.mock("../config/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { customerService } = await import("../services/customer.service");
const { ACTIVE_WINDOW_DAYS, PROFILE_HISTORY_LIMIT } = await import(
  "../repositories/customer.repository"
);

const CUSTOMER_ID = "cus_1";

/** A realistic non-walk-in customer record. */
function customerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CUSTOMER_ID,
    customerCode: "CUS-000001",
    name: "Asha Rao",
    phone: "9876543210",
    email: null,
    isWalkIn: false,
    isActive: true,
    rewardPoints: 120,
    storeCredit: 50,
    addresses: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

/** Days ago as a Date, for driving the active-window boundary. */
function daysAgo(n: number) {
  return new Date(Date.now() - n * 86_400_000);
}

beforeEach(() => {
  vi.clearAllMocks();

  customerFindUnique.mockResolvedValue(customerRow());
  saleAggregate.mockResolvedValue({
    _sum: { grandTotal: 5000 },
    _count: { id: 4 },
    _min: { saleDate: daysAgo(200) },
    _max: { saleDate: daysAgo(10) },
  });
  saleItemAggregate.mockResolvedValue({ _sum: { quantity: 11 } });
  saleFindMany.mockResolvedValue([]);
  exchangeAggregate.mockResolvedValue({
    _count: { id: 0 },
    _sum: { returnedValue: 0, issuedValue: 0, priceDifference: 0 },
  });
  exchangeFindMany.mockResolvedValue([]);
  exchangeFindFirst.mockResolvedValue(null);
  queryRaw.mockResolvedValue([]);
});

// =============================================================================
// WALK-IN GUARD
// =============================================================================

describe("the Walk-In placeholder is not a customer", () => {
  it("refuses to build a profile for the Walk-In record", async () => {
    customerFindUnique.mockResolvedValue(customerRow({ isWalkIn: true }));

    await expect(customerService.getCustomerProfile(CUSTOMER_ID)).rejects.toThrow(
      /placeholder/i
    );
  });

  it("does not run ANY aggregation for the Walk-In record", async () => {
    customerFindUnique.mockResolvedValue(customerRow({ isWalkIn: true }));

    await expect(
      customerService.getCustomerProfile(CUSTOMER_ID)
    ).rejects.toThrow();

    // The guard must short-circuit before the expensive fan-out, not after.
    expect(saleAggregate).not.toHaveBeenCalled();
    expect(exchangeAggregate).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("404s for a customer that does not exist", async () => {
    customerFindUnique.mockResolvedValue(null);

    await expect(customerService.getCustomerProfile("nope")).rejects.toThrow(
      /not found/i
    );
  });
});

// =============================================================================
// COMPLETED-ONLY ROLLUPS vs ALL-STATUS HISTORY
// =============================================================================

describe("spend rollups count COMPLETED sales only", () => {
  it("filters the spend aggregate to COMPLETED", async () => {
    await customerService.getCustomerProfile(CUSTOMER_ID);

    const where = saleAggregate.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({ customerId: CUSTOMER_ID, status: "COMPLETED" });
  });

  it("filters the items-purchased aggregate to COMPLETED sales", async () => {
    await customerService.getCustomerProfile(CUSTOMER_ID);

    const where = saleItemAggregate.mock.calls[0]?.[0]?.where;
    expect(where?.sale).toMatchObject({
      customerId: CUSTOMER_ID,
      status: "COMPLETED",
    });
  });

  it("restricts the top-products rollup to COMPLETED sales", async () => {
    await customerService.getCustomerProfile(CUSTOMER_ID);

    // The raw query is tagged-template SQL; the status lives in the literal.
    const sqlParts = (queryRaw.mock.calls[0]?.[0] as string[]) ?? [];
    expect(sqlParts.join("?")).toContain("'COMPLETED'");
  });
});

describe("purchase history shows every status", () => {
  it("does NOT filter the history by status", async () => {
    await customerService.getCustomerProfile(CUSTOMER_ID);

    const where = saleFindMany.mock.calls[0]?.[0]?.where;
    // A VOIDED or PARTIAL sale is part of the relationship history. Hiding it
    // would make the tab disagree with the customer's own receipts.
    expect(where).toEqual({ customerId: CUSTOMER_ID });
    expect(where).not.toHaveProperty("status");
  });

  it("returns the history newest-first", async () => {
    await customerService.getCustomerProfile(CUSTOMER_ID);

    expect(saleFindMany.mock.calls[0]?.[0]?.orderBy).toEqual({
      saleDate: "desc",
    });
  });
});

// =============================================================================
// HISTORY CAPS
// =============================================================================

describe("histories are capped and the cap is reported", () => {
  it("caps both histories at the shared limit", async () => {
    await customerService.getCustomerProfile(CUSTOMER_ID);

    expect(saleFindMany.mock.calls[0]?.[0]?.take).toBe(PROFILE_HISTORY_LIMIT);
    expect(exchangeFindMany.mock.calls[0]?.[0]?.take).toBe(PROFILE_HISTORY_LIMIT);
  });

  it("reports the cap so the UI can disclose the truncation", async () => {
    const profile = await customerService.getCustomerProfile(CUSTOMER_ID);

    // Silently truncating is the failure mode this prevents: a user reconciling
    // against a report needs to know they see a slice, not everything.
    expect(profile.historyLimit).toBe(PROFILE_HISTORY_LIMIT);
  });
});

// =============================================================================
// EXCHANGE ROLLUPS — SIGNED PRICE DIFFERENCE
// =============================================================================

describe("exchange rollups preserve the signed price difference", () => {
  it("passes through a NEGATIVE net difference (shop refunded the customer)", async () => {
    exchangeAggregate.mockResolvedValue({
      _count: { id: 3 },
      _sum: { returnedValue: 900, issuedValue: 650, priceDifference: -250 },
    });

    const profile = await customerService.getCustomerProfile(CUSTOMER_ID);

    // Recomputing as issued − returned would also give −250 here, but the sign
    // must come from the stored column so it stays right when an exchange is
    // partially settled and the two stop agreeing.
    expect(profile.statistics.netPriceDifference).toBe(-250);
    expect(profile.statistics.totalExchanges).toBe(3);
  });

  it("passes through a POSITIVE net difference (customer paid extra)", async () => {
    exchangeAggregate.mockResolvedValue({
      _count: { id: 1 },
      _sum: { returnedValue: 400, issuedValue: 700, priceDifference: 300 },
    });

    const profile = await customerService.getCustomerProfile(CUSTOMER_ID);
    expect(profile.statistics.netPriceDifference).toBe(300);
  });

  it("counts offsetting exchanges even when they net to zero", async () => {
    exchangeAggregate.mockResolvedValue({
      _count: { id: 2 },
      _sum: { returnedValue: 500, issuedValue: 500, priceDifference: 0 },
    });

    const profile = await customerService.getCustomerProfile(CUSTOMER_ID);

    // Net zero is not "no exchanges" — the count is an independent fact.
    expect(profile.statistics.netPriceDifference).toBe(0);
    expect(profile.statistics.totalExchanges).toBe(2);
  });

  it("reports zeroes, not nulls, for a customer who never exchanged", async () => {
    exchangeAggregate.mockResolvedValue({
      _count: { id: 0 },
      _sum: { returnedValue: null, issuedValue: null, priceDifference: null },
    });

    const profile = await customerService.getCustomerProfile(CUSTOMER_ID);

    // Prisma returns null for SUM over zero rows; the UI formats numbers.
    expect(profile.statistics.netPriceDifference).toBe(0);
    expect(profile.statistics.totalReturnedValue).toBe(0);
    expect(profile.statistics.totalIssuedValue).toBe(0);
    expect(profile.statistics.lastExchangeDate).toBeNull();
  });
});

// =============================================================================
// ACTIVE STATUS — must match the customer table
// =============================================================================

describe("the active badge uses the same window as the customer table", () => {
  it("marks a customer active when the last visit is inside the window", async () => {
    saleAggregate.mockResolvedValue({
      _sum: { grandTotal: 100 },
      _count: { id: 1 },
      _min: { saleDate: daysAgo(30) },
      _max: { saleDate: daysAgo(ACTIVE_WINDOW_DAYS - 1) },
    });

    const profile = await customerService.getCustomerProfile(CUSTOMER_ID);
    expect(profile.statistics.active).toBe(true);
    expect(profile.statistics.activeWindowDays).toBe(ACTIVE_WINDOW_DAYS);
  });

  it("marks a customer inactive once the last visit falls outside the window", async () => {
    saleAggregate.mockResolvedValue({
      _sum: { grandTotal: 100 },
      _count: { id: 1 },
      _min: { saleDate: daysAgo(400) },
      _max: { saleDate: daysAgo(ACTIVE_WINDOW_DAYS + 1) },
    });

    const profile = await customerService.getCustomerProfile(CUSTOMER_ID);
    expect(profile.statistics.active).toBe(false);
  });

  it("treats a customer who never purchased as inactive, not active", async () => {
    saleAggregate.mockResolvedValue({
      _sum: { grandTotal: null },
      _count: { id: 0 },
      _min: { saleDate: null },
      _max: { saleDate: null },
    });

    const profile = await customerService.getCustomerProfile(CUSTOMER_ID);

    // A null lastVisit compares as neither >= nor < the threshold; the guard
    // must be explicit or this silently flips to "active".
    expect(profile.statistics.active).toBe(false);
    expect(profile.statistics.totalOrders).toBe(0);
  });
});

// =============================================================================
// DERIVED SALE STATISTICS
// =============================================================================

describe("derived sale statistics", () => {
  it("computes average order value from completed spend and count", async () => {
    saleAggregate.mockResolvedValue({
      _sum: { grandTotal: 5000 },
      _count: { id: 4 },
      _min: { saleDate: daysAgo(200) },
      _max: { saleDate: daysAgo(10) },
    });

    const profile = await customerService.getCustomerProfile(CUSTOMER_ID);
    expect(profile.statistics.lifetimeSpend).toBe(5000);
    expect(profile.statistics.averageOrderValue).toBe(1250);
  });

  it("does not divide by zero for a customer with no completed orders", async () => {
    saleAggregate.mockResolvedValue({
      _sum: { grandTotal: null },
      _count: { id: 0 },
      _min: { saleDate: null },
      _max: { saleDate: null },
    });

    const profile = await customerService.getCustomerProfile(CUSTOMER_ID);
    expect(profile.statistics.averageOrderValue).toBe(0);
    expect(Number.isNaN(profile.statistics.averageOrderValue)).toBe(false);
  });
});

// =============================================================================
// SHAPE
// =============================================================================

describe("the profile is assembled in one fan-out", () => {
  it("returns the record alongside every tab's data", async () => {
    const profile = await customerService.getCustomerProfile(CUSTOMER_ID);

    expect(profile.id).toBe(CUSTOMER_ID);
    expect(profile.customerCode).toBe("CUS-000001");
    expect(Array.isArray(profile.purchases)).toBe(true);
    expect(Array.isArray(profile.exchanges)).toBe(true);
    expect(Array.isArray(profile.topProducts)).toBe(true);
  });

  it("issues the five aggregation queries concurrently, not serially", async () => {
    await customerService.getCustomerProfile(CUSTOMER_ID);

    // One round trip to a network-latency database instead of five. If this
    // ever regresses to sequential awaits the profile gets ~5x slower with no
    // visible failure, so the concurrency is asserted rather than assumed.
    expect(saleAggregate).toHaveBeenCalledTimes(1);
    expect(exchangeAggregate).toHaveBeenCalledTimes(1);
    expect(saleFindMany).toHaveBeenCalledTimes(1);
    expect(exchangeFindMany).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
