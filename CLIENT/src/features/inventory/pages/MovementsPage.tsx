/**
 * Inventory Movements — the stock ledger.
 *
 * This is the module's proof. Every stock change in the system appears here
 * with what it was before, what it became, who did it and why — including the
 * ones nobody typed, like a sale decrementing stock at the till.
 *
 * Rendered as a TABLE rather than the drawer's timeline: a ledger is read by
 * scanning a column ("show me every adjustment", "who touched this SKU"),
 * and columns scan where prose does not.
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { ExternalLink, ScrollText } from "lucide-react";

import {
  Card, EmptyState, ErrorState, Input, Pagination, Select,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui";
import { useDebounce } from "@/hooks/useDebounce";
import {
  DeltaCell,
  InventoryTableSkeleton,
  MovementBadge,
  ProductCell,
} from "../components/InventoryAtoms";
import { InventoryExportMenu } from "../components/InventoryExportMenu";
import { useMovements } from "../hooks/useInventory";
import {
  MOVEMENT_TYPE_OPTIONS,
  formatDateTime,
  formatVariantName,
} from "../utils/format";
import type { MovementType } from "../types";

const PAGE_SIZE = 25;

export default function MovementsPage() {
  const navigate = useNavigate();

  const [type, setType] = useState<MovementType | "">("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, refetch, isFetching } = useMovements({
    page,
    limit: PAGE_SIZE,
    ...(type ? { type } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const resetPage = () => setPage(1);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory Movements</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every stock change, in order. Nothing modifies stock without appearing here.
          </p>
        </div>

        <InventoryExportMenu
          report="movements"
          filters={{
            ...(type ? { type } : {}),
            ...(debouncedSearch ? { search: debouncedSearch } : {}),
            ...(dateFrom ? { dateFrom } : {}),
            ...(dateTo ? { dateTo } : {}),
          }}
          disabled={rows.length === 0}
        />
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <Input
            className="max-w-xs"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
            placeholder="Search by SKU, product or reference…"
            aria-label="Search movements"
          />

          <Select
            className="w-auto min-w-[11rem]"
            options={MOVEMENT_TYPE_OPTIONS}
            value={type}
            onChange={(e) => {
              setType(e.target.value as MovementType | "");
              resetPage();
            }}
            aria-label="Filter by movement type"
          />

          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              From
            </span>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                resetPage();
              }}
              className="w-auto"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              To
            </span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                resetPage();
              }}
              className="w-auto"
            />
          </label>

          {isFetching && (
            <span className="pb-2 text-xs text-muted-foreground">updating…</span>
          )}
        </div>
      </Card>

      {isError ? (
        <ErrorState message="Failed to load the ledger." onRetry={() => refetch()} />
      ) : !isLoading && rows.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-8 w-8 text-muted-foreground" />}
          title="No movements found"
          description="Nothing matches these filters. Stock changes appear here automatically as sales, purchases and adjustments happen."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">When</TableHead>
                <TableHead className="min-w-[16rem]">Product</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Before</TableHead>
                <TableHead className="text-right">After</TableHead>
                <TableHead className="min-w-[12rem]">Reason</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <InventoryTableSkeleton columns={9} />
              ) : (
                rows.map((m) => {
                  // Only link where there is somewhere to go.
                  const path = m.relatedSaleId
                    ? `/sales/${m.relatedSaleId}`
                    : m.relatedPurchaseId
                      ? `/admin/purchases?highlight=${m.relatedPurchaseId}`
                      : null;

                  return (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(m.createdAt)}
                      </TableCell>

                      <TableCell>
                        <ProductCell
                          imageUrl={m.imageUrl}
                          productName={m.productName ?? "Unknown product"}
                          variantName={formatVariantName(m.variantName)}
                          sku={m.sku ?? "—"}
                          onClick={() =>
                            navigate(`/admin/inventory/stock?inv_search=${m.sku ?? ""}`)
                          }
                        />
                      </TableCell>

                      <TableCell>
                        <MovementBadge type={m.type} />
                      </TableCell>

                      <TableCell className="text-right">
                        <DeltaCell value={m.quantityChanged} />
                      </TableCell>

                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {m.stockBefore}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {m.stockAfter}
                      </TableCell>

                      <TableCell className="max-w-[16rem] truncate text-xs">
                        {m.reason ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-xs">
                        {m.referenceNumber ? (
                          path ? (
                            <button
                              type="button"
                              onClick={() => navigate(path)}
                              className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
                            >
                              {m.referenceNumber}
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </button>
                          ) : (
                            <span className="font-mono text-muted-foreground">
                              {m.referenceNumber}
                            </span>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {m.employeeName ?? "System"}
                      </TableCell>
                    </TableRow>
                  );
                })
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
