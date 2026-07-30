import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { LabelToolbar } from "@/features/labels";
import { formatCurrency } from "@/utils/formatters";
import type { ProductVariantRow } from "../types";
import { ProductStatusBadge } from "./ProductStatusBadge";

const num = (v: number | string | null | undefined): number =>
  v == null ? 0 : typeof v === "number" ? v : Number(v);

/**
 * ProductVariantTable — lists a product's variants (size/color/SKU/barcode/
 * price/stock). `showFinancials` adds the Cost column for owners; managers pass
 * false and never see cost. The same component renders in both modules' detail
 * views.
 *
 * `showLabelActions` adds a per-variant Print/Preview column backed by the
 * Label Engine. It is opt-in rather than always-on because this table also
 * renders inside read-only contexts (and in the print job drawer itself, where
 * a nested print button would be circular). The toolbar handles its own RBAC,
 * so enabling it never leaks an action a role cannot perform.
 */
export function ProductVariantTable({
  variants,
  showFinancials = false,
  showLabelActions = false,
  productName,
}: {
  variants: ProductVariantRow[];
  showFinancials?: boolean;
  showLabelActions?: boolean;
  /** Used to label the variant in the print dialog summary. */
  productName?: string;
}) {
  if (variants.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        This product has no variants yet.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Variant</TableHead>
          <TableHead>SKU</TableHead>
          <TableHead>Barcode</TableHead>
          {showFinancials && <TableHead className="text-right">Cost</TableHead>}
          <TableHead className="text-right">MRP</TableHead>
          <TableHead className="text-right">Selling</TableHead>
          <TableHead className="text-right">Stock</TableHead>
          <TableHead>Status</TableHead>
          {showLabelActions && <TableHead className="text-right">Label</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {variants.map((v) => (
          <TableRow key={v.id}>
            <TableCell>
              <div className="flex items-center gap-2">
                {v.color?.hexCode && (
                  <span
                    className="h-3 w-3 rounded-full border border-border shrink-0"
                    style={{ backgroundColor: v.color.hexCode }}
                    aria-hidden
                  />
                )}
                <span className="font-medium">
                  {[v.size?.name, v.color?.name].filter(Boolean).join(" / ") || "—"}
                </span>
              </div>
            </TableCell>
            <TableCell className="font-mono text-xs">{v.sku}</TableCell>
            <TableCell className="font-mono text-xs">{v.barcode ?? "—"}</TableCell>
            {showFinancials && (
              <TableCell className="text-right">{formatCurrency(num(v.costPrice))}</TableCell>
            )}
            <TableCell className="text-right text-muted-foreground">
              {formatCurrency(num(v.mrp))}
            </TableCell>
            <TableCell className="text-right font-medium">
              {formatCurrency(num(v.sellingPrice))}
            </TableCell>
            <TableCell className="text-right">
              <span className={v.currentStock <= 0 ? "text-destructive font-medium" : ""}>
                {v.currentStock}
              </span>
            </TableCell>
            <TableCell>
              <ProductStatusBadge isActive={v.isActive} />
            </TableCell>
            {showLabelActions && (
              <TableCell>
                <div className="flex justify-end">
                  <LabelToolbar
                    compact
                    source="PRODUCT"
                    variants={[
                      {
                        variantId: v.id,
                        label: [
                          productName,
                          [v.size?.name, v.color?.name].filter(Boolean).join(" / "),
                        ]
                          .filter(Boolean)
                          .join(" — "),
                        sku: v.sku,
                      },
                    ]}
                  />
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
