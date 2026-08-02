/**
 * The dashboard's cross-module alert strip.
 *
 * WHY THIS EXISTS
 * ---------------
 * The sidebar refactor deliberately puts most screens one level deeper, inside
 * collapsed groups. That trade is only fair if the things you check constantly
 * come to you instead. This strip is the other half of that bargain: low stock,
 * out of stock, pending supplier payments, drawer state, attendance, and the
 * day's revenue and profit — the seven questions that previously justified
 * keeping fifty links permanently on screen.
 *
 * Every tile is a link into the screen that answers it in full, so the strip is
 * a router, not a dead end.
 *
 * DATA
 * ----
 * No new endpoints. Everything here comes from queries the app already makes:
 * the finance dashboard (revenue/profit/drawer/payables), the inventory alerts
 * feed, and the workforce summary. Owners see all of it; managers see only what
 * their role can already fetch, because the finance query is owner-only and is
 * simply not issued for them.
 */

import { Link } from "react-router";
import {
  AlertTriangle,
  PackageX,
  Truck,
  Wallet,
  CalendarCheck,
  IndianRupee,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/utils/cn";
import { formatCurrency } from "@/utils/formatters";
import { useFinanceDashboard } from "@/features/finance/hooks/useFinance";
import { useWorkforceSummary } from "@/features/workforce";
import { useInventoryAlerts } from "../../hooks/useDashboard";

type Tone = "critical" | "warning" | "positive" | "neutral";

const TONE_STYLES: Record<Tone, { ring: string; icon: string; value: string }> = {
  critical: {
    ring: "ring-destructive/30 hover:ring-destructive/50",
    icon: "text-destructive",
    value: "text-destructive",
  },
  warning: {
    ring: "ring-amber-500/30 hover:ring-amber-500/50",
    icon: "text-amber-600 dark:text-amber-500",
    value: "text-amber-700 dark:text-amber-500",
  },
  positive: {
    ring: "ring-emerald-500/30 hover:ring-emerald-500/50",
    icon: "text-emerald-600 dark:text-emerald-500",
    value: "text-emerald-700 dark:text-emerald-500",
  },
  neutral: {
    ring: "ring-border hover:ring-muted-foreground/40",
    icon: "text-muted-foreground",
    value: "text-foreground",
  },
};

export interface AlertTileProps {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
  to: string;
  isLoading?: boolean;
}

export function AlertTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  to,
  isLoading,
}: AlertTileProps) {
  const styles = TONE_STYLES[tone];

  if (isLoading) {
    return (
      <div className="h-[86px] animate-pulse rounded-xl bg-card ring-1 ring-inset ring-border" />
    );
  }

  return (
    <Link
      to={to}
      className={cn(
        "group flex flex-col justify-between rounded-xl bg-card p-3",
        "ring-1 ring-inset transition-all duration-150",
        "hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        styles.ring
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", styles.icon)} aria-hidden />
        <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <p className={cn("mt-1.5 text-xl font-semibold tabular-nums", styles.value)}>{value}</p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </Link>
  );
}

// =============================================================================
// INVENTORY ALERTS — available to every role that reaches the dashboard
// =============================================================================

export function InventoryAlertTiles() {
  const { data: alerts, isLoading } = useInventoryAlerts();

  const list = alerts ?? [];
  const outOfStock = list.filter((a) => a.status === "OUT_OF_STOCK").length;
  const lowStock = list.filter((a) => a.status === "LOW_STOCK").length;

  return (
    <>
      <AlertTile
        label="Out of Stock"
        value={String(outOfStock)}
        hint={outOfStock === 0 ? "Nothing unavailable" : "Lines unavailable to sell"}
        icon={PackageX}
        tone={outOfStock > 0 ? "critical" : "neutral"}
        to="/admin/inventory/out-of-stock"
        isLoading={isLoading}
      />
      <AlertTile
        label="Low Stock"
        value={String(lowStock)}
        hint={lowStock === 0 ? "All above reorder level" : "At or below reorder level"}
        icon={AlertTriangle}
        tone={lowStock > 0 ? "warning" : "neutral"}
        to="/admin/inventory/low-stock"
        isLoading={isLoading}
      />
    </>
  );
}

// =============================================================================
// OWNER TILES — finance and workforce
// =============================================================================

/**
 * Owner-only tiles.
 *
 * This is a separate component, and the parent mounts it only for owners,
 * because the finance dashboard query is OWNER-only on the server. Hooks cannot
 * be called conditionally, so gating inside one component would mean every
 * manager's dashboard fired a request that 403s. Not rendering the component is
 * what keeps the request from being made at all.
 */
export function OwnerAlertTiles() {
  const { data, isLoading } = useFinanceDashboard({ period: "today" });
  const cards = data?.cards;

  const todayRevenue = cards?.todayRevenue;
  const todayProfit = cards?.todayProfit;
  const cashInDrawer = cards?.cashInDrawer;
  // Profit is the one figure here that can legitimately be negative, and a red
  // loss reads very differently from a green profit at a glance.
  const profit = todayProfit ?? 0;

  return (
    <>
      <AlertTile
        label="Today's Revenue"
        value={formatCurrency(todayRevenue ?? 0)}
        hint="Net of refunds"
        icon={IndianRupee}
        tone="neutral"
        to="/admin/finance/revenue"
        isLoading={isLoading}
      />
      <AlertTile
        label="Today's Profit"
        value={formatCurrency(profit)}
        hint={profit < 0 ? "Operating at a loss" : "After COGS and expenses"}
        icon={TrendingUp}
        tone={profit < 0 ? "critical" : "positive"}
        to="/admin/finance/profit-loss"
        isLoading={isLoading}
      />
      <AlertTile
        label="Cash Drawer"
        value={formatCurrency(cashInDrawer ?? 0)}
        hint="Expected across open sessions"
        icon={Wallet}
        tone="neutral"
        to="/register"
        isLoading={isLoading}
      />
      <AlertTile
        label="Supplier Payments"
        value={formatCurrency(payables)}
        hint={payables > 0 ? "Outstanding to suppliers" : "Nothing outstanding"}
        icon={Truck}
        tone={payables > 0 ? "warning" : "neutral"}
        to="/admin/finance/payables"
        isLoading={isLoading}
      />
    </>
  );
}

/**
 * Attendance. Reachable by MANAGER and OWNER alike — the workforce summary is
 * an operational read, so unlike the finance tiles this needs no role gate.
 */
export function AttendanceTile() {
  const { data, isLoading } = useWorkforceSummary();

  const workingToday = data?.workingToday;
  const absent = data?.absentToday ?? 0;
  const late = data?.lateToday ?? 0;

  // Absences are the actionable signal (someone must cover the floor); lateness
  // is worth surfacing but not worth colouring the tile red on its own.
  const tone: Tone = absent > 0 ? "warning" : "neutral";
  const hint =
    absent > 0
      ? `${absent} absent${late > 0 ? `, ${late} late` : ""}`
      : late > 0
        ? `${late} late today`
        : "Full attendance";

  return (
    <AlertTile
      label="On Shift"
      value={String(workingToday ?? 0)}
      hint={hint}
      icon={CalendarCheck}
      tone={tone}
      to="/admin/attendance"
      isLoading={isLoading}
    />
  );
}
