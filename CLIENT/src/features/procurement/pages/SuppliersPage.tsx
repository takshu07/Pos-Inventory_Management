/**
 * Supplier Management — list, search, filter, CRUD.
 *
 * OWNER-only, matching the backend. Clicking a row opens the full profile
 * (SupplierProfilePage) rather than a drawer: a supplier's purchase history,
 * payments and outstanding balance are too much for a side panel, and the
 * profile is a place users link to and bookmark.
 *
 * Outstanding balance is shown here rather than only on the profile because it
 * is the one number that decides who you call today.
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  IndianRupee,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Truck,
  Wallet,
} from "lucide-react";
import { Button, Card, Input, Pagination, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { EmptyState, ErrorState } from "@/components/ui/StateViews";
import {
  KpiCard,
  KpiGrid,
  KpiGridSkeleton,
  formatCurrency,
  formatDate,
  formatNumber,
} from "@/components/shared/bi";
import { useAuthStore } from "@/store/auth.store";
import { canAccessAdmin } from "@/features/auth/utils/permissions";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { SupplierFormDrawer } from "../components/SupplierFormDrawer";
import { ActiveBadge, MoneyCell } from "../components/ProcurementAtoms";
import { useCatalogFilters } from "../hooks/useProcurementFilters";
import {
  useCreateSupplier,
  useDeleteSupplier,
  useSuppliers,
  useUpdateSupplier,
} from "../hooks/useProcurement";
import type { Supplier, SupplierSortOption, SupplierWriteInput } from "../types";

export default function SuppliersPage() {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const isOwner = canAccessAdmin(role);
  const navigate = useNavigate();

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
  } = useCatalogFilters<SupplierSortOption>("businessName", 20);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useSuppliers(serverParams);

  const createMutation = useCreateSupplier();
  const updateMutation = useUpdateSupplier();
  const deleteMutation = useDeleteSupplier();

  const suppliers = data?.data ?? [];

  // Page-scoped totals — labelled as such so they are never mistaken for
  // company-wide payables (that number lives on the Finance dashboard).
  const pageTotals = suppliers.reduce(
    (acc, s) => ({
      outstanding: acc.outstanding + s.stats.outstanding,
      spend: acc.spend + s.stats.totalSpend,
    }),
    { outstanding: 0, spend: 0 }
  );

  if (!isOwner) {
    return (
      <ErrorState title="Not available" message="Supplier management is restricted to owners." />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Suppliers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who you buy from, what you owe them, and what you have paid.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New supplier
        </Button>
      </div>

      {isLoading ? (
        <KpiGridSkeleton count={3} columns={3} />
      ) : (
        <KpiGrid columns={3}>
          <KpiCard label="Suppliers" value={data?.total ?? 0} format={formatNumber} icon={Truck} />
          <KpiCard
            label="Outstanding"
            value={pageTotals.outstanding}
            format={formatCurrency}
            icon={Wallet}
            accent={pageTotals.outstanding > 0 ? "warning" : "default"}
            hint="on this page"
          />
          <KpiCard
            label="Lifetime spend"
            value={pageTotals.spend}
            format={formatCurrency}
            icon={IndianRupee}
            hint="on this page"
          />
        </KpiGrid>
      )}

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
              placeholder="Search by business, contact, phone or email…"
              className="pl-9"
              aria-label="Search suppliers"
            />
          </div>

          <Select
            value={filters.isActive}
            onChange={(e) => setFilters({ isActive: e.target.value as "true" | "false" | "" })}
            aria-label="Filter by status"
            className="lg:w-40"
            options={[
              { value: "", label: "All statuses" },
              { value: "true", label: "Active only" },
              { value: "false", label: "Inactive only" },
            ]}
          />

          <Select
            value={filters.sortBy}
            onChange={(e) => setFilters({ sortBy: e.target.value as SupplierSortOption })}
            aria-label="Sort suppliers"
            className="lg:w-48"
            options={[
              { value: "businessName", label: "Name (A–Z)" },
              { value: "createdAt", label: "Recently added" },
              { value: "updatedAt", label: "Recently updated" },
            ]}
          />

          {hasActiveFilters && (
            <Button variant="ghost" onClick={reset}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset
            </Button>
          )}
        </div>
      </Card>

      {isError ? (
        <ErrorState
          title="Could not load suppliers"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <Card className="p-4">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </Card>
      ) : suppliers.length === 0 ? (
        <Card>
          <EmptyState
            title={hasActiveFilters ? "No suppliers match those filters" : "No suppliers yet"}
            description={
              hasActiveFilters
                ? "Try a different search term or clear the filters."
                : "Add a supplier to start raising purchase orders."
            }
            action={
              hasActiveFilters
                ? { label: "Clear filters", onClick: reset }
                : {
                    label: "New supplier",
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
          <Card className={`overflow-hidden ${isFetching ? "opacity-60 transition-opacity" : ""}`}>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead className="text-right">Bills</TableHead>
                    <TableHead className="text-right">Lifetime spend</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead>Last purchase</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((s) => (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/admin/suppliers/${s.id}`)}
                    >
                      <TableCell>
                        <Link
                          to={`/admin/suppliers/${s.id}`}
                          className="font-medium text-foreground hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {s.businessName}
                        </Link>
                        {s.contactPerson && (
                          <p className="text-xs text-muted-foreground">{s.contactPerson}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <a
                          href={`tel:${s.phone}`}
                          className="inline-flex items-center gap-1 text-sm hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Phone className="h-3 w-3" aria-hidden="true" />
                          {s.phone}
                        </a>
                        {s.email && (
                          <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <MoneyCell>{formatNumber(s.stats.purchaseCount)}</MoneyCell>
                      </TableCell>
                      <TableCell>
                        <MoneyCell>{formatCurrency(s.stats.totalSpend)}</MoneyCell>
                      </TableCell>
                      <TableCell>
                        <MoneyCell strong={s.stats.outstanding > 0}>
                          <span className={s.stats.outstanding > 0 ? "text-amber-600 dark:text-amber-400" : ""}>
                            {formatCurrency(s.stats.outstanding)}
                          </span>
                        </MoneyCell>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {s.stats.lastPurchaseDate ? formatDate(s.stats.lastPurchaseDate) : "—"}
                      </TableCell>
                      <TableCell>
                        <ActiveBadge isActive={s.isActive} />
                      </TableCell>
                      <TableCell>
                        <div
                          className="flex justify-end gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(s);
                              setFormOpen(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleting(s)}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Delete ${s.businessName}`}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {(data?.totalPages ?? 1) > 1 && (
            <Pagination
              currentPage={page}
              totalPages={data?.totalPages ?? 1}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      <SupplierFormDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        supplier={editing}
        onSubmit={async (input: SupplierWriteInput) => {
          if (editing) await updateMutation.mutateAsync({ id: editing.id, input });
          else await createMutation.mutateAsync(input);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.businessName ?? "supplier"}?`}
        description={
          <>
            <p>This permanently removes the supplier. It cannot be undone.</p>
            {deleting && deleting.stats.purchaseCount > 0 && (
              <p className="mt-2">
                <strong>{deleting.businessName}</strong> has{" "}
                <strong>{deleting.stats.purchaseCount}</strong> bill(s) on record.
                Suppliers with history cannot be deleted — deactivating keeps the
                financial record intact while removing them from new purchases.
              </p>
            )}
          </>
        }
        confirmLabel="Delete supplier"
        onConfirm={() => deleteMutation.mutateAsync(deleting!.id)}
        {...(deleting && deleting.isActive
          ? {
              alternative: {
                label: "Deactivate instead",
                onClick: () => {
                  updateMutation.mutate({ id: deleting.id, input: { isActive: false } });
                  setDeleting(null);
                },
              },
            }
          : {})}
      />
    </div>
  );
}
