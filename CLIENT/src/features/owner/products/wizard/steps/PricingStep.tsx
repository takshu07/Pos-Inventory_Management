import { IndianRupee, Percent } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/utils/formatters";
import { useWizard } from "../WizardContext";
import { StepShell, FieldGroup } from "../components/StepShell";
import { calcTotals } from "../helpers";

/**
 * Step 8 — Pricing. Sets pricing defaults (cost / selling / MRP / GST) and
 * applies them across all variants, with live margin, profit, and inventory-value
 * previews. Selling < cost is allowed here but flagged as a warning downstream.
 */
export function PricingStep() {
  const { state, dispatch, patchDefaults } = useWizard();
  const d = state.defaults;
  const totals = calcTotals(state.variants);

  const cost = d.costPrice === "" ? 0 : Number(d.costPrice);
  const sell = d.sellingPrice === "" ? 0 : Number(d.sellingPrice);
  const margin = sell - cost;
  const marginPct = sell > 0 ? (margin / sell) * 100 : 0;

  const applyToAll = () => {
    const ids = state.variants.filter((v) => !v.removed).map((v) => v.id);
    dispatch({
      type: "PATCH_VARIANTS",
      ids,
      patch: {
        costPrice: cost,
        sellingPrice: sell,
        mrp: d.mrp === "" ? 0 : Number(d.mrp),
      },
    });
  };

  return (
    <StepShell
      title="Pricing"
      description="Set default prices and apply them to all variants. Margins update live."
    >
      <FieldGroup title="Default pricing" columns={3}>
        <Input label="Cost price" type="number" min={0} value={d.costPrice}
          onChange={(e) => patchDefaults({ costPrice: e.target.value === "" ? "" : Number(e.target.value) })} />
        <Input label="Selling price" type="number" min={0} value={d.sellingPrice}
          onChange={(e) => patchDefaults({ sellingPrice: e.target.value === "" ? "" : Number(e.target.value) })} />
        <Input label="MRP" type="number" min={0} value={d.mrp}
          onChange={(e) => patchDefaults({ mrp: e.target.value === "" ? "" : Number(e.target.value) })} />
        <Input label="GST %" type="number" min={0} max={100} value={d.gstRate}
          onChange={(e) => patchDefaults({ gstRate: e.target.value === "" ? "" : Number(e.target.value) })} />
      </FieldGroup>

      <div>
        <Button variant="outline" onClick={applyToAll} leftIcon={<IndianRupee className="h-4 w-4" />}>
          Apply pricing to all {totals.variantCount} variants
        </Button>
      </div>

      {sell < cost && sell > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/15 dark:text-amber-400">
          Selling price is below cost — this variant would sell at a loss.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={IndianRupee} label="Unit margin" value={formatCurrency(margin)} accent={margin < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"} />
        <Stat icon={Percent} label="Margin %" value={`${marginPct.toFixed(1)}%`} accent={margin < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"} />
        <Stat icon={IndianRupee} label="Inventory value" value={formatCurrency(totals.totalStockValue)} />
        <Stat icon={IndianRupee} label="Retail value" value={formatCurrency(totals.totalRetailValue)} />
      </div>

      <p className="text-xs text-muted-foreground">
        Per-variant prices can be fine-tuned in the Variant Details step. Applying here overwrites all
        variant prices with the defaults above.
      </p>
    </StepShell>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={`mt-1 text-lg font-semibold ${accent ?? ""}`}>{value}</div>
    </div>
  );
}
