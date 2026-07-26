import { Truck } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { useWizard } from "../WizardContext";
import { StepShell, FieldGroup } from "../components/StepShell";
import { useSupplierOptions } from "../../hooks/useOwnerProducts";

/**
 * Step 7 — Supplier. Choose a preferred supplier for the product and apply it to
 * every variant. Per-variant supplier SKU / lead time are editable in the
 * Variant Details expander; this sets the common default fast.
 */
export function SupplierStep() {
  const { state, dispatch, patchDefaults } = useWizard();
  const { data: suppliers = [], isLoading } = useSupplierOptions();
  const d = state.defaults;

  const applyToAll = () => {
    const ids = state.variants.filter((v) => !v.removed).map((v) => v.id);
    dispatch({ type: "PATCH_VARIANTS", ids, patch: { supplierId: d.supplierId } });
  };

  const selected = suppliers.find((s) => s.id === d.supplierId);
  const assignedCount = state.variants.filter((v) => !v.removed && v.supplierId).length;
  const activeCount = state.variants.filter((v) => !v.removed).length;

  return (
    <StepShell
      title="Supplier"
      description="Assign a preferred supplier. Supplier is optional but recommended for reordering."
    >
      <FieldGroup columns={2}>
        <Select
          label="Preferred supplier"
          placeholder={isLoading ? "Loading…" : "Select supplier"}
          options={[
            { value: "", label: "— none —" },
            ...suppliers.map((s) => ({ value: s.id, label: s.businessName })),
          ]}
          value={d.supplierId}
          onChange={(e) => patchDefaults({ supplierId: e.target.value })}
        />
      </FieldGroup>

      <div>
        <Button variant="outline" onClick={applyToAll} leftIcon={<Truck className="h-4 w-4" />}>
          Apply {selected ? `"${selected.businessName}"` : "supplier"} to all variants
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
        {assignedCount === 0 ? (
          <span className="text-muted-foreground">
            No supplier assigned yet. You can proceed without one, or assign above.
          </span>
        ) : (
          <>
            <span className="font-medium">{assignedCount}</span> of {activeCount} variants have a
            supplier assigned.
          </>
        )}
      </div>
    </StepShell>
  );
}
