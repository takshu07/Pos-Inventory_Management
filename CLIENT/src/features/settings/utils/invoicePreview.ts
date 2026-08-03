/**
 * Invoice number preview.
 *
 * ⚠ MUST MIRROR `InvoiceService.generateNextInvoiceNumber` on the server
 * (SERVER/src/services/invoice.service.ts). This is a preview of a value the
 * server composes; if the two formats drift, the screen confidently shows a
 * number the system will never issue — which is worse than showing nothing.
 *
 * Format: `{PREFIX}-{YYYYMMDD}-{SEQUENCE}`, sequence zero-padded to the
 * configured width and restarting at 1 each day.
 */

/**
 * Renders what the next invoice number would look like today.
 *
 * Always previews sequence 1: the real next value depends on how many sales the
 * store has already made today, which this screen does not know and should not
 * fetch — the shape is what is being configured, not the count.
 */
export function previewInvoiceNumber(
  prefix: string,
  sequenceLength: number,
  date: Date = new Date()
): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  // Mirrors the server's fallbacks so an in-progress edit (an emptied prefix, a
  // cleared number field) previews something sane instead of "undefined-".
  const safePrefix = prefix?.trim() || "INV";
  const safeLength =
    Number.isFinite(sequenceLength) && sequenceLength > 0
      ? Math.min(Math.max(Math.trunc(sequenceLength), 1), 20)
      : 6;

  const sequence = "1".padStart(safeLength, "0");

  return `${safePrefix}-${year}${month}${day}-${sequence}`;
}
