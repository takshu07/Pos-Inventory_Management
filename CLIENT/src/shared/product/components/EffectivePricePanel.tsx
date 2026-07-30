import { Info, Tag } from "lucide-react";
import { Badge, ErrorState, Skeleton } from "@/components/ui";
import { formatCurrency } from "@/utils/formatters";
import { useProductPricing, type EffectivePrice } from "../pricingApi";

/**
 * "Why is this price what it is?" — the engine's own explanation, per variant.
 *
 * Reads /pricing/product/:id, which MANAGERS may also call: the server strips
 * cost, margin and profit from their response and sets `readOnly`. So this
 * component renders whatever financial fields it is given and never decides
 * permissions itself — the absent field IS the permission boundary.
 */
export function EffectivePricePanel({ productId }: { productId: string }) {
  const { data, isLoading, isError, refetch } = useProductPricing(productId);

  if (isError) return <ErrorState message="Failed to load pricing." onRetry={() => refetch()} />;

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Prices below are what the till charges. Each one shows the discount rule that produced
          it — product rules beat category rules, and higher priority wins within a tier.
        </span>
      </div>

      {data.variants.map((v) => (
        <div key={v.variantId} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">
              {v.size} · {v.color}
              <span className="ml-2 font-normal text-muted-foreground">{v.sku}</span>
            </div>
            {!v.isActive && <Badge variant="outline">Inactive</Badge>}
          </div>

          {v.pricing ? (
            <VariantPricing pricing={v.pricing} />
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No pricing recorded.</p>
          )}
        </div>
      ))}
    </div>
  );
}

function VariantPricing({ pricing: p }: { pricing: EffectivePrice }) {
  return (
    <>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-lg font-semibold">{formatCurrency(p.sellingPrice)}</span>
        {p.effectiveDiscount > 0 && (
          <>
            <span className="text-sm text-muted-foreground line-through">
              {formatCurrency(p.mrp)}
            </span>
            <Badge variant="success">{p.effectiveDiscountPct.toFixed(1)}% off</Badge>
          </>
        )}
        {p.margin != null && (
          <span className="text-xs text-muted-foreground">
            margin {formatCurrency(p.margin)}
            {p.profitPct != null && ` · ${p.profitPct.toFixed(1)}%`}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Tag className="h-3.5 w-3.5" />
        <span>{p.source.label}</span>
        {p.source.ruleName && (
          <span className="text-foreground">
            — {p.source.ruleName}
            {p.source.type === "PERCENTAGE"
              ? ` (${p.source.value}%)`
              : p.source.type === "FLAT"
                ? ` (${formatCurrency(p.source.value ?? 0)})`
                : ""}
          </span>
        )}
      </div>

      {(p.wasClamped || p.wasCapped) && (
        <div className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
          {p.wasClamped && "Discount exceeded MRP and was clamped. "}
          {p.wasCapped && "Discount was capped to protect the cost floor."}
        </div>
      )}
    </>
  );
}
