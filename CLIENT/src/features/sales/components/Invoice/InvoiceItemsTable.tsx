import { InvoiceDetailModel } from "../../types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";

export function InvoiceItemsTable({ items }: { items: InvoiceDetailModel["items"] }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>Barcode</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Tax</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <div className="font-medium">{item.productName}</div>
                <div className="text-xs text-muted-foreground">
                  {item.sizeName} • {item.colorName}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">{item.sku}</TableCell>
              <TableCell className="text-muted-foreground text-xs font-mono">{item.barcode || "-"}</TableCell>
              <TableCell className="text-right">{item.quantity}</TableCell>
              <TableCell className="text-right">₹{item.sellingPrice.toFixed(2)}</TableCell>
              <TableCell className="text-right">₹{item.taxAmount.toFixed(2)} ({item.taxRate}%)</TableCell>
              <TableCell className="text-right font-bold">₹{item.totalPrice.toFixed(2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
