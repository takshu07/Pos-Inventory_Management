/**
 * Customer profile — the full relationship on one screen.
 *
 * Tabs are URL-synced via `?tab=` rather than useState, matching the supplier
 * profile and the reports module: it keeps bookmarking, sharing, refresh and the
 * Back button working, which plain component state silently breaks.
 *
 * Two numbers here are deliberately NOT recomputed in the browser:
 *   • Lifetime spend counts COMPLETED sales only, while the purchase tab lists
 *     every status. Summing the visible rows would therefore disagree with the
 *     KPI — the server's rollup is the authority.
 *   • Exchange net difference is the server's sum of the signed `priceDifference`
 *     column, not (issued − returned) re-derived here. Those diverge once an
 *     exchange is partially settled.
 */

import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  ArrowLeft,
  ArrowLeftRight,
  Calendar,
  Gift,
  IndianRupee,
  Mail,
  MapPin,
  Package,
  Phone,
  Receipt,
  ShoppingBag,
  Wallet,
} from "lucide-react";
import {
  Badge,
  Card,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import type { BadgeProps } from "@/components/ui";
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
  formatSignedCurrency,
} from "@/components/shared/bi";
import { useAuthStore } from "@/store/auth.store";
import { canAccessAdmin } from "@/features/auth/utils/permissions";

import { useCustomerProfile } from "../hooks/useCustomers";
import type {
  CustomerExchangeRow,
  CustomerProfile,
  CustomerPurchaseRow,
  CustomerTopProductRow,
} from "../types";

/** Tied to the Badge component's own variants, so a rename here fails to compile. */
type BadgeVariant = NonNullable<BadgeProps["variant"]>;

type Tab = "purchases" | "exchanges" | "products" | "details";

const TABS: { id: Tab; label: string }[] = [
  { id: "purchases", label: "Purchase history" },
  { id: "exchanges", label: "Exchanges" },
  { id: "products", label: "Most purchased" },
  { id: "details", label: "Details" },
];

/**
 * Sale status → badge tone. Only COMPLETED counts toward spend, so a PARTIAL or
 * VOIDED row must look visibly different from a completed one — otherwise the
 * tab appears to contradict the lifetime-spend KPI above it.
 */
const SALE_STATUS_VARIANT: Record<string, BadgeVariant> = {
  COMPLETED: "success",
  PARTIAL: "warning",
  DRAFT: "secondary",
  HELD: "secondary",
  VOIDED: "error",
  REFUNDED: "error",
};

const EXCHANGE_STATUS_VARIANT: Record<string, BadgeVariant> = {
  COMPLETED: "success",
  PENDING: "warning",
  APPROVED: "info",
  REJECTED: "error",
  CANCELLED: "secondary",
};

