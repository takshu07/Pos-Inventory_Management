/**
 * Supplier profile — the full relationship on one screen.
 *
 * Tabs are URL-synced via `?tab=` rather than useState, matching the reports
 * module: it keeps bookmarking, sharing, refresh and the Back button working,
 * which plain component state silently breaks.
 *
 * The outstanding balance is the server's summed `dueAmount` across bills, NOT
 * (spend − paid) recomputed here. Those differ the moment an on-account payment
 * exists, and the bills' own balance is the authoritative liability.
 */

import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  ArrowLeft,
  IndianRupee,
  Mail,
  MapPin,
  Package,
  Phone,
  Plus,
  Receipt,
  Wallet,
} from "lucide-react";
import {
  Button,
  Card,
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
  formatCurrencyExact,
  formatDate,
  formatDateTime,
  formatNumber,
} from "@/components/shared/bi";
import { useAuthStore } from "@/store/auth.store";
import { canAccessAdmin } from "@/features/auth/utils/permissions";

import { RecordPaymentDialog } from "../components/RecordPaymentDialog";
import { SupplierFormDrawer } from "../components/SupplierFormDrawer";
import {
  ActiveBadge,
  DetailField,
  MoneyCell,
  NoticeStrip,
  PurchaseStatusBadge,
  SettlementBadge,
} from "../components/ProcurementAtoms";
import {
  useRecordPayment,
  useSupplier,
  useUpdateSupplier,
} from "../hooks/useProcurement";

type Tab = "purchases" | "payments" | "products" | "details";

const TABS: { id: Tab; label: string }[] = [
  { id: "purchases", label: "Purchase history" },
  { id: "payments", label: "Payments" },
  { id: "products", label: "Supplied products" },
  { id: "details", label: "Details" },
];

export default function SupplierProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role ?? null);
  const isOwner = canAccessAdmin(role);

  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "purchases";
  const setTab = (next: Tab) =>
    setParams((prev) => {
      prev.set("tab", next);
      return prev;
    }, { replace: true });

  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const { data: supplier, isLoading, isError, error, refetch } = useSupplier(id ?? null);
  const updateMutation = useUpdateSupplier();
  const paymentMutation = useRecordPayment();

  if (!isOwner) {
    return <ErrorState title="Not available" message="Supplier profiles are restricted to owners." />;
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <KpiGridSkeleton count={4} />
        <Card className="p-4">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  if (isError || !supplier) {
    return (
      <ErrorState
        title="Could not load this supplier"
        message={error instanceof Error ? error.message : "The supplier may have been removed."}
        onRetry={() => refetch()}
      />
    );
  }

  const s = supplier.stats;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/suppliers")}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All suppliers
        </Button>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {supplier.businessName}
              </h1>
              <ActiveBadge isActive={supplier.isActive} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {supplier.contactPerson && <span>{supplier.contactPerson}</span>}
              <a href={`tel:${supplier.phone}`} className="inline-flex items-center gap-1 hover:underline">
                <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                {supplier.phone}
              </a>
              {supplier.email && (
                <a href={`mailto:${supplier.email}`} className="inline-flex items-center gap-1 hover:underline">
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  {supplier.email}
                </a>
              )}
            </div>
          </div>

          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            <Button onClick={() => setPayOpen(true)} disabled={!supplier.isActive && s.outstanding <= 0}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Record payment
            </Button>
          </div>
        </div>
      </div>

      {!supplier.isActive && (
        <NoticeStrip>
          This supplier is inactive. Existing bills and payments are unaffected, but
          they cannot be selected for new purchase orders.
        </NoticeStrip>
      )}

      {/* ── Money ──────────────────────────────────────────────────────────── */}
      <KpiGrid>
        <KpiCard
          label="Outstanding"
          value={s.outstanding}
          format={formatCurrency}
          icon={Wallet}
          accent={s.outstanding > 0 ? "warning" : "success"}
          hint={s.outstanding > 0 ? "Across unsettled bills" : "Nothing owed"}
        />
        <KpiCard
          label="Lifetime spend"
          value={s.totalSpend}
          format={formatCurrency}
          icon={IndianRupee}
          hint={`${formatNumber(s.purchaseCount)} bill(s)`}
        />
        <KpiCard
          label="Total paid"
          value={s.totalPaid}
          format={formatCurrency}
          icon={Receipt}
          hint={`${formatNumber(s.paymentCount)} payment(s)`}
        />
        <KpiCard
          label="Products supplied"
          value={s.suppliedVariantCount}
          format={formatNumber}
          icon={Package}
        />
      </KpiGrid>

      {s.onAccountCredit > 0 && (
        <NoticeStrip tone="info">
          {formatCurrencyExact(s.onAccountCredit)} has been paid on account — not
          applied to any specific bill. Apply it when settling the next invoice.
        </NoticeStrip>
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="border-b border-border">
        <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Supplier sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "purchases" && <PurchasesTab rows={supplier.purchases} />}
      {tab === "payments" && <PaymentsTab rows={supplier.payments} />}
      {tab === "products" && <ProductsTab rows={supplier.products} />}
      {tab === "details" && <DetailsTab supplier={supplier} />}

      {/* ── Dialogs ────────────────────────────────────────────────────────── */}
      <SupplierFormDrawer
        open={editOpen}
        onClose={() => setEditOpen(false)}
        supplier={supplier}
        onSubmit={async (input) => {
          await updateMutation.mutateAsync({ id: supplier.id, input });
        }}
      />

      <RecordPaymentDialog
        open={payOpen}
        onClose={() => setPayOpen(false)}
        supplierId={supplier.id}
        supplierName={supplier.businessName}
        onSubmit={async (input) => {
          await paymentMutation.mutateAsync(input);
        }}
      />
    </div>
  );
}

