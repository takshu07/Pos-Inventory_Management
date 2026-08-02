/**
 * Brand Management — full CRUD with catalogue and sales statistics.
 *
 * OWNER-only, matching the backend: every /brands route is `requireRole("OWNER")`.
 * The route sits inside OwnerRoute, so this page never renders for a manager —
 * the RBAC check below is defence in depth, not the boundary.
 *
 * SORTING NOTE: name/created/updated sort on the SERVER (indexed columns).
 * Product count and revenue sort on the CLIENT, within the current page only,
 * and the UI says so — those figures are computed per page, so a global sort
 * would need a rollup table. Silently sorting one page while implying a global
 * order would be a lie about the data.
 */

import { useMemo, useState } from "react";
import { Layers, Package, Plus, RotateCcw, Search, TrendingUp } from "lucide-react";
import { Button, Card, Input, Pagination, Select } from "@/components/ui";
import { EmptyState, ErrorState } from "@/components/ui/StateViews";
import {
  KpiCard,
  KpiGrid,
  KpiGridSkeleton,
  formatCurrency,
  formatNumber,
} from "@/components/shared/bi";
import { useAuthStore } from "@/store/auth.store";
import { canAccessAdmin } from "@/features/auth/utils/permissions";

import { BrandFormDrawer } from "../components/BrandFormDrawer";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ActiveBadge } from "../components/ProcurementAtoms";
import { useCatalogFilters } from "../hooks/useProcurementFilters";
import {
  useBrands,
  useCreateBrand,
  useDeleteBrand,
  useUpdateBrand,
} from "../hooks/useProcurement";
import type { Brand, BrandSortOption, BrandWriteInput } from "../types";

/** Client-side sorts, explicitly scoped to the current page. */
type LocalSort = "" | "productCount" | "revenue" | "stockValue";

