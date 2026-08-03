import type { Prisma } from "../../generated/prisma";
import { ConfigurationEngine } from "../engines/configuration.engine";

export class InvoiceService {
  /**
   * Generates a business-friendly, sequential invoice number
   * (e.g., INV-20260712-000001).
   *
   * CONFIGURATION (2026-08-03). The prefix and sequence width were hardcoded
   * here as `INV-` and 6 digits, while `invoiceConfig.invoicePrefix` and
   * `invoiceConfig.invoiceNumberLength` existed in the settings document and
   * were read by nothing. They are now read from ConfigurationEngine, so
   * Receipt & Invoice Settings configures the real thing rather than a field
   * with no effect.
   *
   * The FORMAT is unchanged — `{PREFIX}-{YYYYMMDD}-{SEQUENCE}` — and the stock
   * defaults reproduce the previous output byte-for-byte. Existing invoice
   * numbers are never rewritten.
   *
   * ⚠ CHANGING THE PREFIX MID-DAY IS SAFE, BY CONSTRUCTION. The sequence is
   * derived from the most recent sale whose number starts with today's full
   * prefix. Change `INV` to `BILL` at noon and the afternoon's numbering starts
   * at `BILL-…-000001` while the morning's `INV-…` numbers keep theirs. Both are
   * unique, so the `saleNumber` constraint still holds and no collision or
   * renumbering occurs. This is why the lookup filters on `startsWith(prefix)`
   * rather than merely on the date.
   *
   * Concurrency Strategy:
   * This method runs inside the checkout transaction. It queries the highest
   * invoice number for the current day. If two transactions fetch the same
   * number concurrently, Prisma's UNIQUE constraint on `saleNumber` will throw a
   * P2002 error during commit. The overarching SaleService will catch this P2002
   * error and automatically retry the entire transaction block, naturally
   * resolving the collision.
   *
   * @param txClient The Prisma transaction client (or main client if running standalone)
   * @param date The date of the sale (defaults to now)
   */
  static async generateNextInvoiceNumber(
    txClient: Prisma.TransactionClient,
    date: Date = new Date()
  ): Promise<string> {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    const datePrefix = `${year}${month}${day}`;

    // Falls back to the historical constants if the engine has not been
    // initialised (standalone scripts, tests), so this can never be the reason a
    // sale fails to complete.
    const { invoicePrefix, invoiceNumberLength } = this.getNumberingConfig();
    const prefix = `${invoicePrefix}-${datePrefix}-`;

    // Calculate start and end of the day to isolate the sequence
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Fetch the most recent sale for today USING THIS PREFIX. Filtering on the
    // prefix (not just the date) is what makes a mid-day prefix change safe —
    // see the note above.
    const lastSale = await txClient.sale.findFirst({
      where: {
        saleDate: {
          gte: startOfDay,
          lte: endOfDay,
        },
        saleNumber: {
          startsWith: prefix,
        },
      },
      orderBy: {
        saleNumber: "desc",
      },
      select: {
        saleNumber: true,
      },
    });

    let nextSequence = 1;

    if (lastSale && lastSale.saleNumber.startsWith(prefix)) {
      // Extract the sequence number, e.g., "000001" from "INV-20260712-000001"
      const lastSequenceString = lastSale.saleNumber.replace(prefix, "");
      const lastSequenceNumber = parseInt(lastSequenceString, 10);

      if (!isNaN(lastSequenceNumber)) {
        nextSequence = lastSequenceNumber + 1;
      }
    }

    // Pad with leading zeros (e.g., 000001).
    //
    // `padStart` only pads; it never truncates. So if the configured width is
    // reduced below what the day's sequence already needs, the number simply
    // grows past it rather than colliding with an existing one. Shortening the
    // width is therefore safe mid-day too.
    const sequencePadded = nextSequence.toString().padStart(invoiceNumberLength, "0");

    return `${prefix}${sequencePadded}`;
  }

  /**
   * Reads numbering configuration, falling back to the historical constants.
   *
   * `ConfigurationEngine.getInvoiceSettings()` throws when the cache has not
   * been initialised, which is the correct behaviour for a web request (the
   * server awaits `init()` at boot) but wrong here: a seed script or a unit test
   * calling this must not fail for want of a cache. The fallback reproduces the
   * pre-2026-08 output exactly.
   */
  private static getNumberingConfig(): {
    invoicePrefix: string;
    invoiceNumberLength: number;
  } {
    try {
      const config = ConfigurationEngine.getInvoiceSettings();
      return {
        invoicePrefix: config.invoicePrefix,
        invoiceNumberLength: config.invoiceNumberLength,
      };
    } catch {
      return { invoicePrefix: "INV", invoiceNumberLength: 6 };
    }
  }

  /**
   * Future Expansion: Receipt generation
   *
   * This service is designated as the Receipt Engine. In future iterations,
   * methods like `generateThermalReceiptDTO(saleId)` or `generatePDF(saleId)`
   * will be implemented here to keep receipt formatting out of the core
   * SaleService. When that happens, `invoiceConfig.receiptHeader`,
   * `receiptFooter` and `qrCodeEnabled` are the fields it should read — they are
   * configurable in Receipt & Invoice Settings today and are surfaced there as
   * affecting printed receipts.
   */
}
