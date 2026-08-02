/**
 * Purchase Management — the procurement queue.
 *
 * Two independent status axes are shown side by side, because they genuinely
 * are independent: GOODS (draft → ordered → partial → received) and MONEY
 * (unpaid → part paid → paid/overdue). A bill can be fully received and unpaid,
 * or paid up front and not yet delivered. Collapsing them into one column is
 * the classic procurement UI mistake — it hides exactly the combination that
 * needs attention.
 *
 * OWNER-only, matching the backend.
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  AlertTriangle,
  IndianRupee,
  Plus,
  RotateCcw,
  Search,
  ShoppingCart,
  Truck,
} from "lucide-react";
import {
  Button,
  Card,
  Input,
  Pagination,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
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

import { PurchaseBuilderDrawer } from "../components/PurchaseBuilderDrawer";
import {
  MoneyCell,
  PurchaseStatusBadge,
  ReceiptProgressBar,
  SettlementBadge,
} from "../components/ProcurementAtoms";
import { usePurchaseFilters } from "../hooks/useProcurementFilters";
import { useCreatePurchase, usePurchases, useSupplierOptions } from "../hooks/useProcurement";
import type { PurchaseSortOption, PurchaseStatus, SettlementStatus } from "../types";

export default function PurchasesPage() {
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
  } = usePurchaseFilters(20);

  const [builderOpen, setBuilderOpen] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = usePurchases(serverParams);
  const { data: supplierOptions = [] } = useSupplierOptions();
  const createMutation = useCreatePurchase();

  const purchases = data?.data ?? [];

  const pageTotals = purchases.reduce(
    (acc, p) => ({
      value: acc.value + p.totalAmount,
      due: acc.due + p.dueAmount,
      awaiting: acc.awaiting + (p.status === "ORDERED" || p.status === "PARTIAL" ? 1 : 0),
    }),
    { value: 0, due: 0, awaiting: 0 }
  );

  if (!isOwner) {
    return (
      <ErrorState title="Not available" message="Purchase management is restricted to owners." />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Purchases</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Raise orders, receive stock, and track what you owe.
          </p>
        </div>
        <Button onClick={() => setBuilderOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New purchase
        </Button>
      </div>

      {isLoading ? (
        <KpiGridSkeleton count={4} />
      ) : (
        <KpiGrid>
          <KpiCard
            label="Purchases"
            value={data?.total ?? 0}
            format={formatNumber}
            icon={ShoppingCart}
          />
          <KpiCard
            label="Awaiting delivery"
            value={pageTotals.awaiting}
            format={formatNumber}
            icon={Truck}
            hint="on this page"
            accent={pageTotals.awaiting > 0 ? "info" : "default"}
          />
          <KpiCard
            label="Value"
            value={pageTotals.value}
            format={formatCurrency}
            icon={IndianRupee}
            hint="on this page"
          />
          <KpiCard
            label="Outstanding"
            value={pageTotals.due}
            format={formatCurrency}
            icon={AlertTriangle}
            accent={pageTotals.due > 0 ? "warning" : "default"}
            hint="on this page"
          />
        </KpiGrid>
      )}

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <Card className="space-y-3 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by PO number, invoice number or supplier…"
              className="pl-9"
              aria-label="Search purchases"
            />
          </div>

          <Select
            value={filters.supplierId}
            onChange={(e) => setFilters({ supplierId: e.target.value })}
            aria-label="Filter by supplier"
            className="lg:w-56"
            options={[
              { value: "", label: "All suppliers" },
              ...supplierOptions.map((s) => ({ value: s.id, label: s.businessName })),
            ]}
          />
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Select
            value={filters.status}
            onChange={(e) => setFilters({ status: e.target.value as PurchaseStatus | "" })}
            aria-label="Filter by goods status"
            className="lg:w-48"
            options={[
              { value: "", label: "Any goods status" },
              { value: "DRAFT", label: "Draft" },
              { value: "ORDERED", label: "Ordered" },
              { value: "PARTIAL", label: "Partially received" },
              { value: "RECEIVED", label: "Received" },
              { value: "CANCELLED", label: "Cancelled" },
            ]}
          />

          <Select
            value={filters.paymentStatus}
            onChange={(e) =>
              setFilters({ paymentStatus: e.target.value as SettlementStatus | "" })
            }
            aria-label="Filter by payment status"
            className="lg:w-48"
            options={[
              { value: "", label: "Any payment status" },
              { value: "UNPAID", label: "Unpaid" },
              { value: "PARTIALLY_PAID", label: "Partly paid" },
              { value: "OVERDUE", label: "Overdue" },
              { value: "PAID", label: "Paid" },
            ]}
          />

          <Input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters({ dateFrom: e.target.value })}
            aria-label="From date"
            className="lg:w-40"
          />
          <Input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters({ dateTo: e.target.value })}
            aria-label="To date"
            className="lg:w-40"
          />

          <Select
            value={filters.sortBy}
            onChange={(e) => setFilters({ sortBy: e.target.value as PurchaseSortOption })}
            aria-label="Sort purchases"
            className="lg:w-48"
            options={[
              { value: "createdAt", label: "Newest first" },
              { value: "purchaseDate", label: "Purchase date" },
              { value: "totalAmount", label: "Value" },
              { value: "dueAmount", label: "Amount due" },
              { value: "purchaseNumber", label: "PO number" },
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

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      {isError ? (
        <ErrorState
          title="Could not load purchases"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <Card className="p-4">
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </Card>
      ) : purchases.length === 0 ? (
        <Card>
          <EmptyState
            title={hasActiveFilters ? "No purchases match those filters" : "No purchases yet"}
            description={
              hasActiveFilters
                ? "Try widening the date range or clearing the filters."
                : "Raise your first purchase order to bring stock in."
            }
            action={
              hasActiveFilters
                ? { label: "Clear filters", onClick: reset }
                : { label: "New purchase", onClick: () => setBuilderOpen(true) }
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
                    <TableHead>Purchase</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="min-w-[9rem]">Goods</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.map((p) => {
                    const ordered = p.items.reduce((s, i) => s + i.quantity, 0);
                    const received = p.items.reduce((s, i) => s + i.receivedQuantity, 0);

                    return (
                      <TableRow
                        key={p.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/admin/purchases/${p.id}`)}
                      >
                        <TableCell>
                          <Link
                            to={`/admin/purchases/${p.id}`}
                            className="font-medium text-foreground hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {p.purchaseNumber}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {formatNumber(p._count.items)} line(s)
                            {p.supplierInvoiceNumber ? ` · Inv ${p.supplierInvoiceNumber}` : ""}
                          </p>
                        </TableCell>

                        <TableCell>
                          <Link
                            to={`/admin/suppliers/${p.supplier.id}`}
                            className="text-sm hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {p.supplier.businessName}
                          </Link>
                        </TableCell>

                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDate(p.purchaseDate)}
                        </TableCell>

                        <TableCell>
                          <PurchaseStatusBadge status={p.status} />
                          {(p.status === "PARTIAL" || p.status === "ORDERED") && ordered > 0 && (
                            <div className="mt-1.5">
                              <ReceiptProgressBar received={received} ordered={ordered} />
                            </div>
                          )}
                        </TableCell>

                        <TableCell>
                          <SettlementBadge status={p.paymentStatus} />
                          {p.dueDate && p.dueAmount > 0 && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Due {formatDate(p.dueDate)}
                            </p>
                          )}
                        </TableCell>

                        <TableCell>
                          <MoneyCell>{formatCurrency(p.totalAmount)}</MoneyCell>
                        </TableCell>

                        <TableCell>
                          <MoneyCell strong={p.dueAmount > 0}>
                            <span
                              className={
                                p.paymentStatus === "OVERDUE"
                                  ? "text-destructive"
                                  : p.dueAmount > 0
                                    ? "text-amber-600 dark:text-amber-400"
                                    : ""
                              }
                            >
                              {formatCurrency(p.dueAmount)}
                            </span>
                          </MoneyCell>
                        </TableCell>
                      </TableRow>
                    );
                  })}
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

      <PurchaseBuilderDrawer
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        onSubmit={async (input) => {
          const created = await createMutation.mutateAsync(input);
          setBuilderOpen(false);
          navigate(`/admin/purchases/${created.id}`);
        }}
      />
    </div>
  );
}
