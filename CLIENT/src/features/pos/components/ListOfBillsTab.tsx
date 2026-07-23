import { Printer, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui";
import { useShallow } from "zustand/react/shallow";
import { usePosStore } from "../store/usePosStore";
import { useSalesHistory } from "@/features/sales/hooks/useSales";
import { formatCurrency } from "../utils/pos.utils";
import { printReceipt } from "../utils/printReceipt";
import { buildReceiptData } from "../utils/receiptMapper";

/** Reprints a session bill from its stored raw payload. */
function reprint(raw: any, kind: "SALE" | "EXCHANGE", grandTotal: number) {
  const receipt = buildReceiptData({
    savedRaw: raw ?? {},
    kind,
    cart: (raw?.items || []).map((it: any) => ({
      cartItemId: it.id,
      quantity: it.quantity,
      unitPrice: Number(it.sellingPrice ?? 0),
      discountAmount: Number(it.discountAmount ?? 0),
      lineTotal: Number(it.totalPrice ?? 0),
      variant: {
        id: it.variantId ?? "",
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
    subtotal: Number(raw?.subtotal ?? grandTotal),
    discountTotal: Number(raw?.discountAmount ?? 0) + Number(raw?.manualDiscountAmount ?? 0),
    returnTotal: 0,
    grandTotal,
    payments: (raw?.payments || []).map((p: any) => ({ method: p.method, amount: Number(p.amount) })),
    customerName: raw?.customer?.name,
    customerPhone: raw?.customer?.phone,
  });
  printReceipt(receipt);
}

export function ListOfBillsTab() {
  const { sessionBills, customer } = usePosStore(
    useShallow((s) => ({ sessionBills: s.sessionBills, customer: s.customer }))
  );
  const { data: history } = useSalesHistory({ customerId: customer?.id, limit: 20 });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 h-full min-h-0 divide-y lg:divide-y-0 lg:divide-x">
      {/* Bills saved during this session */}
      <div className="flex flex-col min-h-0">
        <div className="px-5 py-4 border-b shrink-0">
          <h3 className="font-semibold">Bills saved this session</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {sessionBills.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-2 opacity-70">
              <ReceiptText className="h-10 w-10" />
              <p>No bills saved yet in this session.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {sessionBills.map((b) => (
                <div key={b.id} className="rounded-lg border p-3 bg-background flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm flex items-center gap-2">
                      {b.number}
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          b.kind === "EXCHANGE"
                            ? "bg-orange-500/10 text-orange-600"
                            : "bg-primary/10 text-primary"
                        }`}
                      >
                        {b.kind}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(b.createdAt).toLocaleTimeString("en-IN")}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-sm">{formatCurrency(b.grandTotal)}</span>
                    <Button variant="outline" size="sm" onClick={() => reprint(b.raw, b.kind, b.grandTotal)}>
                      <Printer className="h-3.5 w-3.5 mr-1.5" /> Print
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* This customer's overall history */}
      <div className="flex flex-col min-h-0">
        <div className="px-5 py-4 border-b shrink-0">
          <h3 className="font-semibold">This customer's bills</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {!customer?.id ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm opacity-70">
              No customer attached.
            </div>
          ) : (history?.data ?? []).length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm opacity-70">
              No previous bills.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {(history?.data ?? []).map((b, i) => (
                <div key={b.id} className="rounded-lg border p-3 bg-background flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-5">{i + 1}</span>
                    <div className="flex flex-col">
                      <span className="font-medium text-sm">{b.invoiceNumber}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(b.date).toLocaleDateString("en-IN", { dateStyle: "medium" })}
                      </span>
                    </div>
                  </div>
                  <span className="font-semibold text-sm">{formatCurrency(b.totalAmount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
