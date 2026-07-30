/**
 * Inventory details drawer — the module's deep view.
 *
 * Three things are load-bearing:
 *
 *   1. LAZY TABS. Only the active tab is mounted, and each tab's query is
 *      `enabled`-gated on being active. Opening a drawer costs one detail
 *      request plus (once a tab is picked) that tab's — never seven.
 *
 *   2. NOT MOUNTED WHEN CLOSED. The base Drawer primitive renders its markup
 *      regardless of `open` (it animates via translate), so gating on
 *      `variantId` here is what stops a closed drawer from holding a polling
 *      query alive in the background.
 *
 *   3. HEADER READS THE ROW, BODY READS THE DETAIL. The clicked row already
 *      carries name, SKU and stock, so the header renders instantly while the
 *      fuller record loads — no skeleton over information we already have.
 */

import { useEffect, useState } from "react";
import { Layers, Package, ShoppingCart, TrendingUp } from "lucide-react";

import { Button, Drawer } from "@/components/ui";
import { cn } from "@/utils/cn";
import {
  ProductThumb,
  StockStatusBadge,
  VelocityBadge,
} from "./InventoryAtoms";
import {
  HistoryTab,
  INVENTORY_TABS,
  LabelsTab,
  MovementsTab,
  OverviewTab,
  PurchasesTab,
  SalesTab,
  StockTab,
  type InventoryTab,
} from "./InventoryDrawerTabs";
import { useInventoryDetail } from "../hooks/useInventory";
import { formatCurrency, formatNumber, formatVariantName } from "../utils/format";
import type { StockRow } from "../types";

interface Props {
  /** The row that was clicked. Its fields render the header immediately. */
  row: StockRow | null;
  open: boolean;
  onClose: () => void;
  /** Owner-only actions. Omitted for managers and cashiers. */
  onAdjust?: (row: StockRow) => void;
  onReserve?: (row: StockRow) => void;
  onPrintLabel?: (variantId: string, quantity: number) => void;
  onNavigate?: (path: string) => void;
}

export function InventoryDrawer({
  row,
  open,
  onClose,
  onAdjust,
  onReserve,
  onPrintLabel,
  onNavigate,
}: Props) {
  const [tab, setTab] = useState<InventoryTab>("overview");

  // Reset to Overview whenever a DIFFERENT item is opened. Keeping the previous
  // item's tab would show, say, the Purchases tab of something the user never
  // asked about.
  useEffect(() => {
    setTab("overview");
  }, [row?.id]);

  const { data: detail, isLoading } = useInventoryDetail(open ? row?.id : undefined);

  if (!row) return null;

  const footer =
    onAdjust || onReserve ? (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onReserve && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onReserve(row)}
            leftIcon={<Layers className="h-3.5 w-3.5" />}
          >
            Reserve Stock
          </Button>
        )}
        {onAdjust && (
          <Button
            size="sm"
            onClick={() => onAdjust(row)}
            leftIcon={<TrendingUp className="h-3.5 w-3.5" />}
          >
            Adjust Stock
          </Button>
        )}
      </div>
    ) : undefined;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="w-full max-w-3xl"
      {...(footer ? { footer } : {})}
    >
      {/* ── Identity header ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 border-b border-border pb-4">
        <div className="flex items-start gap-4">
          <ProductThumb src={row.imageUrl} alt={row.productName} size="lg" />

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold leading-tight">
              {row.productName}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{row.sku}</span>
              {formatVariantName(row.variantName) !== "—" && (
                <> · {formatVariantName(row.variantName)}</>
              )}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StockStatusBadge status={row.status} />
              <VelocityBadge velocity={row.velocity} />
            </div>
          </div>
        </div>

        {/* At-a-glance strip: the four numbers that decide whether the reader
            needs to open a tab at all. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <HeaderStat
            icon={Package}
            label="On hand"
            value={formatNumber(row.currentStock)}
          />
          <HeaderStat
            icon={Layers}
            label="Reserved"
            value={formatNumber(row.reserved)}
          />
          <HeaderStat
            icon={ShoppingCart}
            label="Available"
            value={formatNumber(row.available)}
          />
          <HeaderStat
            icon={TrendingUp}
            label={row.stockValue !== undefined ? "Stock value" : "Retail value"}
            value={formatCurrency(row.stockValue ?? row.retailValue)}
          />
        </div>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Inventory details"
        className="sticky top-0 z-10 -mx-6 mb-4 flex gap-1 overflow-x-auto border-b border-border bg-card px-6"
      >
        {INVENTORY_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2.5 text-sm transition-colors",
              tab === t.id
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Active tab only ───────────────────────────────────────────────── */}
      <div role="tabpanel">
        {tab === "overview" && <OverviewTab detail={detail ?? undefined} />}
        {tab === "stock" && <StockTab detail={detail ?? undefined} />}
        {tab === "movements" && (
          <MovementsTab
            variantId={row.id}
            active
            {...(onNavigate ? { onOpenRecord: onNavigate } : {})}
          />
        )}
        {tab === "purchases" && <PurchasesTab variantId={row.id} active />}
        {tab === "sales" && (
          <SalesTab
            variantId={row.id}
            active
            {...(onNavigate ? { onOpenSale: (id: string) => onNavigate(`/sales/${id}`) } : {})}
          />
        )}
        {tab === "history" && <HistoryTab variantId={row.id} active />}
        {tab === "labels" && (
          <LabelsTab
            detail={detail ?? undefined}
            {...(onPrintLabel ? { onPrint: onPrintLabel } : {})}
          />
        )}
      </div>

      {isLoading && tab === "overview" && (
        <p className="sr-only" role="status">
          Loading inventory details
        </p>
      )}
    </Drawer>
  );
}

function HeaderStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 truncate text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