export default function BrandsPage() {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const isOwner = canAccessAdmin(role);

  const {
    filters,
    setFilters,
    searchInput,
    setSearchInput,
    page,
    setPage,
    reset,
    hasActiveFilters,
    serverParams,
  } = useCatalogFilters<BrandSortOption>("name", 20);

  const [localSort, setLocalSort] = useState<LocalSort>("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Brand | null>(null);
  const [deleting, setDeleting] = useState<Brand | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useBrands(serverParams);

  const createMutation = useCreateBrand();
  const updateMutation = useUpdateBrand();
  const deleteMutation = useDeleteBrand();

  const brands = data?.data ?? [];

  const existingNames = useMemo(() => brands.map((b) => b.name), [brands]);

  // Page-local sort. Applied after the server's ordering so the two compose
  // predictably: the server decides WHICH brands are on this page, this decides
  // how they are arranged within it.
  const visible = useMemo(() => {
    if (!localSort) return brands;
    return [...brands].sort((a, b) => b.stats[localSort] - a.stats[localSort]);
  }, [brands, localSort]);

  // Totals across the current page, labelled as such in the UI.
  const pageTotals = useMemo(
    () =>
      brands.reduce(
        (acc, b) => ({
          products: acc.products + b.stats.productCount,
          revenue: acc.revenue + b.stats.revenue,
          stockValue: acc.stockValue + b.stats.stockValue,
        }),
        { products: 0, revenue: 0, stockValue: 0 }
      ),
    [brands]
  );

  if (!isOwner) {
    return (
      <ErrorState
        title="Not available"
        message="Brand management is restricted to owners."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Brands</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage brands and see how each one performs.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New brand
        </Button>
      </div>

      {/* ── Page KPIs ──────────────────────────────────────────────────────── */}
      {isLoading ? (
        <KpiGridSkeleton count={4} />
      ) : (
        <KpiGrid>
          <KpiCard label="Brands" value={data?.total ?? 0} format={formatNumber} icon={Layers} />
          <KpiCard
            label="Products"
            value={pageTotals.products}
            format={formatNumber}
            icon={Package}
            hint="on this page"
          />
          <KpiCard
            label="Revenue"
            value={pageTotals.revenue}
            format={formatCurrency}
            icon={TrendingUp}
            hint="on this page"
          />
          <KpiCard
            label="Stock value"
            value={pageTotals.stockValue}
            format={formatCurrency}
            hint="on this page"
          />
        </KpiGrid>
      )}

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search brands by name or description…"
              className="pl-9"
              aria-label="Search brands"
            />
          </div>

          <Select
            value={filters.isActive}
            onChange={(e) =>
              setFilters({ isActive: e.target.value as "true" | "false" | "" })
            }
            aria-label="Filter by status"
            className="lg:w-40"
            options={[
              { value: "", label: "All statuses" },
              { value: "true", label: "Active only" },
              { value: "false", label: "Inactive only" },
            ]}
          />

          <Select
            value={localSort || filters.sortBy}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "productCount" || v === "revenue" || v === "stockValue") {
                setLocalSort(v);
              } else {
                setLocalSort("");
                setFilters({ sortBy: v as BrandSortOption });
              }
            }}
            aria-label="Sort brands"
            className="lg:w-56"
            options={[
              { value: "name", label: "Name (A–Z)" },
              { value: "createdAt", label: "Recently added" },
              { value: "updatedAt", label: "Recently updated" },
              { value: "productCount", label: "Most products (this page)" },
              { value: "revenue", label: "Highest revenue (this page)" },
              { value: "stockValue", label: "Highest stock value (this page)" },
            ]}
          />

          {(hasActiveFilters || localSort) && (
            <Button
              variant="ghost"
              onClick={() => {
                setLocalSort("");
                reset();
              }}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset
            </Button>
          )}
        </div>

        {localSort && (
          <p className="mt-3 text-xs text-muted-foreground">
            Sorting by {localSort === "productCount" ? "product count" : localSort === "revenue" ? "revenue" : "stock value"} within
            this page only — these figures are calculated per page.
          </p>
        )}
      </Card>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      {isError ? (
        <ErrorState
          title="Could not load brands"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <BrandGridSkeleton />
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            title={hasActiveFilters ? "No brands match those filters" : "No brands yet"}
            description={
              hasActiveFilters
                ? "Try a different search term or clear the filters."
                : "Create your first brand to group products and track performance."
            }
            action={
              hasActiveFilters
                ? { label: "Clear filters", onClick: reset }
                : {
                    label: "New brand",
                    onClick: () => {
                      setEditing(null);
                      setFormOpen(true);
                    },
                  }
            }
          />
        </Card>
      ) : (
        <>
          <div
            className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-3 ${isFetching ? "opacity-60 transition-opacity" : ""}`}
          >
            {visible.map((brand) => (
              <BrandCard
                key={brand.id}
                brand={brand}
                onEdit={() => {
                  setEditing(brand);
                  setFormOpen(true);
                }}
                onDelete={() => setDeleting(brand)}
                onToggleActive={() =>
                  updateMutation.mutate({
                    id: brand.id,
                    input: { isActive: !brand.isActive },
                  })
                }
              />
            ))}
          </div>

          {(data?.totalPages ?? 1) > 1 && (
            <Pagination
              currentPage={page}
              totalPages={data?.totalPages ?? 1}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      {/* ── Dialogs ────────────────────────────────────────────────────────── */}
      <BrandFormDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        brand={editing}
        existingNames={existingNames}
        onSubmit={async (input: BrandWriteInput) => {
          if (editing) {
            await updateMutation.mutateAsync({ id: editing.id, input });
          } else {
            await createMutation.mutateAsync(input);
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? "brand"}?`}
        description={
          <>
            <p>
              This permanently removes the brand. It cannot be undone.
            </p>
            {deleting && deleting.stats.productCount > 0 && (
              <p className="mt-2">
                <strong>{deleting.name}</strong> has{" "}
                <strong>{deleting.stats.productCount}</strong> product(s). Brands
                in use cannot be deleted — deactivate it instead to hide it from
                pickers while keeping its history.
              </p>
            )}
          </>
        }
        confirmLabel="Delete brand"
        onConfirm={() => deleteMutation.mutateAsync(deleting!.id)}
        {...(deleting && deleting.isActive
          ? {
              alternative: {
                label: "Deactivate instead",
                onClick: () => {
                  updateMutation.mutate({
                    id: deleting.id,
                    input: { isActive: false },
                  });
                  setDeleting(null);
                },
              },
            }
          : {})}
      />
    </div>
  );
}

// =============================================================================
// CARD
// =============================================================================

function BrandCard({
  brand,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  brand: Brand;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start gap-3">
        {brand.logoUrl ? (
          <img
            src={brand.logoUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded-lg object-contain"
            loading="lazy"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Layers className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-semibold text-foreground" title={brand.name}>
              {brand.name}
            </h3>
            <ActiveBadge isActive={brand.isActive} />
          </div>
          {brand.description && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {brand.description}
            </p>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
        <Stat label="Products" value={formatNumber(brand.stats.productCount)} />
        <Stat label="Variants" value={formatNumber(brand.stats.variantCount)} />
        <Stat label="Units sold" value={formatNumber(brand.stats.unitsSold)} />
        <Stat label="Revenue" value={formatCurrency(brand.stats.revenue)} />
        <Stat label="In stock" value={formatNumber(brand.stats.stockUnits)} />
        <Stat label="Stock value" value={formatCurrency(brand.stats.stockValue)} />
      </dl>

      <div className="mt-4 flex gap-2 border-t border-border pt-4">
        <Button size="sm" variant="outline" onClick={onEdit} className="flex-1">
          Edit
        </Button>
        <Button size="sm" variant="ghost" onClick={onToggleActive}>
          {brand.isActive ? "Deactivate" : "Activate"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Delete ${brand.name}`}
        >
          Delete
        </Button>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function BrandGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="p-5">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
            {Array.from({ length: 6 }).map((__, j) => (
              <div key={j} className="space-y-1">
                <div className="h-3 w-12 animate-pulse rounded bg-muted" />
                <div className="h-4 w-16 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
