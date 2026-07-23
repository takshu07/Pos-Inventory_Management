import { InvoiceDetailModel } from "../../types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";

export function PaymentLedger({ payments, totalPaid, dueAmount, grandTotal }: { 
  payments: InvoiceDetailModel["payments"],
  totalPaid: number,
  dueAmount: number,
  grandTotal: number
}) {
  const overpaid = totalPaid > grandTotal ? totalPaid - grandTotal : 0;

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Payment Ledger</h3>
      
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Method</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{p.method}</TableCell>
                <TableCell>
                  <Badge variant={p.status === "COMPLETED" ? "success" : "default"}>{p.status}</Badge>
                </TableCell>
                <TableCell className="text-right font-medium">₹{p.amount.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="bg-muted/30 p-4 rounded-lg border border-border flex justify-between items-center text-sm">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Total Tendered</span>
          <span className="font-bold text-lg">₹{totalPaid.toFixed(2)}</span>
        </div>
        {overpaid > 0 && (
          <div className="flex flex-col gap-1 text-right">
            <span className="text-muted-foreground">Change Given</span>
            <span className="font-bold text-lg text-emerald-500">₹{overpaid.toFixed(2)}</span>
          </div>
        )}
        {dueAmount > 0 && (
          <div className="flex flex-col gap-1 text-right">
            <span className="text-muted-foreground">Balance Due</span>
            <span className="font-bold text-lg text-red-500">₹{dueAmount.toFixed(2)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
