/**
 * Receipt & Invoice Settings — validation.
 *
 * MIRRORS the server rules in `invoiceConfigSchema`. As with the Store Settings
 * validator, this is a UX layer: every rule is enforced again server-side and a
 * tampered client gets a 400. The point is to fail next to the field.
 *
 * The prefix rules are stricter here than the server's bare `.min(1)`, and
 * deliberately so — see `PREFIX_RE`.
 */

import type { FieldErrors } from "../hooks/useSettingsForm";
import type { FullConfiguration } from "../types";

/**
 * Document prefixes are letters and digits only.
 *
 * The generated number is `{PREFIX}-{YYYYMMDD}-{SEQUENCE}`, and the server finds
 * the day's last number by matching on that prefix. A prefix containing `-`
 * would make the segment boundaries ambiguous when the sequence is parsed back
 * out; whitespace and punctuation additionally tend to break the thermal
 * printers and CSV exports these numbers end up in. Uppercase is enforced at the
 * input, so this only has to reject the characters.
 */
const PREFIX_RE = /^[A-Z0-9]+$/;

export function validateReceiptSettings(draft: FullConfiguration): FieldErrors {
  const errors: FieldErrors = {};
  const invoice = draft.invoiceConfig;

  const prefixes = [
    ["invoicePrefix", "Invoice prefix"],
    ["exchangePrefix", "Exchange prefix"],
    ["purchasePrefix", "Purchase order prefix"],
  ] as const;

  for (const [field, label] of prefixes) {
    const value = invoice[field];

    if (!value?.trim()) {
      errors[`invoiceConfig.${field}`] = `${label} is required.`;
      continue;
    }
    if (!PREFIX_RE.test(value)) {
      errors[`invoiceConfig.${field}`] =
        "Use letters and numbers only — no spaces, dashes or punctuation.";
      continue;
    }
    if (value.length > 10) {
      errors[`invoiceConfig.${field}`] = "Keep it to 10 characters or fewer.";
    }
  }

  // Distinct prefixes are not required by the server, but sharing one makes two
  // different document types indistinguishable at a glance on a printed page,
  // which is the whole reason the prefix exists.
  if (
    invoice.invoicePrefix &&
    invoice.invoicePrefix === invoice.exchangePrefix
  ) {
    errors["invoiceConfig.exchangePrefix"] =
      "Use a different prefix from invoices, or the two document types look identical.";
  }

  if (
    invoice.invoiceNumberLength === undefined ||
    invoice.invoiceNumberLength < 4 ||
    invoice.invoiceNumberLength > 10
  ) {
    errors["invoiceConfig.invoiceNumberLength"] =
      "Choose between 4 and 10 digits.";
  }

  return errors;
}
