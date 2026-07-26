import { useState } from "react";
import { Copy, Check, Printer, Eye } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ProductRow } from "@/shared/product";

/**
 * ManagerProductRowActions — the manager's per-row actions. STRICTLY read-only /
 * non-mutating: view details, copy SKU, copy barcode, print label. There is no
 * edit/delete/archive here — managers cannot mutate the catalog, and the backend
 * would reject such calls with 403 regardless.
 */
export function ManagerProductRowActions({
  product,
  onView,
}: {
  product: ProductRow;
  onView: (p: ProductRow) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <Button variant="ghost" size="icon" onClick={() => onView(product)} aria-label="View details">
        <Eye className="h-4 w-4" />
      </Button>
      <CopyButton value={product.primarySku} label="SKU" />
      <CopyButton value={product.primaryBarcode} label="barcode" />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Print label"
        onClick={() => window.print()}
        title="Print label"
      >
        <Printer className="h-4 w-4" />
      </Button>
    </div>
  );
}

function CopyButton({ value, label }: { value: string | null; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={copy}
      disabled={!value}
      aria-label={`Copy ${label}`}
      title={value ? `Copy ${label}` : `No ${label}`}
    >
      {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}