// =============================================================================
// TABS
// =============================================================================

function PurchasesTab({ rows }: { rows: import("../types").SupplierPurchaseRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No purchases yet"
          description="Bills raised against this supplier will appear here."
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Purchase</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Goods</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link
                    to={`/admin/purchases/${p.id}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {p.purchaseNumber}
                  </Link>
                  {p.supplierInvoiceNumber && (
                    <p className="text-xs text-muted-foreground">
                      Inv {p.supplierInvoiceNumber}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(p.purchaseDate)}
                </TableCell>
                <TableCell>
                  <PurchaseStatusBadge status={p.status} showIcon={false} />
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
                  <MoneyCell muted>{formatCurrency(p.paidAmount)}</MoneyCell>
                </TableCell>
                <TableCell>
                  <MoneyCell strong={p.dueAmount > 0}>
                    <span className={p.dueAmount > 0 ? "text-amber-600 dark:text-amber-400" : ""}>
                      {formatCurrency(p.dueAmount)}
                    </span>
                  </MoneyCell>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <TabFootnote count={rows.length} noun="purchase" />
    </Card>
  );
}

function PaymentsTab({ rows }: { rows: import("../types").SupplierPaymentRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No payments recorded"
          description="Payments made to this supplier will appear here."
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Payment</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Against</TableHead>
              <TableHead>Recorded by</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.paymentNumber}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDateTime(p.paidAt)}
                </TableCell>
                <TableCell className="text-sm">
                  {p.paymentMethod.replace("_", " ").toLowerCase()}
                  {p.referenceNumber && (
                    <p className="text-xs text-muted-foreground">{p.referenceNumber}</p>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {p.purchase ? (
                    <Link
                      to={`/admin/purchases/${p.purchase.id}`}
                      className="hover:underline"
                    >
                      {p.purchase.purchaseNumber}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">On account</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {p.createdBy ? `${p.createdBy.firstName} ${p.createdBy.lastName}` : "—"}
                </TableCell>
                <TableCell>
                  <MoneyCell strong>{formatCurrencyExact(p.amount)}</MoneyCell>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <TabFootnote count={rows.length} noun="payment" />
    </Card>
  );
}

function ProductsTab({ rows }: { rows: import("../types").SuppliedProductRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No products linked"
          description="Product variants sourced from this supplier will appear here."
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Supplier SKU</TableHead>
              <TableHead className="text-right">Lead time</TableHead>
              <TableHead className="text-right">In stock</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((v) => (
              <TableRow key={v.id}>
                <TableCell>
                  <span className="font-medium text-foreground">{v.product.name}</span>
                  <p className="text-xs text-muted-foreground">
                    {[v.size?.name, v.color?.name].filter(Boolean).join(" · ") || "—"}
                  </p>
                </TableCell>
                <TableCell className="font-mono text-xs">{v.sku}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {v.supplierSku ?? "—"}
                </TableCell>
                <TableCell>
                  <MoneyCell muted>
                    {v.leadTimeDays != null ? `${v.leadTimeDays}d` : "—"}
                  </MoneyCell>
                </TableCell>
                <TableCell>
                  <MoneyCell>{formatNumber(v.currentStock)}</MoneyCell>
                </TableCell>
                <TableCell>
                  <MoneyCell>{formatCurrencyExact(v.costPrice)}</MoneyCell>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <TabFootnote count={rows.length} noun="product" />
    </Card>
  );
}

function DetailsTab({ supplier }: { supplier: import("../types").SupplierDetail }) {
  return (
    <Card className="p-6">
      <dl className="grid gap-6 sm:grid-cols-2">
        <DetailField label="Business name" value={supplier.businessName} />
        <DetailField label="Contact person" value={supplier.contactPerson ?? "—"} />
        <DetailField label="Phone" value={supplier.phone} />
        <DetailField label="Email" value={supplier.email ?? "—"} />
        <DetailField
          label="Address"
          value={
            supplier.address ? (
              <span className="inline-flex items-start gap-1">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                {supplier.address}
              </span>
            ) : (
              "—"
            )
          }
          className="sm:col-span-2"
        />
        <DetailField
          label="Notes"
          value={supplier.notes ?? "—"}
          className="sm:col-span-2"
        />
        <DetailField label="Added" value={formatDate(supplier.createdAt)} />
        <DetailField label="Last updated" value={formatDate(supplier.updatedAt)} />
        <DetailField
          label="Last purchase"
          value={supplier.stats.lastPurchaseDate ? formatDate(supplier.stats.lastPurchaseDate) : "—"}
        />
        <DetailField
          label="Last payment"
          value={supplier.stats.lastPaymentDate ? formatDate(supplier.stats.lastPaymentDate) : "—"}
        />
      </dl>
    </Card>
  );
}

/**
 * The server caps each history list at 50 rows. Saying so is better than
 * silently truncating — a user comparing this against a report needs to know
 * they are seeing the most recent slice, not everything.
 */
function TabFootnote({ count, noun }: { count: number; noun: string }) {
  if (count < 50) return null;
  return (
    <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
      Showing the 50 most recent {noun}s. Use Reports for the complete history.
    </p>
  );
}
