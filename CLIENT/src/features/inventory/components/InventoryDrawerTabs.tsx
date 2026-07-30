/**
 * The seven tab bodies for the inventory details drawer.
 *
 * Overview · Stock · Movements · Purchases · Sales · History · Labels
 *
 * Each tab that needs data owns its own query, `enabled`-gated on being the
 * active tab. Opening a drawer fires ONE detail request plus at most one tab's
 * — not seven. A visited tab stays in the React Query cache, so returning to it
 * is instant.
 *
 * Overview and Stock take the already-loaded detail record as a prop rather
 * than re-fetching: the drawer header needed it anyway, and a second request
 * for data already in hand is pure waste.
 */

import { useState } from "react";
import {
  AlertTriangle, Barcode, Building2, Clock, ExternalLink, Package,
  Printer, ShoppingCart, Tag, Truck,
} from "lucide-react";

import {
  Badge, Button, Card, EmptyState, ErrorState, Pagination, Skeleton,
} from "@/components/ui";
import { cn } from "@/utils/cn";
import {
  DeltaCell,
  MovementBadge,
  ProductThumb,
  ReservationStatusBadge,
  StockStatusBadge,
  VelocityBadge,
} from "./InventoryAtoms";
import {
  MOVEMENT_COLORS,
  MOVEMENT_LABELS,
  RESERVATION_TYPE_LABELS,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelative,
  formatVariantName,
} from "../utils/format";
import {
  useMovements,
  useVariantPurchases,
  useVariantSales,
} from "../hooks/useInventory";
import type { InventoryDetail } from "../types";

export type InventoryTab =
  | "overview"
  | "stock"
  | "movements"
  | "purchases"
  | "sales"
  | "history"
  | "labels";

export const INVENTORY_TABS: Array<{ id: InventoryTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "stock", label: "Stock" },
  { id: "movements", label: "Movements" },
  { id: "purchases", label: "Purchases" },
  { id: "sales", label: "Sales" },
  { id: "history", label: "History" },
  { id: "labels", label: "Labels" },
];

const DRAWER_PAGE_SIZE = 15;

// =============================================================================
// SHARED BITS
// =============================================================================

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon?: React.ElementType;
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm">{value}</dd>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent?: string;
  hint?: string;
}) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-base font-bold tabular-nums", accent)}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function TabSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

// =============================================================================
// 1 — OVERVIEW
// =============================================================================

export function OverviewTab({ detail }: { detail: InventoryDetail | undefined }) {
  if (!detail) return <TabSkeleton rows={7} />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <ProductThumb src={detail.imageUrl} alt={detail.productName} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">{detail.productName}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {formatVariantName(detail.variantName)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StockStatusBadge status={detail.status} />
            <VelocityBadge velocity={detail.velocity} />
            {!detail.isActive && <Badge variant="secondary">Archived</Badge>}
          </div>
        </div>
      </div>

      <Section title="Identification">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field icon={Tag} label="SKU" value={<span className="font-mono">{detail.sku}</span>} />
          <Field
            icon={Barcode}
            label="Barcode"
            value={
              detail.barcode ? (
                <span className="font-mono">{detail.barcode}</span>
              ) : (
                <span className="text-muted-foreground">Not assigned</span>
              )
            }
          />
          <Field icon={Building2} label="Category" value={detail.categoryName ?? "—"} />
          <Field label="Brand" value={detail.brandName ?? "—"} />
          <Field
            icon={Truck}
            label="Supplier"
            value={detail.supplierName ?? "—"}
            className="col-span-2"
          />
        </dl>
      </Section>

      <Section title="Pricing">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Metric label="MRP" value={formatCurrency(detail.mrp)} />
          <Metric label="Selling price" value={formatCurrency(detail.sellingPrice)} />
          {/* Cost is absent from a non-owner's payload entirely — the key
              check is the permission check. */}
          {detail.costPrice !== undefined && (
            <Metric
              label="Cost price"
              value={formatCurrency(detail.costPrice)}
              hint={
                detail.marginPercentage !== undefined
                  ? `${detail.marginPercentage.toFixed(1)}% margin`
                  : undefined
              }
            />
          )}
        </div>
      </Section>

      <Section title="Activity">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Units sold (30d)" value={formatNumber(detail.unitsSold)} />
          <Field label="Revenue (30d)" value={formatCurrency(detail.revenue)} />
          <Field label="Last sale" value={formatRelative(detail.lastSaleAt)} />
          <Field label="Last movement" value={formatRelative(detail.lastMovementAt)} />
          <Field label="Added" value={formatDate(detail.createdAt)} />
          <Field label="Updated" value={formatDate(detail.updatedAt)} />
        </dl>
      </Section>
    </div>
  );
}

