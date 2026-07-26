import { Boxes } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useWizard } from "../WizardContext";
import { StepShell, FieldGroup } from "../components/StepShell";
import { calcTotals } from "../helpers";

/**
 * Step 6 — Inventory. Sets inventory DEFAULTS (opening stock, reorder, max,
 * warehouse) and a location applied to every active variant with one click.
 * Opening stock becomes an OPENING_STOCK inventory movement at create time.
 */
export function InventoryStep() {
  const { state, dispatch, patchDefaults } = useWizard();
  const totals = calcTotals(state.variants);
  const d = state.defaults;

  const applyToAll = () => {
    const ids = state.variants.filter((v) => !v.removed).map((v) => v.id);
    dispatch({
      type: "PATCH_VARIANTS",
      ids,
      patch: {
        openingStock: d.openingStock === "" ? 0 : Number(d.openingStock),
        reorderLevel: d.reorderLevel === "" ? 0 : Number(d.reorderLevel),
        maximumStock: d.maximumStock === "" ? "" : Number(d.maximumStock),
        warehouse: d.warehouse,
      },
    });
  };

  return (
    <StepShell
      title="Inventory"
      description="Set opening stock and alert thresholds. Apply them to every variant at once."
    >
      <FieldGroup title="Defaults" columns={3}>
        <Input label="Opening stock" type="number" min={0} value={d.openingStock}
          onChange={(e) => patchDefaults({ openingStock: e.target.value === "" ? "" : Number(e.target.value) })} />
        <Input label="Reorder level (low-stock alert)" type="number" min={0} value={d.reorderLevel}
          onChange={(e) => patchDefaults({ reorderLevel: e.target.value === "" ? "" : Number(e.target.value) })} />
        <Input label="Maximum stock" type="number" min={0} value={d.maximumStock}
          onChange={(e) => patchDefaults({ maximumStock: e.target.value === "" ? "" : Number(e.target.value) })} />
      </FieldGroup>

      <FieldGroup title="Location" columns={1}>
        <Input label="Warehouse / Store" value={d.warehouse}
          onChange={(e) => patchDefaults({ warehouse: e.target.value })}
          hint="Per-variant rack/shelf/bin can be set in the Variant Details step." />
      </FieldGroup>

      <div>
        <Button variant="outline" onClick={applyToAll} leftIcon={<Boxes className="h-4 w-4" />}>
          Apply to all {totals.variantCount} variants
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Variants" value={String(totals.variantCount)} />
        <Stat label="Total opening units" value={String(totals.totalUnits)} />
        <Stat label="Inventory value (cost)" value={totals.totalStockValue.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })} />
      </div>
    </StepShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
