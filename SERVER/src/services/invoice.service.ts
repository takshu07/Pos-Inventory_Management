import type { Prisma } from "../../generated/prisma";


export class InvoiceService {
  /**
   * Generates a business-friendly, sequential invoice number (e.g., INV-20260712-000001).
   *
   * Concurrency Strategy:
   * This method runs inside the checkout transaction. It queries the highest invoice
   * number for the current day. If two transactions fetch the same number concurrently,
   * Prisma's UNIQUE constraint on `saleNumber` will throw a P2002 error during commit.
   * The overarching SaleService will catch this P2002 error and automatically retry the
   * entire transaction block, naturally resolving the collision.
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
    const prefix = `INV-${datePrefix}-`;

    // Calculate start and end of the day to isolate the sequence
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Fetch the most recent sale for today
    const lastSale = await txClient.sale.findFirst({
      where: {
        saleDate: {
          gte: startOfDay,
          lte: endOfDay,
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

    // Pad with leading zeros (e.g., 000001)
    const sequencePadded = nextSequence.toString().padStart(6, "0");

    return `${prefix}${sequencePadded}`;
  }

  /**
   * Future Expansion: Receipt generation
   *
   * This service is designated as the Receipt Engine. In future iterations,
   * methods like `generateThermalReceiptDTO(saleId)` or `generatePDF(saleId)`
   * will be implemented here to keep receipt formatting out of the core SaleService.
   */
}
