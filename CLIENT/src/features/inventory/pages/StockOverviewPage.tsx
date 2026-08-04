/**
 * Stock Overview — the inventory module's main table.
 *
 * FILTER OPTIONS come from the shared catalog lookup endpoints, NOT from the
 * loaded rows. Deriving them from the current page looked cheaper — no extra
 * request, and the lists only showed things that actually have stock — but it
 * broke the filters in two ways: an option vanished from the dropdown as soon
 * as you paged past the rows that produced it (including the one you had
 * selected), and a category whose items were all on some other page could not
 * be selected at all. A filter's option list has to describe the whole
 * catalogue, not the current page of it. The lookups are cached app-wide and
 * prefetched by the shell, so this costs nothing on a warm cache.
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { PackageSearch } from "lucide-react";

import { EmptyState, ErrorState, Pagination } from "@/components/ui";
import { useCategoryOptions, useBrandOptions } from "@/features/owner/products/hooks/useOwnerProducts";
import { useSupplierOptions } from "@/features/procurement/hooks/useProcurement";
import { AdjustStockDialog } from "../components/AdjustStockDialog";
import { InventoryDrawer } from "../components/InventoryDrawer";
import { InventoryExportMenu } from "../components/InventoryExportMenu";
import { StockFilters, StockSearch } from "../components/StockFilters";
import { StockTable } from "../components/StockTable";
import { useInventoryFilters } from "../hooks/useInventoryFilters";
import { useStock } from "../hooks/useInventory";
import * as api from "../api/inventoryApi";
import type { StockRow } from "../types";

export default function StockOverviewPage() {
  const navigate = useNavigate();

  const {
    filters,
    setFilters,
    page,
    limit,
    setPage,
    reset,
    hasActiveFilters,
    serverParams,
    isSearching,
  } = useInventoryFilters("inv", 25);

  const [selected, setSelected] = useState<StockRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useStock(serverParams);

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Catalogue-wide filter options — see the note at the top of this file.
  const { data: categories = [], isPending: categoriesPending } = useCategoryOptions();
  const { data: brands = [], isPending: brandsPending } = useBrandOptions();
  const { data: suppliers = [], isPending: suppliersPending } = useSupplierOptions();
  const optionsLoading = categoriesPending || brandsPending || suppliersPending;

  const openDrawer = (row: StockRow) => {
    setSelected(row);
    setDrawerOpen(true);
  };

  /**
   * A scan is an unambiguous identification, so it opens the item directly
   * rather than filtering the table down to one row and making the user click.
   */
  const handleScan = async (code: string) => {
    setScanError(null);
    try {
      const found = await api.scanCode(code);
      openDrawer(found);
    } catch {
      setScanError(`No product found for "${code}".`);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stock Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every item you own — what is on hand, what is held, and what can be sold.
          </p>
        </div>

        {/* The export mirrors the current filters exactly, and covers every
            matching row rather than just this page. */}
        <InventoryExportMenu
          report="stock"
          filters={serverParams as Record<string, unknown>}
          disabled={rows.length === 0}
        />
      </div>

      <div className="flex flex-col gap-3">
        <StockSearch
          value={filters.search}
          onChange={(v) => {
            setFilters({ search: v });
            setScanError(null);
          }}
          onScan={handleScan}
          loading={isSearching || isFetching}
        />

        {scanError && <p className="text-sm text-destructive">{scanError}</p>}

        <StockFilters
          filters={filters}
          onChange={setFilters}
          onReset={reset}
          hasActiveFilters={hasActiveFilters}
          categories={categories}
          brands={brands}
          suppliers={suppliers}
          optionsLoading={optionsLoading}
        />
      </div>

      {isError ? (
        <ErrorState message="Failed to load inventory." onRetry={() => refetch()} />
      ) : !isLoading && rows.length === 0 ? (
        <EmptyState
          icon={<PackageSearch className="h-8 w-8 text-muted-foreground" />}
          title={hasActiveFilters ? "No stock matches these filters" : "No inventory yet"}
          description={
            hasActiveFilters
              ? "Try clearing the filters to see everything you hold."
              : "Once products are added and stock is received, it will appear here."
          }
          {...(hasActiveFilters
            ? { action: { label: "Clear filters", onClick: reset } }
            : {})}
        />
      ) : (
        <StockTable rows={rows} isLoading={isLoading} onRowClick={openDrawer} />
      )}

      {total > 0 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}

      <InventoryDrawer
        row={selected}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onNavigate={(path) => navigate(path)}
        // Adjusting is available to anyone who may REQUEST one — a manager's
        // request lands in the approval queue rather than changing stock, which
        // the dialog says explicitly. The endpoints enforce the same split.
        onAdjust={(row) => {
          setDrawerOpen(false);
          setAdjusting(row);
        }}
      />

      <AdjustStockDialog
        row={adjusting}
        open={Boolean(adjusting)}
        onClose={() => setAdjusting(null)}
      />
    </div>
  );
}
