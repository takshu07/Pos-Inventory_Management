/**
 * The Stock Overview table — the module's main surface.
 *
 * Two things worth stating:
 *
 *   1. COST COLUMNS ARE CONDITIONAL ON THE PAYLOAD, NOT ON A ROLE CHECK. The
 *      server omits `costPrice`/`stockValue` entirely for non-owners, so the
 *      table asks "did the data arrive?" rather than re-deriving permissions on
 *      the client. If the server ever changes what it sends, the table follows
 *      automatically and cannot leak a column it was not given.
 *
 *   2. STOCK IS ONE CELL, NOT THREE. Physical / reserved / available are one
 *      fact — what is here, what is spoken for, what can be sold. Three columns
 *      invites reading "10" as sellable when 8 of it is on hold.
 */

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui";
import { cn } from "@/utils/cn";
import {
  InventoryTableSkeleton,
  ProductCell,
  StockCell,
  StockStatusBadge,
  VelocityBadge,
} from "./InventoryAtoms";
import {
  MOVEMENT_LABELS,
  formatCurrency,
  formatNumber,
  formatRelative,
  formatVariantName,
} from "../utils/format";
import type { StockRow } from "../types";

export function StockTable({
  rows,
  isLoading,
  onRowClick,
  renderActions,
}: {
  rows: StockRow[];
  isLoading?: boolean;
  onRowClick: (row: StockRow) => void;
  renderActions?: (row: StockRow) => React.ReactNode;
}) {
  // Presence of the key IS the permission signal — see the header note.
  const showCost = rows.some((r) => r.costPrice !== undefined);

  const columnCount = 9 + (showCost ? 2 : 0) + (renderActions ? 1 : 0);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[16rem]">Product</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead className="text-right">Stock</TableHead>
            <TableHead className="text-right">Reorder</TableHead>
            <TableHead>Status</TableHead>
            {showCost && <TableHead className="text-right">Cost</TableHead>}
            <TableHead className="text-right">Price</TableHead>
            {showCost && <TableHead className="text-right">Stock Value</TableHead>}
            <TableHead className="text-right">Sold</TableHead>
            <TableHead>Last Movement</TableHead>
            {renderActions && <TableHead className="w-12 text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <InventoryTableSkeleton columns={columnCount} />
          ) : (
            rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={() => onRowClick(row)}
                className={cn(
                  "cursor-pointer",
                  // An inactive variant is still shown — its stock and history
                  // matter — but dimmed so it never reads as live catalogue.
                  !row.isActive && "opacity-55"
                )}
              >
                <TableCell>
                  <ProductCell
                    imageUrl={row.imageUrl}
                    productName={row.productName}
                    variantName={formatVariantName(row.variantName)}
                    sku={row.sku}
                  />
                </TableCell>

                <TableCell className="whitespace-nowrap text-xs">
                  {row.categoryName ?? <span className="text-muted-foreground">—</span>}
                  {row.brandName && (
                    <div className="text-[11px] text-muted-foreground">{row.brandName}</div>
                  )}
                </TableCell>

                <TableCell className="max-w-[10rem] truncate text-xs text-muted-foreground">
                  {row.supplierName ?? "—"}
                </TableCell>

                <TableCell className="text-right">
                  <StockCell
                    currentStock={row.currentStock}
                    reserved={row.reserved}
                    available={row.available}
                    className="text-right"
                  />
                </TableCell>

                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                  {row.reorderLevel ?? "—"}
                </TableCell>

                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <StockStatusBadge status={row.status} />
                    <VelocityBadge velocity={row.velocity} />
                  </div>
                </TableCell>

                {showCost && (
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.costPrice)}
                  </TableCell>
                )}

                <TableCell className="text-right tabular-nums">
                  {formatCurrency(row.sellingPrice)}
                </TableCell>

                {showCost && (
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(row.stockValue)}
                  </TableCell>
                )}

                <TableCell className="text-right tabular-nums">
                  {formatNumber(row.unitsSold)}
                  <div className="text-[11px] font-normal text-muted-foreground">
                    {row.lastSaleAt ? formatRelative(row.lastSaleAt) : "never sold"}
                  </div>
                </TableCell>

                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {row.lastMovementAt ? (
                    <>
                      {formatRelative(row.lastMovementAt)}
                      {row.lastMovementType && (
                        <div className="text-[11px]">
                          {MOVEMENT_LABELS[row.lastMovementType]}
                        </div>
                      )}
                    </>
                  ) : (
                    "No movements"
                  )}
                </TableCell>

                {renderActions && (
                  <TableCell
                    className="text-right"
                    // The actions cell must not also trigger the row's drawer.
                    onClick={(e) => e.stopPropagation()}
                  >
                    {renderActions(row)}
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
