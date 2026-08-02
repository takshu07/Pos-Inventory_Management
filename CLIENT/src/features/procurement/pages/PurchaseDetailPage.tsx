/**
 * Purchase detail — the bill, its goods, and its money.
 *
 * WHICH ACTIONS ARE AVAILABLE IS DERIVED FROM SERVER STATE, never guessed:
 *  • Receive — while anything is outstanding and the bill is not cancelled.
 *  • Record payment — while `dueAmount > 0` and the bill is not cancelled.
 *  • Cancel — only before any stock is received AND before any money is paid.
 *    Both are server-enforced (a received purchase must be reversed with a
 *    supplier return, not cancelled), so the button is hidden rather than
 *    offered-and-rejected.
 *
 * Line-level receipt progress is rendered from `receivedQuantity`, which is the
 * authoritative per-line counter — never inferred from the overall status.
 */

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  Ban,
  IndianRupee,
  PackageCheck,
  Receipt,
  Truck,
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
import { ErrorState } from "@/components/ui/StateViews";
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

import { ConfirmDialog } from "../components/ConfirmDialog";
import { ReceiveStockDialog } from "../components/ReceiveStockDialog";
import { RecordPaymentDialog } from "../components/RecordPaymentDialog";
import {
  DetailField,
  MoneyCell,
  NoticeStrip,
  PurchaseStatusBadge,
  ReceiptProgressBar,
  SettlementBadge,
} from "../components/ProcurementAtoms";
import {
  useCancelPurchase,
  usePurchase,
  useReceivePurchase,
  useRecordPayment,
} from "../hooks/useProcurement";

