/**
 * Inventory Dashboard — the module's landing screen.
 *
 * Three bands, in the order someone actually asks the questions:
 *   1. What do we own, and what is it worth?
 *   2. What needs attention right now?
 *   3. How is it trending?
 *
 * Cost-bearing tiles are conditional on the PAYLOAD rather than on a role
 * check — the server omits `inventoryValue` entirely for non-owners, so the
 * dashboard renders what it was given and cannot show a figure it did not
 * receive.
 */

import { useNavigate } from "react-router";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, ClipboardCheck,
  IndianRupee, Layers, PackageX, ShieldAlert, Truck, Wrench,
} from "lucide-react";

import { Card, ErrorState, Select } from "@/components/ui";
import { KpiCard, KpiCardSkeleton } from "../components/InventoryAtoms";
import { ChartCard, MovementTrendChart, CategoryValueChart } from "../components/InventoryCharts";
import { useInventoryDashboard } from "../hooks/useInventory";
import { accuracyAccent, formatCurrency, formatNumber, formatPercent, formatRelative } from "../utils/format";
import type { InventoryPeriod } from "../types";
import { useState } from "react";

const PERIOD_OPTIONS: Array<{ value: InventoryPeriod; label: string }> = [
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
  { value: "quarter", label: "Last 90 days" },
  { value: "year", label: "Last year" },
];

export default function InventoryDashboardPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<InventoryPeriod>("month");

  const { data, isLoading, isError, refetch } = useInventoryDashboard({ period });

  if (isError) {
    return (
      <div className="p-6">
        <ErrorState message="Failed to load the inventory dashboard." onRetry={() => refetch()} />
      </div>
    );
  }

  const showValue = data?.inventoryValue !== undefined;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What you own, what it is worth, and what needs attention.
          </p>
        </div>

        <Select
          className="w-auto min-w-[10rem]"
          options={PERIOD_OPTIONS}
          value={period}
          onChange={(e) => setPeriod(e.target.value as InventoryPeriod)}
          aria-label="Period"
        />
      </div>

      {/* ── Band 1: what we own ──────────────────────────────────────────── */}
      {isLoading || !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard
            icon={Boxes}
            label="Total SKUs"
            value={formatNumber(data.totalSkus)}
            onClick={() => navigate("/admin/inventory/stock")}
          />
          <KpiCard
            icon={Layers}
            label="Units in stock"
            value={formatNumber(data.totalUnits)}
          />
          {showValue && (
            <>
              <KpiCard
                icon={IndianRupee}
                label="Inventory value"
                value={formatCurrency(data.inventoryValue)}
                hint="at cost"
                onClick={() => navigate("/admin/inventory/valuation")}
              />
              <KpiCard
                icon={IndianRupee}
                label="Retail value"
                value={formatCurrency(data.retailValue)}
                hint="if it all sold"
              />
            </>
          )}
          <KpiCard
            icon={Layers}
            label="Reserved"
            value={formatNumber(data.reservedUnits)}
            hint="held back from sale"
            accent={data.reservedUnits > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
          />
          <KpiCard
            icon={ClipboardCheck}
            label="Accuracy"
            // NULL means nothing has ever been counted. "100%" would claim a
            // verified inventory that nobody has actually checked.
            value={data.inventoryAccuracy != null ? formatPercent(data.inventoryAccuracy) : "Never counted"}
            accent={accuracyAccent(data.inventoryAccuracy)}
            hint={data.lastCountedAt ? formatRelative(data.lastCountedAt) : "run a cycle count"}
            onClick={() => navigate("/admin/inventory/cycle-counts")}
          />
        </div>
      )}

      {/* ── Band 2: what needs attention ─────────────────────────────────── */}
      {isLoading || !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard
            icon={AlertTriangle}
            label="Low stock"
            value={formatNumber(data.lowStock)}
            accent={data.lowStock > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
            onClick={() => navigate("/admin/inventory/low-stock")}
          />
          <KpiCard
            icon={PackageX}
            label="Out of stock"
            value={formatNumber(data.outOfStock)}
            accent={data.outOfStock > 0 ? "text-destructive" : undefined}
            onClick={() => navigate("/admin/inventory/out-of-stock")}
          />
          <KpiCard
            icon={ShieldAlert}
            label="Negative stock"
            value={formatNumber(data.negativeStock)}
            // Negative stock is a data fault, not a stock level — always red
            // when present, because it means something is broken.
            accent={data.negativeStock > 0 ? "text-destructive" : undefined}
            hint={data.negativeStock > 0 ? "investigate" : "none"}
          />
          <KpiCard
            icon={Wrench}
            label="Damaged units"
            value={formatNumber(data.damagedUnits)}
            accent={data.damagedUnits > 0 ? "text-destructive" : undefined}
            onClick={() => navigate("/admin/inventory/damaged")}
          />
          <KpiCard
            icon={ClipboardCheck}
            label="Pending adjustments"
            value={formatNumber(data.pendingAdjustments)}
            accent={data.pendingAdjustments > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
            hint={data.pendingAdjustments > 0 ? "awaiting approval" : "none"}
            onClick={() => navigate("/admin/inventory/adjustments")}
          />
          <KpiCard
            icon={Truck}
            label="Pending receipts"
            value={formatNumber(data.pendingPurchaseReceipts)}
            hint="orders not yet received"
          />
        </div>
      )}

      {/* ── Today's flow ─────────────────────────────────────────────────── */}
      {data && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="flex items-center justify-between gap-4 p-4">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Stock in today
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                +{formatNumber(data.stockInToday)}
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center justify-end gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                <ArrowDownRight className="h-3.5 w-3.5 text-destructive" />
                Stock out today
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums text-destructive">
                −{formatNumber(data.stockOutToday)}
              </div>
            </div>
          </Card>

          <Card className="flex items-center justify-between gap-4 p-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Net movement today
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums">
                {data.stockInToday - data.stockOutToday >= 0 ? "+" : ""}
                {formatNumber(data.stockInToday - data.stockOutToday)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate("/admin/inventory/movements")}
              className="text-xs text-primary hover:underline"
            >
              View ledger →
            </button>
          </Card>
        </div>
      )}

      {/* ── Band 3: trends ───────────────────────────────────────────────── */}
      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Stock movement"
            description="Units in and out per day."
          >
            <MovementTrendChart data={data.charts.movementTrend} />
          </ChartCard>

          <ChartCard
            title="Value by category"
            description={showValue ? "Where your capital sits." : "Units held per category."}
          >
            <CategoryValueChart data={data.charts.topCategories} showValue={showValue} />
          </ChartCard>
        </div>
      )}
    </div>
  );
}
