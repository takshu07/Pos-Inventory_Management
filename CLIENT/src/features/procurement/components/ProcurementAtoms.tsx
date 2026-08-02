/**
 * Procurement — shared presentational atoms.
 *
 * The status vocabulary lives here ONCE so a purchase reads identically on the
 * list, the detail header, and inside a supplier's history tab. When the same
 * PARTIAL bill renders as three differently-worded chips, users stop trusting
 * any of them.
 *
 * Money and date formatting is imported from the BI kit rather than
 * reimplemented — see components/shared/bi/format.
 */

import { AlertTriangle, Ban, CheckCircle2, Clock, FileText, Truck } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/utils/cn";
import type { PurchaseStatus, SettlementStatus } from "../types";

// =============================================================================
// STATUS VOCABULARY
// =============================================================================

const PURCHASE_STATUS_META: Record<
  PurchaseStatus,
  { label: string; variant: "default" | "secondary" | "success" | "warning" | "info" | "error"; icon: typeof FileText }
> = {
  DRAFT: { label: "Draft", variant: "secondary", icon: FileText },
  ORDERED: { label: "Ordered", variant: "info", icon: Clock },
  PARTIAL: { label: "Partially received", variant: "warning", icon: Truck },
  RECEIVED: { label: "Received", variant: "success", icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", variant: "error", icon: Ban },
};

const SETTLEMENT_META: Record<
  SettlementStatus,
  { label: string; variant: "default" | "secondary" | "success" | "warning" | "info" | "error" }
> = {
  UNPAID: { label: "Unpaid", variant: "secondary" },
  PARTIALLY_PAID: { label: "Part paid", variant: "warning" },
  PAID: { label: "Paid", variant: "success" },
  OVERDUE: { label: "Overdue", variant: "error" },
  CANCELLED: { label: "Cancelled", variant: "secondary" },
};

export function PurchaseStatusBadge({
  status,
  showIcon = true,
}: {
  status: PurchaseStatus;
  showIcon?: boolean;
}) {
  const meta = PURCHASE_STATUS_META[status] ?? PURCHASE_STATUS_META.DRAFT;
  const Icon = meta.icon;

  return (
    <Badge variant={meta.variant}>
      {showIcon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {meta.label}
    </Badge>
  );
}

export function SettlementBadge({ status }: { status: SettlementStatus }) {
  const meta = SETTLEMENT_META[status] ?? SETTLEMENT_META.UNPAID;
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

export function ActiveBadge({ isActive }: { isActive: boolean }) {
  return (
    <Badge variant={isActive ? "success" : "secondary"}>
      {isActive ? "Active" : "Inactive"}
    </Badge>
  );
}

// =============================================================================
// RECEIPT PROGRESS
// =============================================================================

/**
 * Goods-receipt progress.
 *
 * Renders the raw counts alongside the bar deliberately: "18 / 40" is the
 * number a stockroom actually acts on, while a bare percentage hides whether
 * two units or two hundred are still outstanding.
 */
export function ReceiptProgressBar({
  received,
  ordered,
  className,
  compact = false,
}: {
  received: number;
  ordered: number;
  className?: string;
  compact?: boolean;
}) {
  const pct = ordered <= 0 ? 0 : Math.min(100, Math.round((received / ordered) * 100));
  const complete = ordered > 0 && received >= ordered;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${received} of ${ordered} units received`}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            complete ? "bg-emerald-500" : "bg-amber-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {!compact && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {received}/{ordered}
        </span>
      )}
    </div>
  );
}

// =============================================================================
// SMALL LAYOUT HELPERS
// =============================================================================

/** Label/value pair used throughout the detail panels and profile headers. */
export function DetailField({
  label,
  value,
  className,
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
      <dd className="mt-1 text-sm text-foreground">{value ?? "—"}</dd>
    </div>
  );
}

/**
 * Inline warning strip for states the user must notice but that are not errors —
 * an inactive supplier, a bill past its due date, an overdue balance.
 */
export function NoticeStrip({
  tone = "warning",
  children,
}: {
  tone?: "warning" | "danger" | "info";
  children: React.ReactNode;
}) {
  const toneClass = {
    warning:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300",
    danger:
      "border-destructive/30 bg-destructive/10 text-destructive",
    info: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300",
  }[tone];

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        toneClass
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

/** Right-aligned monospace money cell — keeps decimal points in a column. */
export function MoneyCell({
  children,
  muted = false,
  strong = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <span
      className={cn(
        "block text-right tabular-nums",
        muted && "text-muted-foreground",
        strong && "font-semibold"
      )}
    >
      {children}
    </span>
  );
}
