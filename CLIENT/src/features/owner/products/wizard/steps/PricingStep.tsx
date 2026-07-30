import { IndianRupee, Percent, TrendingUp, Boxes, Tag, Info } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatCurrency } from "@/utils/formatters";
import { cn } from "@/utils/cn";
import { useWizard } from "../WizardContext";
import { StepShell, FieldGroup } from "../components/StepShell";
import { backSolveDiscount, calcTotals, derivedSellingPrice, discountAmountFor } from "../helpers";
import { pricingErrors } from "../validation";

/**
 * Step 5 — Pricing. THE only place in the wizard where money is entered.
 *
 * Values set here are the product-level default pricing and are inherited by
 * every generated variant automatically — there is no "apply to all" action,
 * because nothing needs applying. A variant deviates only if the owner opens
 * "Override Pricing" on that row in the Variant Details step.
 *
 * This screen is deliberately financial in character: prices, tax, discount
 * policy, and live margin / profit projections across the whole variant set.
 */
export function PricingStep() {
  const { state, patchPricing } = useWizard();
  const p = state.pricing;
  const totals = calcTotals(state.variants, p);
  const errors = pricingErrors(state);

  const cost = p.costPrice === "" ? 0 : Number(p.costPrice);
  const mrp = p.mrp === "" ? 0 : Number(p.mrp);

  // NEVER read p.sellingPrice directly — in derived mode it is only a cached
  // echo of (MRP − discount). derivedSellingPrice mirrors the server engine.
  const sell = derivedSellingPrice(p);
  const defaultDiscount = discountAmountFor(
    mrp,
    p.defaultDiscountType,
    p.defaultDiscountValue === "" ? 0 : Number(p.defaultDiscountValue)
  );
  const margin = sell - cost;
  const marginPct = sell > 0 ? (margin / sell) * 100 : 0;
  const discountPct = p.maxDiscountPct === "" ? 0 : Number(p.maxDiscountPct);

  // Worst-case margin if the cashier applies the maximum permitted discount.
  const discountedSell = sell * (1 - discountPct / 100);
  const discountedMargin = discountedSell - cost;

  // Pricing precedes Inventory in the flow, so on the first pass opening stock is
  // still 0. Aggregates are shown as "—" rather than a misleading ₹0; the unit
  // margin figures beside them are always meaningful.
  const hasStock = totals.totalUnits > 0;

  const num = (val: string): number | "" => (val === "" ? "" : Number(val));
  const good = "text-emerald-600 dark:text-emerald-400";

  return (
    <StepShell
      title="Pricing"
      description="Set the pricing for this product once. Every variant inherits these values automatically."
    >
      <FieldGroup title="Product pricing" columns={2}>
        <Input
          label="Cost price"
          type="number"
          min={0}
          step="0.01"
          value={p.costPrice}
          onChange={(e) => patchPricing({ costPrice: num(e.target.value) })}
          hint="What you pay per unit"
        />
        <Input
          label="MRP"
          type="number"
          min={0}
          step="0.01"
          value={p.mrp}
          onChange={(e) => {
            const nextMrp = num(e.target.value);
            // In manual mode the discount is a function of MRP, so it has to be
            // re-solved whenever MRP moves or the two would drift apart.
            patchPricing({
              mrp: nextMrp,
              ...(p.isManualPricing
                ? {
                    defaultDiscountType: "FLAT" as const,
                    defaultDiscountValue: backSolveDiscount(
                      nextMrp === "" ? 0 : Number(nextMrp),
                      sell
                    ),
                  }
                : {}),
            });
          }}
          hint="Printed maximum retail price"
        />
      </FieldGroup>

      {/* ── Selling price: derived from MRP − discount, or typed manually ───── */}
      <div className="rounded-lg border border-border p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Selling price
          </h3>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={p.isManualPricing}
              onChange={(e) => {
                const manual = e.target.checked;
                patchPricing(
                  manual
                    ? {
                        // Carry the derived figure across so nothing jumps, and
                        // back-solve it to FLAT so discount and price agree.
                        isManualPricing: true,
                        sellingPrice: sell,
                        defaultDiscountType: "FLAT" as const,
                        defaultDiscountValue: backSolveDiscount(mrp, sell),
                      }
                    : { isManualPricing: false }
                );
              }}
              className="h-4 w-4 rounded border-input"
            />
            Enable manual pricing
          </label>
        </div>

        {p.isManualPricing ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Selling price"
              type="number"
              min={0}
              step="0.01"
              value={p.sellingPrice}
              onChange={(e) => {
                const next = num(e.target.value);
                patchPricing({
                  sellingPrice: next,
                  defaultDiscountType: "FLAT",
                  defaultDiscountValue: backSolveDiscount(mrp, next === "" ? 0 : Number(next)),
                });
              }}
              hint="What the customer pays"
            />
            <div className="flex flex-col justify-center rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              Discount is back-solved as a flat{" "}
              <strong className="text-foreground">
                {formatCurrency(backSolveDiscount(mrp, sell))}
              </strong>{" "}
              off MRP, so price and discount stay in step.
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <Select
              label="Default discount"
              options={[
                { value: "PERCENTAGE", label: "Percentage (%)" },
                { value: "FLAT", label: "Flat amount" },
              ]}
              value={p.defaultDiscountType}
              onChange={(e) =>
                patchPricing({
                  defaultDiscountType: e.target.value as "PERCENTAGE" | "FLAT",
                })
              }
            />
            <Input
              label={p.defaultDiscountType === "PERCENTAGE" ? "Value (%)" : "Value (₹)"}
              type="number"
              min={0}
              {...(p.defaultDiscountType === "PERCENTAGE" ? { max: 100 } : {})}
              step="0.01"
              value={p.defaultDiscountValue}
              onChange={(e) => patchPricing({ defaultDiscountValue: num(e.target.value) })}
              hint="Off MRP, before any catalog rule"
            />
            <div className="flex flex-col justify-center rounded-lg border border-border bg-muted/20 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Selling price
              </div>
              <div className="mt-0.5 text-lg font-semibold">{formatCurrency(sell)}</div>
              <div className="text-[11px] text-muted-foreground">
                {formatCurrency(mrp)} − {formatCurrency(defaultDiscount)}
              </div>
            </div>
          </div>
        )}

        <p className="mt-3 text-xs text-muted-foreground">
          This is the product's <strong>base</strong> price. An active catalog discount rule for
          this product or its category can lower it further — the highest-priority rule wins.
        </p>
      </div>

      <FieldGroup title="Tax & discount policy" columns={3}>
        <Input
          label="GST %"
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={p.gstRate}
          onChange={(e) => patchPricing({ gstRate: num(e.target.value) })}
        />
        <div className="flex flex-col justify-center gap-1.5 pt-1">
          <span className="text-sm font-medium">Discount allowed</span>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={p.discountAllowed}
              onChange={(e) =>
                patchPricing({
                  discountAllowed: e.target.checked,
                  // Clearing the policy clears its ceiling, so no stale value persists.
                  ...(e.target.checked ? {} : { maxDiscountPct: "" as const }),
                })
              }
              className="h-4 w-4 rounded border-input"
            />
            Cashiers may discount this product
          </label>
        </div>
        <Input
          label="Maximum discount %"
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={p.maxDiscountPct}
          onChange={(e) => patchPricing({ maxDiscountPct: num(e.target.value) })}
          disabled={!p.discountAllowed}
          hint={p.discountAllowed ? "Ceiling enforced at the till" : "Discounts disabled"}
        />
      </FieldGroup>

      {errors.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <ul className="list-inside list-disc space-y-0.5">
            {errors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Margin & profit preview ─────────────────────────────────────────── */}
      <div>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Margin & profit preview
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            icon={IndianRupee}
            label="Unit margin"
            value={formatCurrency(margin)}
            accent={margin < 0 ? "text-destructive" : good}
          />
          <Stat
            icon={Percent}
            label="Margin %"
            value={`${marginPct.toFixed(1)}%`}
            accent={margin < 0 ? "text-destructive" : good}
          />
          <Stat
            icon={Boxes}
            label="Inventory value"
            value={hasStock ? formatCurrency(totals.totalStockValue) : "—"}
            sub={hasStock ? `${totals.totalUnits} units at cost` : "Set stock in Inventory"}
          />
          <Stat
            icon={Tag}
            label="Retail value"
            value={hasStock ? formatCurrency(totals.totalRetailValue) : "—"}
            sub={hasStock ? "At selling price" : "Set stock in Inventory"}
          />
          <Stat
            icon={TrendingUp}
            label="Projected profit"
            value={hasStock ? formatCurrency(totals.projectedProfit) : "—"}
            accent={hasStock && totals.projectedProfit < 0 ? "text-destructive" : good}
            sub={hasStock ? "If all stock sells" : "Set stock in Inventory"}
          />
        </div>
        {!hasStock && (
          <p className="mt-2 text-xs text-muted-foreground">
            Inventory, retail and profit projections appear once opening stock is set in the
            Inventory step — margins above are per unit and already final.
          </p>
        )}
      </div>

      {mrp > 0 && sell > 0 && mrp > sell && (
        <p className="text-xs text-muted-foreground">
          Customer sees a {(((mrp - sell) / mrp) * 100).toFixed(1)}% saving against MRP.
        </p>
      )}

      {p.discountAllowed && discountPct > 0 && sell > 0 && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            discountedMargin < 0
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : "border-border bg-muted/20 text-muted-foreground"
          )}
        >
          At the maximum {discountPct}% discount, price falls to{" "}
          <strong>{formatCurrency(discountedSell)}</strong> — margin{" "}
          <strong>{formatCurrency(discountedMargin)}</strong> per unit
          {discountedMargin < 0 && " (sells at a loss)"}.
        </div>
      )}

      <div className="flex gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          All {totals.variantCount} variant{totals.variantCount === 1 ? "" : "s"} inherit this
          pricing automatically.
          {totals.overrideCount > 0 && (
            <>
              {" "}
              <strong className="text-foreground">
                {totals.overrideCount} variant{totals.overrideCount === 1 ? " has" : "s have"} a
                price override
              </strong>{" "}
              and keep their own values.
            </>
          )}{" "}
          Need a different price for one size or colour? Use{" "}
          <strong className="text-foreground">Override Pricing</strong> on that row in Variant
          Details.
        </span>
      </div>
    </StepShell>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  accent,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" /> {label}
      </div>
      <div className={cn("mt-1 text-lg font-semibold", accent)}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
