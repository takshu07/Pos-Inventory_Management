/**
 * Shared inventory atoms.
 *
 * Every badge reads its label and colour from the mappings in utils/format, so
 * a status can never be rendered with an ad-hoc colour that contradicts another
 * screen. "Low stock" must look identical on the dashboard, the table and the
 * drawer, or the module stops being believable.
 */

import { Package } from "lucide-react";

import { Badge, Card, Skeleton } from "@/components/ui";
import { cn } from "@/utils/cn";
import {
  ADJUSTMENT_STATUS_LABELS,
  ADJUSTMENT_STATUS_VARIANTS,
  CYCLE_COUNT_STATUS_LABELS,
  CYCLE_COUNT_STATUS_VARIANTS,
  MOVEMENT_LABELS,
  MOVEMENT_VARIANTS,
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUS_VARIANTS,
  STOCK_STATUS_LABELS,
  STOCK_STATUS_VARIANTS,
  VELOCITY_LABELS,
  VELOCITY_VARIANTS,
  formatDelta,
  formatNumber,
} from "../utils/format";
import type {
  AdjustmentStatus,
  CycleCountStatus,
  MovementType,
  ReservationStatus,
  StockStatus,
  StockVelocity,
} from "../types";

// =============================================================================
// BADGES
// =============================================================================

export function StockStatusBadge({
  status,
  className,
}: {
  status: StockStatus;
  className?: string;
}) {
  return (
    <Badge variant={STOCK_STATUS_VARIANTS[status]} className={className}>
      {STOCK_STATUS_LABELS[status]}
    </Badge>
  );
}

export function VelocityBadge({
  velocity,
  className,
}: {
  velocity: StockVelocity;
  className?: string;
}) {
  // NORMAL is the default state and needs no badge — labelling every ordinary
  // row adds ink without adding information.
  if (velocity === "NORMAL") return null;

  return (
    <Badge variant={VELOCITY_VARIANTS[velocity]} className={className}>
      {VELOCITY_LABELS[velocity]}
    </Badge>
  );
}

export function MovementBadge({
  type,
  className,
}: {
  type: MovementType;
  className?: string;
}) {
  return (
    <Badge variant={MOVEMENT_VARIANTS[type]} className={className}>
      {MOVEMENT_LABELS[type]}
    </Badge>
  );
}

export function ReservationStatusBadge({ status }: { status: ReservationStatus }) {
  return (
    <Badge variant={RESERVATION_STATUS_VARIANTS[status]}>
      {RESERVATION_STATUS_LABELS[status]}
    </Badge>
  );
}

export function AdjustmentStatusBadge({ status }: { status: AdjustmentStatus }) {
  return (
    <Badge variant={ADJUSTMENT_STATUS_VARIANTS[status]}>
      {ADJUSTMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function CycleCountStatusBadge({ status }: { status: CycleCountStatus }) {
  return (
    <Badge variant={CYCLE_COUNT_STATUS_VARIANTS[status]}>
      {CYCLE_COUNT_STATUS_LABELS[status]}
    </Badge>
  );
}

// =============================================================================
// PRODUCT THUMBNAIL
// =============================================================================

/**
 * Product image with a graceful fallback.
 *
 * Most retail catalogues have patchy imagery, so the fallback is the common
 * case rather than the error case — it gets a real icon tile, not a broken
 * image glyph.
 */
export function ProductThumb({
  src,
  alt,
  size = "md",
  className,
}: {
  src: string | null | undefined;
  alt: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "h-8 w-8",
    md: "h-10 w-10",
    lg: "h-16 w-16",
  } as const;

  if (!src) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md bg-muted",
          sizes[size],
          className
        )}
        aria-hidden="true"
      >
        <Package className="h-1/2 w-1/2 text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={cn("shrink-0 rounded-md object-cover", sizes[size], className)}
      // A broken URL falls back to the tile rather than an alt-text stub.
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );
}

// =============================================================================
// STOCK CELL
// =============================================================================

/**
 * The stock figure, showing physical / reserved / available together.
 *
 * These three are shown as ONE cell rather than three columns because they are
 * one fact: what is here, what is spoken for, what can be sold. Splitting them
 * invites reading "10" as sellable when 8 of it is on hold.
 */
export function StockCell({
  currentStock,
  reserved,
  available,
  className,
}: {
  currentStock: number;
  reserved: number;
  available: number;
  className?: string;
}) {
  const negative = currentStock < 0;

  return (
    <div className={cn("min-w-0 tabular-nums", className)}>
      <div
        className={cn(
          "font-medium",
          negative && "text-destructive",
          !negative && available <= 0 && "text-muted-foreground"
        )}
      >
        {formatNumber(available)}
        {/* Only mention holds when there ARE holds — a "0 held" note on every
            row is noise that hides the rows where it matters. */}
        {reserved > 0 && (
          <span className="ml-1 text-[11px] font-normal text-muted-foreground">
            avail
          </span>
        )}
      </div>

      {reserved > 0 && (
        <div className="text-[11px] text-muted-foreground">
          {formatNumber(currentStock)} on hand · {formatNumber(reserved)} held
        </div>
      )}
    </div>
  );
}

/** Signed quantity, coloured by direction. Used throughout the ledger. */
export function DeltaCell({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        value > 0 && "text-emerald-600 dark:text-emerald-400",
        value < 0 && "text-destructive",
        value === 0 && "text-muted-foreground",
        className
      )}
    >
      {formatDelta(value)}
    </span>
  );
}

// =============================================================================
// KPI CARD
// =============================================================================

export function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
  accent?: string;
  onClick?: (() => void) | undefined;
}) {
  const Wrapper = onClick ? "button" : "div";

  return (
    <Card className={cn("p-3 transition-colors", onClick && "hover:border-primary/40")}>
      <Wrapper
        {...(onClick ? { onClick, type: "button" as const } : {})}
        className={cn("w-full text-left", onClick && "cursor-pointer")}
      >
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </div>
        <div className={cn("mt-1 text-lg font-bold tabular-nums", accent)}>{value}</div>
        {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div>}
      </Wrapper>
    </Card>
  );
}

export function KpiCardSkeleton() {
  return (
    <Card className="p-3">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-2 h-6 w-14" />
    </Card>
  );
}

// =============================================================================
// SKELETONS
// =============================================================================

export function InventoryTableSkeleton({
  columns,
  rows = 8,
}: {
  columns: number;
  rows?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-border">
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// =============================================================================
// PRODUCT IDENTITY CELL
// =============================================================================

/** Image + name + SKU, the identity block repeated across every inventory table. */
export function ProductCell({
  imageUrl,
  productName,
  variantName,
  sku,
  onClick,
}: {
  imageUrl: string | null;
  productName: string;
  variantName?: string;
  sku: string;
  onClick?: () => void;
}) {
  const body = (
    <div className="flex min-w-0 items-center gap-3">
      <ProductThumb src={imageUrl} alt={productName} />
      <div className="min-w-0">
        <div className="truncate font-medium">{productName}</div>
        <div className="truncate text-xs text-muted-foreground">
          {sku}
          {variantName && variantName !== "—" ? ` · ${variantName}` : ""}
        </div>
      </div>
    </div>
  );

  if (!onClick) return body;

  return (
    <button type="button" onClick={onClick} className="w-full text-left hover:underline">
      {body}
    </button>
  );
}
