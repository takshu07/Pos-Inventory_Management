import { useState } from "react";
import { Plus, Printer, Save, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui";
import { usePosStore, usePosTotals } from "../store/usePosStore";
import { usePosCheckout, PaymentInput } from "../hooks/usePosCheckout";
import { PaymentModal } from "./PaymentModal";
import { printReceipt } from "../utils/printReceipt";
import { buildReceiptData } from "../utils/receiptMapper";
import { toast } from "sonner";

/**
 * Static section 1 from the design — always present for the cashier.
 * [ Add · Print · Save only · Save & Print ]
 */
export function PosToolbar() {
  const {
    resetWorkspace,
    activeTab,
    posMode,
    cart,
    exchangeReturns,
    lastSavedBill,
    customer,
  } = usePosStore();
  const { grandTotal } = usePosTotals();
  const { save, isProcessing } = usePosCheckout();

  // When true, a successful payment also prints the receipt.
  const [paymentIntent, setPaymentIntent] = useState<null | { print: boolean }>(null);

  const canSave =
    activeTab === "ITEMS" &&
    (posMode === "EXCHANGE"
      ? cart.length > 0 && exchangeReturns.length > 0
      : cart.length > 0);

  const openPayment = (print: boolean) => {
    if (!canSave) {
      toast.error(
        activeTab !== "ITEMS"
          ? "Switch to Item details to save a transaction."
          : "Add items to the bill first."
      );
      return;
    }
    setPaymentIntent({ print });
  };

  const handleConfirmPayment = async (payments: PaymentInput[]) => {
    const intent = paymentIntent;
    if (!intent) return;
    const bill = await save(payments, { print: intent.print });
    if (bill) setPaymentIntent(null);
  };

  // Re-print the last saved bill. Enabled only after a save (per the design note).
  const handlePrintLast = () => {
    if (!lastSavedBill) return;
    const raw = lastSavedBill.raw ?? {};
    const receipt = buildReceiptData({
      savedRaw: raw,
      kind: lastSavedBill.kind,
      // The cart is cleared after saving, so reconstruct lines from the saved payload.
      cart: (raw.items || []).map((it: any) => ({
        cartItemId: it.id,
        quantity: it.quantity,
        unitPrice: Number(it.sellingPrice ?? it.unitPrice ?? 0),
        discountAmount: Number(it.discountAmount ?? 0),
        lineTotal: Number(it.totalPrice ?? it.lineTotal ?? 0),
        variant: {
          id: it.variantId ?? it.id,
          sku: it.sku ?? "",
          barcode: it.barcode ?? null,
          sellingPrice: Number(it.sellingPrice ?? 0),
          mrp: Number(it.mrp ?? it.sellingPrice ?? 0),
          currentStock: 0,
          isActive: true,
          product: { id: "", name: it.productName ?? "Item", isActive: true },
          size: it.sizeName ? { id: "", name: it.sizeName } : undefined,
          color: it.colorName ? { id: "", name: it.colorName } : undefined,
        },
      })),
      returns: [],
      subtotal: Number(raw.subtotal ?? lastSavedBill.grandTotal),
      discountTotal: Number(raw.discountAmount ?? 0) + Number(raw.manualDiscountAmount ?? 0),
      returnTotal: 0,
      grandTotal: lastSavedBill.grandTotal,
      payments: (raw.payments || []).map((p: any) => ({ method: p.method, amount: Number(p.amount) })),
      customerName: customer?.name ?? raw.customer?.name,
      customerPhone: customer?.phone ?? raw.customer?.phone,
    });
    printReceipt(receipt);
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30 shrink-0">
      <Button variant="outline" size="sm" onClick={() => resetWorkspace()} disabled={isProcessing}>
        <Plus className="h-4 w-4 mr-1.5" /> Add
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={handlePrintLast}
        disabled={!lastSavedBill || isProcessing}
        title={lastSavedBill ? `Reprint ${lastSavedBill.number}` : "Available after a bill is saved"}
      >
        <Printer className="h-4 w-4 mr-1.5" /> Print
      </Button>

      <div className="w-px h-6 bg-border mx-1" />

      <Button
        variant="secondary"
        size="sm"
        onClick={() => openPayment(false)}
        disabled={!canSave || isProcessing}
        loading={isProcessing}
      >
        <Save className="h-4 w-4 mr-1.5" /> Save only
      </Button>

      <Button
        size="sm"
        onClick={() => openPayment(true)}
        disabled={!canSave || isProcessing}
        loading={isProcessing}
      >
        <ReceiptText className="h-4 w-4 mr-1.5" /> Save &amp; Print
      </Button>

      <PaymentModal
        open={paymentIntent !== null}
        onClose={() => {
          if (!isProcessing) setPaymentIntent(null);
        }}
        grandTotal={grandTotal}
        onConfirm={handleConfirmPayment}
        isProcessing={isProcessing}
        confirmLabel={paymentIntent?.print ? "Confirm & Print" : "Save Transaction"}
      />
    </div>
  );
}
