/**
 * Invoice numbering — configuration-driven prefix and sequence width.
 *
 * This sits on the checkout path, so the bar is "byte-for-byte identical output
 * for the stock configuration". The prefix and width were hardcoded (`INV-`, 6
 * digits) while the settings fields that were supposed to control them were read
 * by nothing; wiring them up must not change what an unconfigured store issues.
 *
 * The Prisma client is stubbed — this asserts the numbering RULE, not the query.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { InvoiceService } from "../../services/invoice.service";
import { ConfigurationEngine } from "../../engines/configuration.engine";

/** Points the engine at a given numbering configuration. */
function mockInvoiceConfig(invoicePrefix: string, invoiceNumberLength: number) {
  vi.spyOn(ConfigurationEngine, "getInvoiceSettings").mockReturnValue({
    invoicePrefix,
    exchangePrefix: "EX",
    purchasePrefix: "PO",
    invoiceNumberLength,
    financialYearReset: true,
    qrCodeEnabled: false,
    barcodeFormat: "CODE128",
  });
}

/** Makes the engine behave as if it was never initialised. */
function mockUninitialisedEngine() {
  vi.spyOn(ConfigurationEngine, "getInvoiceSettings").mockImplementation(() => {
    throw new Error("ConfigurationEngine accessed before initialization.");
  });
}

/**
 * A stub transaction client returning one "most recent sale", and recording the
 * `where` clause so the prefix-scoping can be asserted.
 */
function stubTx(lastSaleNumber: string | null) {
  const findFirst = vi.fn().mockResolvedValue(
    lastSaleNumber ? { saleNumber: lastSaleNumber } : null
  );
  return { client: { sale: { findFirst } } as never, findFirst };
}

const DATE = new Date("2026-07-12T10:30:00");

afterEach(() => vi.restoreAllMocks());

describe("generateNextInvoiceNumber — backwards compatibility", () => {
  it("reproduces the historical format exactly under stock settings", () => {
    mockInvoiceConfig("INV", 6);
    const { client } = stubTx(null);

    return InvoiceService.generateNextInvoiceNumber(client, DATE).then((n) => {
      expect(n).toBe("INV-20260712-000001");
    });
  });

  it("falls back to the historical constants when the engine is uninitialised", async () => {
    // Seed scripts and unit tests call this without booting the engine. It must
    // never be the reason a sale fails to complete.
    mockUninitialisedEngine();
    const { client } = stubTx(null);

    await expect(
      InvoiceService.generateNextInvoiceNumber(client, DATE)
    ).resolves.toBe("INV-20260712-000001");
  });

  it("increments from the last sale of the day", async () => {
    mockInvoiceConfig("INV", 6);
    const { client } = stubTx("INV-20260712-000041");

    await expect(
      InvoiceService.generateNextInvoiceNumber(client, DATE)
    ).resolves.toBe("INV-20260712-000042");
  });
});

describe("generateNextInvoiceNumber — configured values", () => {
  it("uses the configured prefix", async () => {
    mockInvoiceConfig("BILL", 6);
    const { client } = stubTx(null);

    await expect(
      InvoiceService.generateNextInvoiceNumber(client, DATE)
    ).resolves.toBe("BILL-20260712-000001");
  });

  it("uses the configured sequence width", async () => {
    mockInvoiceConfig("INV", 4);
    const { client } = stubTx(null);

    await expect(
      InvoiceService.generateNextInvoiceNumber(client, DATE)
    ).resolves.toBe("INV-20260712-0001");
  });

  it("scopes the last-sale lookup to the current prefix, not just the date", async () => {
    // This is what makes a mid-day prefix change safe: the afternoon's BILL-
    // sequence must not continue the morning's INV- sequence.
    mockInvoiceConfig("BILL", 6);
    const { client, findFirst } = stubTx(null);

    await InvoiceService.generateNextInvoiceNumber(client, DATE);

    const where = findFirst.mock.calls[0]?.[0]?.where;
    expect(where.saleNumber).toEqual({ startsWith: "BILL-20260712-" });
    expect(where.saleDate).toBeDefined();
  });

  it("starts a fresh sequence after a mid-day prefix change", async () => {
    // The stub returns null because no BILL- sale exists yet today, even though
    // INV- sales do. The new prefix therefore starts at 1.
    mockInvoiceConfig("BILL", 6);
    const { client } = stubTx(null);

    await expect(
      InvoiceService.generateNextInvoiceNumber(client, DATE)
    ).resolves.toBe("BILL-20260712-000001");
  });

  it("never truncates a sequence that outgrew the configured width", async () => {
    // padStart only pads. Shrinking the width below what the day already needs
    // must let the number grow rather than collide with an existing one.
    mockInvoiceConfig("INV", 4);
    const { client } = stubTx("INV-20260712-9999");

    await expect(
      InvoiceService.generateNextInvoiceNumber(client, DATE)
    ).resolves.toBe("INV-20260712-10000");
  });

  it("ignores a malformed trailing sequence rather than producing NaN", async () => {
    mockInvoiceConfig("INV", 6);
    const { client } = stubTx("INV-20260712-CORRUPT");

    await expect(
      InvoiceService.generateNextInvoiceNumber(client, DATE)
    ).resolves.toBe("INV-20260712-000001");
  });

  it("pads the date components to a stable width", async () => {
    mockInvoiceConfig("INV", 6);
    const { client } = stubTx(null);

    // January 5th — single-digit month and day must both zero-pad, or the
    // lexical `orderBy: saleNumber desc` that finds the last sale breaks.
    await expect(
      InvoiceService.generateNextInvoiceNumber(client, new Date("2026-01-05T09:00:00"))
    ).resolves.toBe("INV-20260105-000001");
  });
});
