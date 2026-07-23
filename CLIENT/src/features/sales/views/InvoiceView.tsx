import { useParams, useNavigate } from "react-router";
import { useInvoiceDetail } from "../hooks/useSales";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { CustomerCard, CashierCard } from "../components/Invoice/InfoCards";
import { InvoiceItemsTable } from "../components/Invoice/InvoiceItemsTable";
import { PaymentLedger } from "../components/Invoice/PaymentLedger";

export default function InvoiceView() {
  const { saleId } = useParams();
  const navigate = useNavigate();
  
  const { data: invoice, isLoading, error } = useInvoiceDetail(saleId || "");

  if (isLoading) {
    return <div className="p-6 flex items-center justify-center min-h-[400px]">Loading invoice details...</div>;
  }

  if (error || !invoice) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="text-red-500 font-medium">Failed to load invoice.</div>
        <Button onClick={() => navigate("/sales")} variant="outline">Back to History</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/sales")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              Invoice {invoice.invoiceNumber}
              <Badge variant={invoice.status === "COMPLETED" ? "success" : invoice.status === "CANCELLED" ? "error" : "warning"}>
                {invoice.status}
              </Badge>
              {invoice.exchanges && invoice.exchanges.length > 0 && (
                <Badge variant="secondary" className="bg-purple-100 text-purple-800 border-purple-200 ml-2">
                  Exchange Performed
                </Badge>
              )}
            </h1>
            <div className="text-sm text-muted-foreground">{new Date(invoice.date).toLocaleString()}</div>
          </div>
        </div>
        
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-2" /> Print Receipt
          </Button>
        </div>
      </div>

      <div className="p-6 max-w-5xl mx-auto w-full flex flex-col gap-8">
        
        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <CustomerCard customer={invoice.customer} />
          <CashierCard employee={invoice.employee} />
        </div>

        {/* Items */}
        <InvoiceItemsTable items={invoice.items} />

        {/* Footer Math & Ledger */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <PaymentLedger 
            payments={invoice.payments} 
            totalPaid={invoice.paidAmount} 
            dueAmount={invoice.dueAmount} 
            grandTotal={invoice.grandTotal} 
          />

          <div className="bg-card rounded-lg border border-border p-6 flex flex-col gap-3">
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider border-b border-border pb-2 mb-2">Order Summary</h3>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium">₹{invoice.subtotal.toFixed(2)}</span>
            </div>
            {invoice.discountAmount > 0 && (
              <div className="flex justify-between text-sm text-emerald-500">
                <span>System Discount</span>
                <span>-₹{invoice.discountAmount.toFixed(2)}</span>
              </div>
            )}
            {invoice.manualDiscountAmount > 0 && (
              <div className="flex justify-between text-sm text-emerald-500">
                <span>Manual Discount</span>
                <span>-₹{invoice.manualDiscountAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tax</span>
              <span className="font-medium">₹{invoice.taxAmount.toFixed(2)}</span>
            </div>
            
            <div className="flex justify-between text-xl font-bold mt-4 pt-4 border-t border-border">
              <span>Grand Total</span>
              <span>₹{invoice.grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
