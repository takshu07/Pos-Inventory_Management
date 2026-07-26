import { ImageOff } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { formatCurrency } from "@/utils/formatters";
import { cn } from "@/utils/cn";
import type { ProductColumn, ProductRow } from "../types";
import { formatMargin, formatSellingRange, formatMrpRange } from "../utils";
import { ProductStatusBadge } from "./ProductStatusBadge";
import { ProductStockIndicator } from "./ProductStockIndicator";

/**
 * ProductTable — the shared catalog data grid.
 *
 * Columns are selected via `columns`, and financial columns (cost/margin) are
 * only rendered when explicitly requested — the Owner module opts in, the
 * Manager module never does. An optional `renderActions` slot lets each module
 * inject its own row actions (owner: edit/delete/…, manager: copy/print) without
 * this component knowing anything about permissions. That separation is what
 * makes one table safe to share across two differently-authorized modules.
 */

const HEADERS: Record<ProductColumn, { label: string; align?: "right" }> = {
  image: { label: "" },
  name: { label: "Product" },
  sku: { label: "SKU" },
  barcode: { label: "Barcode" },
  category: { label: "Category" },
  brand: { label: "Brand" },
  cost: { label: "Cost", align: "right" },
  mrp: { label: "MRP", align: "right" },
  selling: { label: "Selling", align: "right" },
  margin: { label: "Margin", align: "right" },
  stock: { label: "Stock" },
  variants: { label: "Variants", align: "right" },
  status: { label: "Status" },
  updatedAt: { label: "Updated" },
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" });

export function ProductTable({
  products,
  columns,
  onRowClick,
  renderActions,
}: {
  products: ProductRow[];
  columns: ProductColumn[];
  onRowClick?: (product: ProductRow) => void;
  renderActions?: (product: ProductRow) => React.ReactNode;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col} className={HEADERS[col].align === "right" ? "text-right" : undefined}>
              {HEADERS[col].label}
            </TableHead>
          ))}
          {renderActions && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((p) => (
          <TableRow
            key={p.id}
            className={onRowClick ? "cursor-pointer" : undefined}
            onClick={onRowClick ? () => onRowClick(p) : undefined}
          >
            {columns.map((col) => (
              <TableCell
                key={col}
                className={cn(HEADERS[col].align === "right" && "text-right")}
              >
                <Cell col={col} product={p} />
              </TableCell>
            ))}
            {renderActions && (
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                {renderActions(p)}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Cell({ col, product: p }: { col: ProductColumn; product: ProductRow }) {
  switch (col) {
    case "image":
      return (
        <div className="h-10 w-10 overflow-hidden rounded-md border border-border bg-muted/20 flex items-center justify-center">
          {p.imageUrl ? (
            <img src={p.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <ImageOff className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      );
    case "name":
      return (
        <div className="min-w-0">
          <div className="font-medium truncate max-w-[240px]">{p.name}</div>
          {p.description && (
            <div className="text-xs text-muted-foreground truncate max-w-[240px]">
              {p.description}
            </div>
          )}
        </div>
      );
    case "sku":
      return <span className="font-mono text-xs">{p.primarySku ?? "—"}</span>;
    case "barcode":
      return <span className="font-mono text-xs">{p.primaryBarcode ?? "—"}</span>;
    case "category":
      return <span className="text-sm">{p.category?.name ?? "—"}</span>;
    case "brand":
      return <span className="text-sm">{p.brand?.name ?? "—"}</span>;
    case "cost":
      return <span>{p.avgCostPrice != null ? formatCurrency(p.avgCostPrice) : "—"}</span>;
    case "mrp":
      return <span className="text-muted-foreground">{formatMrpRange(p)}</span>;
    case "selling":
      return <span className="font-medium">{formatSellingRange(p)}</span>;
    case "margin":
      return <span className="text-emerald-600 dark:text-emerald-400">{formatMargin(p.avgMargin)}</span>;
    case "stock":
      return <ProductStockIndicator status={p.stockStatus} totalStock={p.totalStock} />;
    case "variants":
      return <span>{p.variantCount}</span>;
    case "status":
      return <ProductStatusBadge isActive={p.isActive} />;
    case "updatedAt":
      return <span className="text-xs text-muted-foreground">{fmtDate(p.updatedAt)}</span>;
    default:
      return null;
  }
}
