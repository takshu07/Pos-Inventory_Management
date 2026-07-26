import { Card } from "@/components/ui/Card";
import { formatMargin } from "../utils";
import { formatPriceRange } from "../utils";

/**
 * ProductPriceCard — a compact pricing summary. `showFinancials` gates the
 * cost/margin rows: the Manager module passes false (managers never see cost or
 * margin), the Owner module passes true. This is why the same component is
 * shareable across both modules despite their different RBAC.
 */
export function ProductPriceCard({
  minSelling,
  maxSelling,
  minMrp,
  maxMrp,
  avgCost,
  avgMargin,
  showFinancials = false,
}: {
  minSelling: number | null;
  maxSelling: number | null;
  minMrp: number | null;
  maxMrp: number | null;
  avgCost?: number | null;
  avgMargin?: number | null;
  showFinancials?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Pricing</div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Row label="Selling Price" value={formatPriceRange(minSelling, maxSelling)} strong />
        <Row label="MRP" value={formatPriceRange(minMrp, maxMrp)} muted />
        {showFinancials && (
          <>
            <Row
              label="Avg. Cost"
              value={avgCost != null ? formatPriceRange(avgCost, avgCost) : "—"}
            />
            <Row label="Avg. Margin" value={formatMargin(avgMargin)} accent />
          </>
        )}
      </dl>
    </Card>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
  accent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={[
          strong ? "font-semibold" : "font-medium",
          muted ? "text-muted-foreground" : "",
          accent ? "text-emerald-600 dark:text-emerald-400" : "",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}