/** Title-cases an enum value: "PARTIALLY_PAID" → "Partially paid". */
function statusLabel(status: string): string {
  const words = status.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function CustomerProfilePage() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role ?? null);
  const isOwner = canAccessAdmin(role);

  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "purchases";
  const setTab = (next: Tab) =>
    setParams(
      (prev) => {
        prev.set("tab", next);
        return prev;
      },
      { replace: true }
    );

  // Gate the request itself, not just the render — an unauthorized fetch would
  // 403 in the console and cache a failure for a screen we never intended to show.
  const { data, isLoading, isError, error, refetch } = useCustomerProfile(
    isOwner ? customerId : undefined
  );

  if (!isOwner) {
    return (
      <ErrorState
        title="Not available"
        message="Customer profiles are restricted to owners."
      />
    );
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

  if (isError || !data) {
    return (
      <ErrorState
        title="Could not load this customer"
        message={
          error instanceof Error
            ? error.message
            : "The customer may have been removed."
        }
        onRetry={() => refetch()}
      />
    );
  }

  const s = data.statistics;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/customers")}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All customers
        </Button>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {data.name}
              </h1>
              <Badge variant={s.active ? "success" : "secondary"}>
                {s.active ? "Active" : "Inactive"}
              </Badge>
              {!data.isActive && <Badge variant="warning">Account disabled</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="font-mono text-xs">{data.customerCode}</span>
              <a
                href={`tel:${data.phone}`}
                className="inline-flex items-center gap-1 hover:underline"
              >
                <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                {data.phone}
              </a>
              {data.email && (
                <a
                  href={`mailto:${data.email}`}
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  {data.email}
                </a>
              )}
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                Customer since {formatDate(data.createdAt)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Money ──────────────────────────────────────────────────────────── */}
      <KpiGrid>
        <KpiCard
          label="Lifetime spend"
          value={s.lifetimeSpend}
          format={formatCurrency}
          icon={IndianRupee}
          hint={`${formatNumber(s.totalOrders)} completed order(s)`}
        />
        <KpiCard
          label="Average order"
          value={s.averageOrderValue}
          format={formatCurrency}
          icon={Receipt}
          hint={`${formatNumber(s.totalItemsPurchased)} item(s) bought`}
        />
        <KpiCard
          label="Store credit"
          value={data.storeCredit}
          format={formatCurrency}
          icon={Wallet}
          accent={data.storeCredit > 0 ? "info" : undefined}
          hint={data.storeCredit > 0 ? "Redeemable at checkout" : "None held"}
        />
        <KpiCard
          label="Reward points"
          value={data.rewardPoints}
          format={formatNumber}
          icon={Gift}
        />
      </KpiGrid>

      {/* Last-visit context: the badge above says active/inactive, this says why. */}
      <p className="text-xs text-muted-foreground">
        {s.lastVisit
          ? `Last purchase ${formatDate(s.lastVisit)}. `
          : "No purchases recorded yet. "}
        {s.firstVisit && `First purchase ${formatDate(s.firstVisit)}. `}
        Active means a completed purchase within {s.activeWindowDays} days.
      </p>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="border-b border-border">
        <nav
          className="-mb-px flex gap-1 overflow-x-auto"
          aria-label="Customer sections"
        >
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

      {tab === "purchases" && (
        <PurchasesTab rows={data.purchases} limit={data.historyLimit} />
      )}
      {tab === "exchanges" && (
        <ExchangesTab
          rows={data.exchanges}
          limit={data.historyLimit}
          stats={s}
        />
      )}
      {tab === "products" && <TopProductsTab rows={data.topProducts} />}
      {tab === "details" && <DetailsTab customer={data} />}
    </div>
  );
}

// =============================================================================
// TABS
// =============================================================================