// =============================================================================
// 2 — STOCK
// =============================================================================

export function StockTab({ detail }: { detail: InventoryDetail | undefined }) {
  if (!detail) return <TabSkeleton rows={6} />;

  return (
    <div className="flex flex-col gap-6">
      <Section title="Position">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Metric
            label="On hand"
            value={formatNumber(detail.currentStock)}
            accent={detail.currentStock < 0 ? "text-destructive" : undefined}
            hint="physically present"
          />
          <Metric
            label="Reserved"
            value={formatNumber(detail.reserved)}
            accent={detail.reserved > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
            hint="held back from sale"
          />
          <Metric
            label="Available"
            value={formatNumber(detail.available)}
            accent={
              detail.available <= 0
                ? "text-destructive"
                : "text-emerald-600 dark:text-emerald-400"
            }
            hint="sellable now"
          />
          <Metric
            label="Damaged"
            value={formatNumber(detail.damagedQuantity)}
            accent={detail.damagedQuantity > 0 ? "text-destructive" : undefined}
            hint="already deducted"
          />
          <Metric
            label="Reorder level"
            value={detail.reorderLevel != null ? formatNumber(detail.reorderLevel) : "Not set"}
          />
          <Metric label="Retail value" value={formatCurrency(detail.retailValue)} />
        </div>

        {detail.stockValue !== undefined && (
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Stock value (cost)" value={formatCurrency(detail.stockValue)} />
            <Metric
              label="Potential profit"
              value={formatCurrency(detail.potentialProfit)}
              accent="text-emerald-600 dark:text-emerald-400"
            />
          </div>
        )}
      </Section>

      {detail.currentStock < 0 && (
        <Card className="flex items-start gap-3 border-destructive/40 bg-destructive/[0.04] p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="text-xs">
            <p className="font-medium text-destructive">Negative stock</p>
            <p className="mt-0.5 text-muted-foreground">
              This indicates a data problem rather than a stock level — something recorded a
              sale for goods the system did not have. Run a cycle count on this item.
            </p>
          </div>
        </Card>
      )}

      <Section title={`Reservations (${detail.reservations.length})`}>
        {detail.reservations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stock is currently held.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {detail.reservations.map((r) => (
              <Card key={r.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium tabular-nums">{r.quantity}</span>
                    <Badge variant="outline">{RESERVATION_TYPE_LABELS[r.type]}</Badge>
                    <ReservationStatusBadge status={r.status} />
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {r.customer?.name ?? r.heldFor ?? "Unattributed"}
                    {r.expiresAt ? ` · expires ${formatRelative(r.expiresAt)}` : ""}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {detail.damaged.length > 0 && (
        <Section title="Damaged records">
          <div className="flex flex-col gap-2">
            {detail.damaged.map((d) => (
              <Card key={d.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-sm">
                    <span className="font-medium tabular-nums">{d.quantity}</span> — {d.reason}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {d.reportedByName ?? "Unknown"} · {formatRelative(d.reportedAt)}
                  </div>
                </div>
                {d.lossValue !== undefined && (
                  <span className="shrink-0 text-xs tabular-nums text-destructive">
                    {formatCurrency(d.lossValue)}
                  </span>
                )}
              </Card>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// =============================================================================
// 3 — MOVEMENTS (the ledger for this variant)
// =============================================================================

export function MovementsTab({
  variantId,
  active,
  onOpenRecord,
}: {
  variantId: string | undefined;
  active: boolean;
  onOpenRecord?: (path: string) => void;
}) {
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useMovements(
    { variantId, page, limit: DRAWER_PAGE_SIZE },
    active && Boolean(variantId)
  );

  if (isError) return <ErrorState message="Failed to load movements." onRetry={() => refetch()} />;
  if (isLoading) return <TabSkeleton rows={8} />;

  const rows = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Package className="h-7 w-7 text-muted-foreground" />}
        title="No movements yet"
        description="Nothing has moved this item's stock. Every future change will appear here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="relative space-y-0.5">
        {/* One continuous rail rather than a segment per row. */}
        <span className="absolute bottom-2 left-[7px] top-2 w-px bg-border" aria-hidden="true" />

        {rows.map((m) => {
          // Only link where there is somewhere to go — a dead link is worse
          // than plain text.
          const path = m.relatedSaleId
            ? `/sales/${m.relatedSaleId}`
            : m.relatedPurchaseId
              ? `/admin/purchases?highlight=${m.relatedPurchaseId}`
              : null;

          return (
            <li key={m.id} className="relative flex gap-3 py-2 pl-6">
              <span
                className={cn(
                  "absolute left-0 top-3.5 h-[15px] w-[15px] rounded-full border-[3px] border-card",
                  MOVEMENT_COLORS[m.type]
                )}
                aria-hidden="true"
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <MovementBadge type={m.type} />
                  <DeltaCell value={m.quantityChanged} />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {m.stockBefore} → {m.stockAfter}
                  </span>
                </div>

                {m.reason && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{m.reason}</p>
                )}

                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{formatDateTime(m.createdAt)}</span>
                  {m.employeeName && <span>· {m.employeeName}</span>}
                  {m.referenceNumber && (
                    <span className="font-mono">· {m.referenceNumber}</span>
                  )}
                  {path && onOpenRecord && (
                    <button
                      type="button"
                      onClick={() => onOpenRecord(path)}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      View record
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {totalPages > 1 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}
    </div>
  );
}

// =============================================================================
// 4 — PURCHASES
// =============================================================================

export function PurchasesTab({
  variantId,
  active,
}: {
  variantId: string | undefined;
  active: boolean;
}) {
  const { data, isLoading, isError, refetch } = useVariantPurchases(variantId, active);

  if (isError) return <ErrorState message="Failed to load purchases." onRetry={() => refetch()} />;
  if (isLoading) return <TabSkeleton rows={5} />;

  const rows = data ?? [];

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Truck className="h-7 w-7 text-muted-foreground" />}
        title="Never purchased"
        description="This item has not been received on any purchase order."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((p: any) => (
        <Card key={p.id} className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {p.supplierName ?? "Unknown supplier"}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {/* Both references shown: ours identifies the PO, theirs
                  reconciles the delivery note. */}
              <span className="font-mono">{p.purchaseNumber}</span>
              {p.supplierInvoiceNumber && (
                <> · inv <span className="font-mono">{p.supplierInvoiceNumber}</span></>
              )}
              {" · "}
              {formatDate(p.purchaseDate)}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-sm font-medium tabular-nums">{formatNumber(p.quantity)}</div>
            {p.costPrice !== undefined && (
              <div className="text-[11px] text-muted-foreground tabular-nums">
                @ {formatCurrency(p.costPrice)}
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

// =============================================================================
// 5 — SALES
// =============================================================================

export function SalesTab({
  variantId,
  active,
  onOpenSale,
}: {
  variantId: string | undefined;
  active: boolean;
  onOpenSale?: (saleId: string) => void;
}) {
  const { data, isLoading, isError, refetch } = useVariantSales(variantId, active);

  if (isError) return <ErrorState message="Failed to load sales." onRetry={() => refetch()} />;
  if (isLoading) return <TabSkeleton rows={5} />;

  const rows = data ?? [];

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ShoppingCart className="h-7 w-7 text-muted-foreground" />}
        title="Never sold"
        description="This item has not appeared on a completed sale."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((s: any) => (
        <Card key={s.id} className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onOpenSale?.(s.saleId)}
              className={cn(
                "truncate text-sm font-medium",
                onOpenSale && "hover:underline"
              )}
            >
              <span className="font-mono">{s.saleNumber}</span>
            </button>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {formatDate(s.saleDate)}
              {s.customerName ? ` · ${s.customerName}` : ""}
              {s.employeeName ? ` · sold by ${s.employeeName}` : ""}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-sm font-medium tabular-nums">{formatNumber(s.quantity)}</div>
            <div className="text-[11px] text-muted-foreground tabular-nums">
              @ {formatCurrency(s.sellingPrice)}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// =============================================================================
// 6 — HISTORY (manual corrections only)
//
// Distinct from Movements on purpose. Movements is EVERY stock change; History
// is the subset a human deliberately made — adjustments, damage, counts — which
// is what an audit actually asks about.
// =============================================================================

export function HistoryTab({
  variantId,
  active,
}: {
  variantId: string | undefined;
  active: boolean;
}) {
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useMovements(
    { variantId, page, limit: DRAWER_PAGE_SIZE },
    active && Boolean(variantId)
  );

  if (isError) return <ErrorState message="Failed to load history." onRetry={() => refetch()} />;
  if (isLoading) return <TabSkeleton rows={6} />;

  const MANUAL_TYPES = new Set(["MANUAL_ADJUSTMENT", "DAMAGED", "LOST", "OPENING_STOCK"]);
  const rows = (data?.data ?? []).filter((m) => MANUAL_TYPES.has(m.type));
  const totalPages = data?.totalPages ?? 1;

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Clock className="h-7 w-7 text-muted-foreground" />}
        title="No manual corrections"
        description="Nobody has adjusted, written off or counted this item. Sales and purchases appear under Movements."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="py-2 text-left font-medium">When</th>
              <th className="py-2 text-right font-medium">Old</th>
              <th className="py-2 text-right font-medium">New</th>
              <th className="py-2 text-right font-medium">Change</th>
              <th className="py-2 text-left font-medium">Reason</th>
              <th className="py-2 text-left font-medium">By</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-b border-border/60 last:border-0">
                <td className="whitespace-nowrap py-2 pr-2 text-xs">
                  {formatDateTime(m.createdAt)}
                </td>
                <td className="py-2 text-right tabular-nums">{m.stockBefore}</td>
                <td className="py-2 text-right tabular-nums">{m.stockAfter}</td>
                <td className="py-2 text-right">
                  <DeltaCell value={m.quantityChanged} />
                </td>
                <td className="max-w-[16rem] truncate py-2 pl-2 text-xs">
                  <span className="mr-1.5">{MOVEMENT_LABELS[m.type]}</span>
                  {m.reason && (
                    <span className="text-muted-foreground">— {m.reason}</span>
                  )}
                </td>
                <td className="py-2 pl-2 text-xs text-muted-foreground">
                  {m.employeeName ?? "System"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}
    </div>
  );
}

// =============================================================================
// 7 — LABELS
// =============================================================================

/**
 * Label printing for this variant.
 *
 * Deliberately a LAUNCHER rather than a printing implementation: the Label
 * Engine already owns templates, printers and the job queue. Re-implementing
 * any of that here would create a second way to print that could disagree with
 * the first.
 */
export function LabelsTab({
  detail,
  onPrint,
}: {
  detail: InventoryDetail | undefined;
  onPrint?: (variantId: string, quantity: number) => void;
}) {
  const [quantity, setQuantity] = useState(1);

  if (!detail) return <TabSkeleton rows={4} />;

  const hasBarcode = Boolean(detail.barcode);

  return (
    <div className="flex flex-col gap-5">
      <Section title="Barcode">
        <Card className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            {hasBarcode ? (
              <>
                <div className="font-mono text-lg tracking-wider">{detail.barcode}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  Scannable code for this variant
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium">No barcode assigned</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  This item cannot be scanned at the till or during a cycle count until a
                  barcode is generated.
                </div>
              </>
            )}
          </div>
          <Barcode className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Card>
      </Section>

      <Section title="Print labels">
        <Card className="flex flex-col gap-3 p-4">
          <label className="flex items-center gap-3">
            <span className="text-sm">Quantity</span>
            <input
              type="number"
              min={1}
              max={500}
              value={quantity}
              onChange={(e) =>
                setQuantity(Math.max(1, Math.min(500, Number(e.target.value) || 1)))
              }
              className="h-9 w-24 rounded-md border border-border bg-background px-3 text-sm tabular-nums"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!hasBarcode}
              onClick={() => onPrint?.(detail.id, quantity)}
              leftIcon={<Printer className="h-3.5 w-3.5" />}
            >
              Print {quantity} label{quantity === 1 ? "" : "s"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasBarcode}
              onClick={() => onPrint?.(detail.id, 1)}
            >
              Print one
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Printing opens the Label Engine, which owns templates, printer selection and the
            job queue. Labels print with the current selling price of{" "}
            {formatCurrency(detail.sellingPrice)}.
          </p>
        </Card>
      </Section>
    </div>
  );
}
