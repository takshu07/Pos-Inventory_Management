/**
 * Records a payment to a supplier.
 *
 * Two modes, one dialog:
 *  • AGAINST A BILL — opened from a purchase. The amount is capped at that
 *    bill's outstanding balance because the server rejects overpayment
 *    (a mis-keyed amount would otherwise leave a negative due that corrupts
 *    the payables total).
 *  • ON ACCOUNT — opened from a supplier profile with no bill chosen. Money
 *    goes against the running balance and is reported separately from
 *    bill-linked settlement.
 *
 * A CASH payment also posts CASH_OUT to the open register drawer server-side,
 * which is why the copy says so — the user needs to know the drawer will move.
 */

import { useEffect, useMemo, useState } from "react";
import { Button, Input, Modal, Select } from "@/components/ui";
import { formatCurrencyExact } from "@/components/shared/bi";
import type { PaymentMethod, RecordPaymentInput } from "../types";
import { useOpenBills } from "../hooks/useProcurement";

/** Exactly the server's PaymentMethod enum — see types.ts. */
const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
  { value: "CREDIT", label: "Credit" },
  { value: "GIFT_CARD", label: "Gift card" },
  { value: "OTHER", label: "Other (cheque, bank transfer…)" },
];

interface RecordPaymentDialogProps {
  open: boolean;
  onClose: () => void;
  supplierId: string;
  supplierName: string;
  /** Pre-selects a bill and caps the amount to its balance. */
  purchaseId?: string | undefined;
  purchaseNumber?: string | undefined;
  maxAmount?: number | undefined;
  onSubmit: (input: RecordPaymentInput) => Promise<unknown>;
}

export function RecordPaymentDialog({
  open,
  onClose,
  supplierId,
  supplierName,
  purchaseId,
  purchaseNumber,
  maxAmount,
  onSubmit,
}: RecordPaymentDialogProps) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [billId, setBillId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only fetched when the dialog is open AND no bill was pre-selected — the
  // purchase-detail entry point already knows its bill.
  const { data: openBills = [], isLoading: billsLoading } = useOpenBills(
    open && !purchaseId ? supplierId : null
  );

  useEffect(() => {
    if (!open) return;
    setAmount(maxAmount != null ? String(maxAmount) : "");
    setMethod("CASH");
    setReference("");
    setNotes("");
    setBillId(purchaseId ?? "");
    setError(null);
    setBusy(false);
  }, [open, purchaseId, maxAmount]);

  // The cap follows whichever bill is actually selected.
  const selectedBill = useMemo(
    () => openBills.find((b: any) => b.id === billId),
    [openBills, billId]
  );
  const cap = purchaseId ? maxAmount : selectedBill ? Number(selectedBill.dueAmount) : undefined;

  const numericAmount = Number(amount);
  const amountValid =
    amount.trim() !== "" &&
    Number.isFinite(numericAmount) &&
    numericAmount > 0 &&
    (cap == null || numericAmount <= cap + 0.005);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!amountValid) {
      setError(
        cap != null && numericAmount > cap
          ? `Amount exceeds the ${formatCurrencyExact(cap)} still due on this bill.`
          : "Enter an amount greater than zero."
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        supplierId,
        purchaseId: billId || undefined,
        amount: numericAmount,
        paymentMethod: method,
        referenceNumber: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The payment could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  const billOptions = [
    { value: "", label: "On account (no specific bill)" },
    ...openBills.map((b: any) => ({
      value: b.id,
      label: `${b.purchaseNumber} — ${formatCurrencyExact(Number(b.dueAmount))} due`,
    })),
  ];

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Record payment"
      description={`To ${supplierName}${purchaseNumber ? ` against ${purchaseNumber}` : ""}`}
      size="md"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button form="payment-form" type="submit" loading={busy} disabled={!amountValid}>
            Record payment
          </Button>
        </div>
      }
    >
      <form id="payment-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Bill picker only when the caller did not fix one. */}
        {!purchaseId && (
          <div className="space-y-1.5">
            <label htmlFor="pay-bill" className="text-sm font-medium text-foreground">
              Apply to
            </label>
            <Select
              id="pay-bill"
              value={billId}
              onChange={(e) => {
                setBillId(e.target.value);
                const bill = openBills.find((b: any) => b.id === e.target.value);
                if (bill) setAmount(String(Number(bill.dueAmount)));
              }}
              disabled={billsLoading}
              options={billOptions}
            />
            <p className="text-xs text-muted-foreground">
              {billsLoading
                ? "Loading open bills…"
                : openBills.length === 0
                  ? "No open bills — this will be recorded on account."
                  : "Choose a bill to settle it directly, or leave on account."}
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="pay-amount" className="text-sm font-medium text-foreground">
            Amount <span className="text-destructive">*</span>
          </label>
          <Input
            id="pay-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            autoFocus
            aria-invalid={amount !== "" && !amountValid}
          />
          {cap != null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {formatCurrencyExact(cap)} outstanding
              </span>
              <button
                type="button"
                onClick={() => setAmount(String(cap))}
                className="font-medium text-primary hover:underline"
              >
                Pay in full
              </button>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="pay-method" className="text-sm font-medium text-foreground">
            Method
          </label>
          <Select
            id="pay-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            options={METHODS}
          />
          {method === "CASH" && (
            <p className="text-xs text-muted-foreground">
              Cash payments are posted out of the open register drawer.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="pay-ref" className="text-sm font-medium text-foreground">
            Reference
          </label>
          <Input
            id="pay-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="UTR, cheque number, transaction id…"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="pay-notes" className="text-sm font-medium text-foreground">
            Notes
          </label>
          <textarea
            id="pay-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
