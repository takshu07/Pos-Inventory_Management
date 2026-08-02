/**
 * Goods receipt — full or partial.
 *
 * THE CENTRAL RULE: you can only receive what is still outstanding.
 *
 * Each line's input is capped at `quantity - receivedQuantity`. The server
 * rejects over-receipt rather than clamping it (an over-shipment is nearly
 * always a mis-keyed number, and silently absorbing it would invent stock that
 * never arrived), so the dialog enforces the same cap up front and explains it
 * — being refused after typing is a worse experience than not being able to
 * type it.
 *
 * Submitting with every line at its full outstanding amount sends NO `items`
 * key at all, which the server reads as "receive everything outstanding". That
 * keeps the common case on the simplest possible path.
 */

import { useEffect, useMemo, useState } from "react";
import { PackageCheck } from "lucide-react";
import { Button, Card, Input, Modal } from "@/components/ui";
import { formatCurrencyExact, formatNumber } from "@/components/shared/bi";
import type { PurchaseDetail, ReceivePurchaseInput } from "../types";
import { ReceiptProgressBar } from "./ProcurementAtoms";

interface ReceiveStockDialogProps {
  open: boolean;
  onClose: () => void;
  purchase: PurchaseDetail;
  onSubmit: (input: ReceivePurchaseInput) => Promise<unknown>;
}

export function ReceiveStockDialog({
  open,
  onClose,
  purchase,
  onSubmit,
}: ReceiveStockDialogProps) {
  /** itemId → units being received on THIS receipt. */
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openLines = useMemo(
    () => purchase.items.filter((i) => i.quantity - i.receivedQuantity > 0),
    [purchase.items]
  );

  // Default to receiving everything outstanding — the overwhelmingly common
  // case. Partial receipt is then a matter of editing down, not building up.
  useEffect(() => {
    if (!open) return;
    setQuantities(
      Object.fromEntries(
        openLines.map((i) => [i.id, i.quantity - i.receivedQuantity])
      )
    );
    setInvoiceNumber(purchase.supplierInvoiceNumber ?? "");
    setNotes("");
    setError(null);
    setBusy(false);
  }, [open, openLines, purchase.supplierInvoiceNumber]);

  const totalReceiving = Object.values(quantities).reduce((sum, q) => sum + (q || 0), 0);
  const totalOutstanding = openLines.reduce(
    (sum, i) => sum + (i.quantity - i.receivedQuantity),
    0
  );
  const isFullReceipt = totalReceiving === totalOutstanding && totalReceiving > 0;

  /** Cost value of what is being booked in — what this receipt adds to stock. */
  const receiptValue = openLines.reduce(
    (sum, i) => sum + (quantities[i.id] ?? 0) * i.costPrice,
    0
  );

  function setQty(itemId: string, raw: string, max: number) {
    const parsed = raw === "" ? 0 : Math.floor(Number(raw));
    if (!Number.isFinite(parsed)) return;
    // Cap here so the field can never hold a rejected value.
    setQuantities((q) => ({ ...q, [itemId]: Math.max(0, Math.min(parsed, max)) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (totalReceiving <= 0) {
      setError("Enter at least one unit to receive.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        supplierInvoiceNumber: invoiceNumber.trim() || undefined,
        notes: notes.trim() || undefined,
        // Omitting `items` on a full receipt is the documented "everything
        // outstanding" path.
        ...(isFullReceipt
          ? {}
          : {
              items: openLines
                .filter((i) => (quantities[i.id] ?? 0) > 0)
                .map((i) => ({ itemId: i.id, quantity: quantities[i.id] as number })),
            }),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The receipt could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`Receive stock — ${purchase.purchaseNumber}`}
      description={`${purchase.supplier.businessName} · ${formatNumber(totalOutstanding)} unit(s) outstanding`}
      size="xl"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <span className="text-muted-foreground">Receiving </span>
            <span className="font-semibold tabular-nums text-foreground">
              {formatNumber(totalReceiving)}
            </span>
            <span className="text-muted-foreground">
              {" "}
              of {formatNumber(totalOutstanding)} unit(s) ·{" "}
            </span>
            <span className="font-semibold tabular-nums text-foreground">
              {formatCurrencyExact(receiptValue)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              form="receive-form"
              type="submit"
              loading={busy}
              disabled={totalReceiving <= 0}
            >
              <PackageCheck className="h-4 w-4" aria-hidden="true" />
              {isFullReceipt ? "Receive all" : "Record partial receipt"}
            </Button>
          </div>
        </div>
      }
    >
      <form id="receive-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setQuantities(
                Object.fromEntries(
                  openLines.map((i) => [i.id, i.quantity - i.receivedQuantity])
                )
              )
            }
          >
            Receive all outstanding
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              setQuantities(Object.fromEntries(openLines.map((i) => [i.id, 0])))
            }
          >
            Clear all
          </Button>
        </div>

        <div className="max-h-[45vh] space-y-2 overflow-y-auto">
          {openLines.map((item) => {
            const outstanding = item.quantity - item.receivedQuantity;
            const receiving = quantities[item.id] ?? 0;

            return (
              <Card key={item.id} className="p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">
                      {item.variant.product.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{item.variant.sku}</span>
                      {[item.variant.size?.name, item.variant.color?.name]
                        .filter(Boolean)
                        .map((x) => ` · ${x}`)
                        .join("")}
                    </p>
                    <div className="mt-2 max-w-xs">
                      <ReceiptProgressBar
                        received={item.receivedQuantity}
                        ordered={item.quantity}
                      />
                    </div>
                  </div>

                  <div className="flex items-end gap-3">
                    <div className="text-right text-xs text-muted-foreground">
                      <p>Ordered {formatNumber(item.quantity)}</p>
                      <p>Already in {formatNumber(item.receivedQuantity)}</p>
                      <p className="font-medium text-foreground">
                        Outstanding {formatNumber(outstanding)}
                      </p>
                    </div>

                    <div className="w-28">
                      <label
                        htmlFor={`recv-${item.id}`}
                        className="mb-1 block text-xs font-medium text-foreground"
                      >
                        Receive now
                      </label>
                      <Input
                        id={`recv-${item.id}`}
                        value={String(receiving)}
                        onChange={(e) => setQty(item.id, e.target.value, outstanding)}
                        inputMode="numeric"
                        className="text-right tabular-nums"
                        aria-label={`Units of ${item.variant.sku} to receive, maximum ${outstanding}`}
                      />
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="recv-invoice" className="text-sm font-medium text-foreground">
              Supplier invoice number
            </label>
            <Input
              id="recv-invoice"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="From the delivery paperwork"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="recv-notes" className="text-sm font-medium text-foreground">
              Notes
            </label>
            <Input
              id="recv-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Damage, shortfall, anything unusual"
            />
          </div>
        </div>

        {!isFullReceipt && totalReceiving > 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            This is a partial receipt. The purchase stays open and the remaining{" "}
            {formatNumber(totalOutstanding - totalReceiving)} unit(s) can be received later.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Receiving stock updates inventory immediately and re-costs the affected
          variants. It cannot be undone from here — a mistaken receipt is
          corrected with a stock adjustment or a supplier return.
        </p>
      </form>
    </Modal>
  );
}