function PurchasesTab({
  rows,
  limit,
}: {
  rows: CustomerPurchaseRow[];
  limit: number;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No purchases yet"
          description="Sales billed to this customer will appear here."
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
              <TableHead>Sale</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Billed by</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link
                    to={`/admin/sales/${p.id}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {p.saleNumber}
                  </Link>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(p.saleDate)}
                </TableCell>
                <TableCell>
                  <Badge variant={SALE_STATUS_VARIANT[p.status] ?? "secondary"}>
                    {statusLabel(p.status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {p.employee
                    ? `${p.employee.firstName} ${p.employee.lastName}`
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(p._count.items)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatCurrencyExact(p.grandTotal)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <span
                    className={
                      p.dueAmount > 0 ? "text-amber-600 dark:text-amber-400" : ""
                    }
                  >
                    {formatCurrency(p.dueAmount)}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <TabFootnote count={rows.length} limit={limit} noun="purchase" />
    </Card>
  );
}

function ExchangesTab({
  rows,
  limit,
  stats,
}: {
  rows: CustomerExchangeRow[];
  limit: number;
  stats: CustomerProfile["statistics"];
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No exchanges"
          description="This customer has never exchanged an item."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <KpiGrid>
        <KpiCard
          label="Exchanges"
          value={stats.totalExchanges}
          format={formatNumber}
          icon={ArrowLeftRight}
          hint={
            stats.lastExchangeDate
              ? `Last ${formatDate(stats.lastExchangeDate)}`
              : undefined
          }
        />
        <KpiCard
          label="Value returned"
          value={stats.totalReturnedValue}
          format={formatCurrency}
          icon={Package}
        />
        <KpiCard
          label="Value issued"
          value={stats.totalIssuedValue}
          format={formatCurrency}
          icon={ShoppingBag}
        />
        <KpiCard
          label="Net difference"
          value={stats.netPriceDifference}
          format={formatSignedCurrency}
          icon={IndianRupee}
          hint={
            stats.netPriceDifference >= 0
              ? "Paid extra by customer"
              : "Refunded to customer"
          }
        />
      </KpiGrid>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Exchange</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Against sale</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Returned</TableHead>
                <TableHead className="text-right">Issued</TableHead>
                <TableHead className="text-right">Difference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="font-medium">
                    {x.exchangeNumber}
                    <p className="text-xs text-muted-foreground">
                      {x._count.returnedItems} in / {x._count.issuedItems} out
                    </p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(x.exchangeDate)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {x.originalSale ? (
                      <Link
                        to={`/admin/sales/${x.originalSale.id}`}
                        className="hover:underline"
                      >
                        {x.originalSale.saleNumber}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={EXCHANGE_STATUS_VARIANT[x.status] ?? "secondary"}
                    >
                      {statusLabel(x.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {x.exchangeReason ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(x.returnedValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(x.issuedValue)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {/* Signed at the source: + means the customer paid extra. */}
                    <span
                      className={
                        x.priceDifference < 0
                          ? "text-amber-600 dark:text-amber-400"
                          : ""
                      }
                    >
                      {formatSignedCurrency(x.priceDifference)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <TabFootnote count={rows.length} limit={limit} noun="exchange" />
      </Card>
    </div>
  );
}

function TopProductsTab({ rows }: { rows: CustomerTopProductRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Nothing bought yet"
          description="Once this customer completes a purchase, their most-bought items appear here."
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
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">Last bought</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={`${p.sku}-${p.productName}`}>
                <TableCell>
                  <span className="font-medium text-foreground">
                    {p.productName}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {[p.sizeName, p.colorName].filter(Boolean).join(" · ") || "—"}
                  </p>
                </TableCell>
                <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatNumber(p.totalQuantity)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrencyExact(p.totalSpend)}
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {formatDate(p.lastPurchased)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        Ranked by quantity across completed sales. Names are as recorded at the
        time of sale.
      </p>
    </Card>
  );
}

function DetailsTab({ customer }: { customer: CustomerProfile }) {
  const address = customer.addresses?.find((a) => a.isDefault) ?? customer.addresses?.[0];

  return (
    <Card className="p-6">
      <dl className="grid gap-6 sm:grid-cols-2">
        <DetailField label="Name" value={customer.name} />
        <DetailField label="Customer code" value={customer.customerCode} />
        <DetailField label="Phone" value={customer.phone} />
        <DetailField label="Email" value={customer.email ?? "—"} />
        <DetailField label="Gender" value={customer.gender ? statusLabel(customer.gender) : "—"} />
        <DetailField
          label="Date of birth"
          value={customer.dateOfBirth ? formatDate(customer.dateOfBirth) : "—"}
        />
        <DetailField
          label="Anniversary"
          value={customer.anniversary ? formatDate(customer.anniversary) : "—"}
        />
        <DetailField
          label="Account status"
          value={customer.isActive ? "Enabled" : "Disabled"}
        />
        <DetailField
          label="Address"
          value={
            address ? (
              <span className="inline-flex items-start gap-1">
                <MapPin
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span>
                  {[
                    address.addressLine1,
                    address.addressLine2,
                    address.city,
                    address.state,
                    address.pincode,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </span>
            ) : (
              "—"
            )
          }
          className="sm:col-span-2"
        />
        <DetailField
          label="Notes"
          value={customer.notes ?? "—"}
          className="sm:col-span-2"
        />
        <DetailField label="Customer since" value={formatDate(customer.createdAt)} />
        <DetailField
          label="Last updated"
          value={formatDateTime(customer.updatedAt)}
        />
      </dl>
    </Card>
  );
}

// =============================================================================
// ATOMS
// =============================================================================

function DetailField({
  label,
  value,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{value}</dd>
    </div>
  );
}

/**
 * The server caps each history list. Saying so is better than silently
 * truncating — a user comparing this against a report needs to know they are
 * seeing the most recent slice, not everything.
 */
function TabFootnote({
  count,
  limit,
  noun,
}: {
  count: number;
  limit: number;
  noun: string;
}) {
  if (count < limit) return null;
  return (
    <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
      Showing the {limit} most recent {noun}s. Use Reports for the complete
      history.
    </p>
  );
}