export default function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role ?? null);
  const isOwner = canAccessAdmin(role);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const { data: purchase, isLoading, isError, error, refetch } = usePurchase(id ?? null);
  const receiveMutation = useReceivePurchase();
  const paymentMutation = useRecordPayment();
  const cancelMutation = useCancelPurchase();

  if (!isOwner) {
    return <ErrorState title="Not available" message="Purchases are restricted to owners." />;
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-56 animate-pulse rounded bg-muted" />
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

  if (isError || !purchase) {
    return (
      <ErrorState
        title="Could not load this purchase"
        message={error instanceof Error ? error.message : "It may have been removed."}
        onRetry={() => refetch()}
      />
    );
  }

  const isCancelled = purchase.status === "CANCELLED";
  const canReceive = !isCancelled && purchase.receipt.outstandingUnits > 0;
  const canPay = !isCancelled && purchase.dueAmount > 0;
  // Mirrors the server's guard exactly — see the file header.
  const canCancel =
    !isCancelled && purchase.receipt.receivedUnits === 0 && purchase.paidAmount === 0;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/purchases")}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All purchases
        </Button>

        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-semibold tracking-tight text-foreground">
                {purchase.purchaseNumber}
              </h1>
              <PurchaseStatusBadge status={purchase.status} />
              <SettlementBadge status={purchase.paymentStatus} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              <Link
                to={`/admin/suppliers/${purchase.supplier.id}`}
                className="font-medium text-foreground hover:underline"
              >
                {purchase.supplier.businessName}
              </Link>
              {" · "}
              {formatDate(purchase.purchaseDate)}
              {purchase.supplierInvoiceNumber
                ? ` · Invoice ${purchase.supplierInvoiceNumber}`
                : ""}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            {canReceive && (
              <Button onClick={() => setReceiveOpen(true)}>
                <PackageCheck className="h-4 w-4" aria-hidden="true" />
                Receive stock
              </Button>
            )}
            {canPay && (
              <Button variant="outline" onClick={() => setPayOpen(true)}>
                <Wallet className="h-4 w-4" aria-hidden="true" />
                Record payment
              </Button>
            )}
            {canCancel && (
              <Button
                variant="ghost"
                onClick={() => setCancelOpen(true)}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Ban className="h-4 w-4" aria-hidden="true" />
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── State notices ──────────────────────────────────────────────────── */}
      {isCancelled && (
        <NoticeStrip tone="danger">
          This purchase was cancelled. It no longer counts towards payables or
          expected stock.
        </NoticeStrip>
      )}
      {purchase.paymentStatus === "OVERDUE" && (
        <NoticeStrip tone="danger">
          Payment is overdue{purchase.dueDate ? ` (due ${formatDate(purchase.dueDate)})` : ""} —{" "}
          {formatCurrencyExact(purchase.dueAmount)} outstanding.
        </NoticeStrip>
      )}
      {purchase.status === "PARTIAL" && (
        <NoticeStrip>
          {formatNumber(purchase.receipt.outstandingUnits)} unit(s) are still
          outstanding on this order.
        </NoticeStrip>
      )}
      {!purchase.supplier.isActive && (
        <NoticeStrip tone="info">
          This supplier is currently inactive. Existing bills are unaffected.
        </NoticeStrip>
      )}

      {/* ── Money & goods summary ──────────────────────────────────────────── */}
      <KpiGrid>
        <KpiCard
          label="Total"
          value={purchase.totalAmount}
          format={formatCurrency}
          icon={IndianRupee}
        />
        <KpiCard
          label="Paid"
          value={purchase.paidAmount}
          format={formatCurrency}
          icon={Receipt}
          accent={purchase.paidAmount > 0 ? "success" : "default"}
        />
        <KpiCard
          label="Due"
          value={purchase.dueAmount}
          format={formatCurrency}
          icon={Wallet}
          accent={purchase.dueAmount > 0 ? "warning" : "success"}
          {...(purchase.dueDate ? { hint: `Due ${formatDate(purchase.dueDate)}` } : {})}
        />
        <KpiCard
          label="Received"
          value={purchase.receipt.percentReceived}
          format={(n) => `${n}%`}
          icon={Truck}
          hint={`${formatNumber(purchase.receipt.receivedUnits)} of ${formatNumber(purchase.receipt.orderedUnits)} unit(s)`}
          accent={purchase.receipt.isFullyReceived ? "success" : "info"}
        />
      </KpiGrid>

      {/* ── Lines ──────────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold text-foreground">Items</h2>
          <span className="text-sm text-muted-foreground">
            {formatNumber(purchase.items.length)} line(s)
          </span>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="min-w-[10rem]">Received</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                <TableHead className="text-right">Planned selling</TableHead>
                <TableHead className="text-right">In stock now</TableHead>
                <TableHead className="text-right">Line total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchase.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <p className="font-medium text-foreground">{item.variant.product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{item.variant.sku}</span>
                      {[item.variant.size?.name, item.variant.color?.name]
                        .filter(Boolean)
                        .map((x) => ` · ${x}`)
                        .join("")}
                    </p>
                  </TableCell>
                  <TableCell>
                    <MoneyCell>{formatNumber(item.quantity)}</MoneyCell>
                  </TableCell>
                  <TableCell>
                    <ReceiptProgressBar
                      received={item.receivedQuantity}
                      ordered={item.quantity}
                    />
                  </TableCell>
                  <TableCell>
                    <MoneyCell>{formatCurrencyExact(item.costPrice)}</MoneyCell>
                  </TableCell>
                  <TableCell>
                    <MoneyCell muted>
                      {formatCurrencyExact(item.sellingPriceAtPurchase)}
                    </MoneyCell>
                  </TableCell>
                  <TableCell>
                    <MoneyCell muted>{formatNumber(item.variant.currentStock)}</MoneyCell>
                  </TableCell>
                  <TableCell>
                    <MoneyCell strong>{formatCurrencyExact(item.totalPrice)}</MoneyCell>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Totals mirror the server's stored values, not a client recomputation. */}
        <dl className="space-y-1 border-t border-border px-4 py-3 text-sm">
          <TotalRow label="Subtotal" value={formatCurrencyExact(purchase.subtotal)} />
          {purchase.discountAmount > 0 && (
            <TotalRow
              label="Discount"
              value={`− ${formatCurrencyExact(purchase.discountAmount)}`}
              muted
            />
          )}
          {purchase.taxAmount > 0 && (
            <TotalRow
              label="Tax"
              value={`+ ${formatCurrencyExact(purchase.taxAmount)}`}
              muted
            />
          )}
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatCurrencyExact(purchase.totalAmount)}</dd>
          </div>
        </dl>
      </Card>

      {/* ── Payments ───────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold text-foreground">Payments</h2>
          {canPay && (
            <Button size="sm" variant="outline" onClick={() => setPayOpen(true)}>
              Record payment
            </Button>
          )}
        </div>

        {purchase.payments.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No payments recorded against this bill yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Recorded by</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchase.payments.map((p) => (
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
        )}
      </Card>

      {/* ── Meta ───────────────────────────────────────────────────────────── */}
      <Card className="p-6">
        <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <DetailField
            label="Raised by"
            value={
              purchase.employee
                ? `${purchase.employee.firstName} ${purchase.employee.lastName}`
                : "—"
            }
          />
          <DetailField label="Purchase date" value={formatDate(purchase.purchaseDate)} />
          <DetailField
            label="Fully received"
            value={purchase.receivedAt ? formatDateTime(purchase.receivedAt) : "Not yet"}
          />
          <DetailField
            label="Payment due"
            value={purchase.dueDate ? formatDate(purchase.dueDate) : "No agreed term"}
          />
          {purchase.notes && (
            <DetailField
              label="Notes"
              value={<span className="whitespace-pre-wrap">{purchase.notes}</span>}
              className="sm:col-span-2 lg:col-span-4"
            />
          )}
        </dl>
      </Card>

      {/* ── Dialogs ────────────────────────────────────────────────────────── */}
      <ReceiveStockDialog
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        purchase={purchase}
        onSubmit={async (input) => {
          await receiveMutation.mutateAsync({ id: purchase.id, input });
        }}
      />

      <RecordPaymentDialog
        open={payOpen}
        onClose={() => setPayOpen(false)}
        supplierId={purchase.supplier.id}
        supplierName={purchase.supplier.businessName}
        purchaseId={purchase.id}
        purchaseNumber={purchase.purchaseNumber}
        maxAmount={purchase.dueAmount}
        onSubmit={async (input) => {
          await paymentMutation.mutateAsync(input);
        }}
      />

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ${purchase.purchaseNumber}?`}
        description={
          <div className="space-y-3">
            <p>
              The order will be marked cancelled and removed from payables. This
              cannot be undone.
            </p>
            <div className="space-y-1.5">
              <label htmlFor="cancel-reason" className="text-sm font-medium text-foreground">
                Reason <span className="text-destructive">*</span>
              </label>
              <input
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Why is this order being cancelled?"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
        }
        confirmLabel="Cancel order"
        onConfirm={async () => {
          if (cancelReason.trim().length < 3) {
            throw new Error("Give a reason of at least 3 characters.");
          }
          await cancelMutation.mutateAsync({
            id: purchase.id,
            reason: cancelReason.trim(),
          });
          setCancelReason("");
        }}
      />
    </div>
  );
}

function TotalRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className={`flex justify-between ${muted ? "text-muted-foreground" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
