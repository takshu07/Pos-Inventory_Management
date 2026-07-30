/**
 * Damaged Stock.
 *
 * These units have ALREADY been deducted from sellable stock — writing off
 * damage removes it from the shelf count via a DAMAGED ledger entry and records
 * why here. This page is the "why", which is what makes the loss reportable
 * without having to parse reason strings out of the movement ledger.
 */

import { useState } from "react";
import { Wrench } from "lucide-react";

import {
  Badge, EmptyState, ErrorState, Pagination, Select,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui";
import {
  InventoryTableSkeleton,
  KpiCard,
  ProductCell,
} from "../components/InventoryAtoms";
import { useDamaged } from "../hooks/useInventory";
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatVariantName,
} from "../utils/format";

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "All damage" },
  { value: "false", label: "Not yet written off" },
  { value: "true", label: "Written off" },
];

export default function DamagedStockPage() {
  const [writtenOff, setWrittenOff] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useDamaged({
    page,
    limit: PAGE_SIZE,
    ...(writtenOff ? { isWrittenOff: writtenOff === "true" } : {}),
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const showCost = rows.some((r) => r.lossValue !== undefined);
  const pageUnits = rows.reduce((sum, r) => sum + r.quantity, 0);
  const pageLoss = rows.reduce((sum, r) => sum + (r.lossValue ?? 0), 0);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Damaged Stock</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Goods written off as unsellable. These units were already removed from stock when
            they were reported — this is the record of what happened and why.
          </p>
        </div>

        <Select
          className="w-auto min-w-[12rem]"
          options={STATUS_OPTIONS}
          value={writtenOff}
          onChange={(e) => {
            setWrittenOff(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by write-off state"
        />
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiCard icon={Wrench} label="Records" value={formatNumber(total)} />
          <KpiCard
            icon={Wrench}
            label="Units lost"
            value={formatNumber(pageUnits)}
            hint="this page"
            accent="text-destructive"
          />
          {showCost && (
            <KpiCard
              icon={Wrench}
              label="Value lost"
              value={formatCurrency(pageLoss)}
              hint="this page, at cost"
              accent="text-destructive"
            />
          )}
        </div>
      )}

      {isError ? (
        <ErrorState message="Failed to load damaged stock." onRetry={() => refetch()} />
      ) : !isLoading && rows.length === 0 ? (
        <EmptyState
          icon={<Wrench className="h-8 w-8 text-muted-foreground" />}
          title="No damaged stock"
          description="Nothing has been written off as damaged. Report damage from an item's inventory drawer."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reported</TableHead>
                <TableHead className="min-w-[16rem]">Product</TableHead>
                <TableHead className="text-right">Units</TableHead>
                {showCost && <TableHead className="text-right">Loss</TableHead>}
                <TableHead className="min-w-[14rem]">Reason</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <InventoryTableSkeleton columns={showCost ? 7 : 6} />
              ) : (
                rows.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(d.reportedAt)}
                    </TableCell>

                    <TableCell>
                      <ProductCell
                        imageUrl={d.imageUrl}
                        productName={d.productName}
                        variantName={formatVariantName(d.variantName)}
                        sku={d.sku}
                      />
                    </TableCell>

                    <TableCell className="text-right font-medium tabular-nums text-destructive">
                      {formatNumber(d.quantity)}
                    </TableCell>

                    {showCost && (
                      <TableCell className="text-right tabular-nums text-destructive">
                        {formatCurrency(d.lossValue)}
                      </TableCell>
                    )}

                    <TableCell className="max-w-[16rem] truncate text-xs">{d.reason}</TableCell>

                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {d.reportedByName ?? "—"}
                    </TableCell>

                    <TableCell>
                      {d.isWrittenOff ? (
                        <Badge variant="secondary">Written off</Badge>
                      ) : (
                        <Badge variant="warning">Pending disposal</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {total > 0 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}
    </div>
  );
}
