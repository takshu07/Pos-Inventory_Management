import { Fragment, useState } from "react";
import { RefreshCw, ChevronDown, ChevronRight, Barcode, Info } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatCurrency } from "@/utils/formatters";
import { cn } from "@/utils/cn";
import { useWizard } from "../WizardContext";
import { StepShell } from "../components/StepShell";
import { BulkEditBar } from "../components/BulkEditBar";
import { PriceOverrideDialog } from "../components/PriceOverrideDialog";
import { VariantRowMenu } from "../components/VariantRowMenu";
import { effectivePricing, generateBarcode, isValidEan13 } from "../helpers";
import type { WizardVariant } from "../types";

/**
 * Step 8 — Variant Details. An inventory / SKU configuration screen: variant,
 * SKU, barcode (generate + EAN-13 verification), opening stock, reorder level
 * and status, plus an expandable panel for dimensions, shelf location, supplier
 * SKU and variant image.
 *
 * Deliberately contains NO pricing inputs. Prices are configured once in the
 * Pricing step and inherited by every variant; a variant deviates only via the
 * ⋮ → Override Pricing dialog, which is an explicit action rather than an
 * editable column. The Price column here is read-only provenance, showing
 * whether the row inherits or is overridden.
 */
export function VariantDetailsStep() {
  const { state, dispatch, setPriceOverride, clearPriceOverride } = useWizard();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [overrideId, setOverrideId] = useState<string | null>(null);

  const variants = state.variants.filter((v) => !v.removed);
  const overrideTarget = state.variants.find((v) => v.id === overrideId) ?? null;

  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = variants.length > 0 && variants.every((v) => selected.has(v.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(variants.map((v) => v.id)));

  const patchVariant = (id: string, patch: Partial<WizardVariant>) =>
    dispatch({ type: "PATCH_VARIANT", id, patch });

  const applyBulk = (
    patch: Partial<WizardVariant>,
    prefixes: { sku?: string; barcode?: string }
  ) => {
    const ids = [...selected];
    if (prefixes.sku !== undefined) {
      ids.forEach((id) => {
        const v = state.variants.find((x) => x.id === id);
        if (!v) return;
        const tail = v.sku.split("-").slice(-1)[0] ?? "0001";
        patchVariant(id, {
          sku: [prefixes.sku, v.colorName.slice(0, 3).toUpperCase(), v.sizeName, tail]
            .filter(Boolean)
            .join("-"),
        });
      });
      return;
    }
    if (prefixes.barcode !== undefined) {
      ids.forEach((id) => patchVariant(id, { barcode: generateBarcode(prefixes.barcode) }));
      return;
    }
    dispatch({ type: "PATCH_VARIANTS", ids, patch });
  };

  if (variants.length === 0) {
    return (
      <StepShell title="Variant Details">
        <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          No variants yet — generate them in the Variants step.
        </div>
      </StepShell>
    );
  }

  const overrideCount = variants.filter((v) => v.priceOverride).length;

  return (
    <StepShell
      title="Variant Details"
      description="Configure SKU, barcode and stock per variant. Select rows to bulk-edit."
    >
      <div className="flex gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Every variant inherits the product pricing set in the Pricing step.
          {overrideCount > 0 ? (
            <>
              {" "}
              <strong className="text-foreground">
                {overrideCount} variant{overrideCount === 1 ? "" : "s"} overridden.
              </strong>
            </>
          ) : null}{" "}
          To price one variant differently, use <strong className="text-foreground">⋮ →
          Override Pricing</strong>.
        </span>
      </div>

      {selected.size > 0 && (
        <BulkEditBar
          selectedCount={selected.size}
          onApply={applyBulk}
          onClear={() => setSelected(new Set())}
        />
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all"
                />
              </th>
              <th className="px-2 py-2 text-left">Variant</th>
              <th className="px-2 py-2 text-left">SKU</th>
              <th className="px-2 py-2 text-left">Barcode</th>
              <th className="px-2 py-2 text-right">Opening stock</th>
              <th className="px-2 py-2 text-right">Reorder level</th>
              <th className="px-2 py-2 text-left">Price</th>
              <th className="px-2 py-2 text-left">Status</th>
              <th className="w-8 px-2 py-2" />
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {variants.map((v) => {
              const eff = effectivePricing(v, state.pricing);
              const isExpanded = expanded.has(v.id);
              const badBarcode = v.barcode !== "" && !isValidEan13(v.barcode.trim());
              return (
                <Fragment key={v.id}>
                  <tr className="hover:bg-muted/20">
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={selected.has(v.id)}
                        onChange={() => toggleSel(v.id)}
                        aria-label={`Select ${v.sku}`}
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        {v.colorHex && (
                          <span
                            className="h-3 w-3 rounded-full border border-border"
                            style={{ backgroundColor: v.colorHex }}
                          />
                        )}
                        <span className="font-medium">{v.colorName}</span>
                        <span className="text-muted-foreground">/ {v.sizeName}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <CellInput
                        value={v.sku}
                        onChange={(val) => patchVariant(v.id, { sku: val })}
                        className="w-32 font-mono text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <CellInput
                          value={v.barcode}
                          onChange={(val) => patchVariant(v.id, { barcode: val })}
                          className={cn(
                            "w-32 font-mono text-xs",
                            badBarcode && "border-destructive"
                          )}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() =>
                            patchVariant(v.id, {
                              barcode: generateBarcode(state.defaults.barcodePrefix),
                            })
                          }
                          title="Generate barcode"
                          aria-label="Generate barcode"
                        >
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <NumCell
                        value={v.openingStock}
                        onChange={(n) => patchVariant(v.id, { openingStock: n })}
                        width="w-20"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <NumCell
                        value={v.reorderLevel}
                        onChange={(n) => patchVariant(v.id, { reorderLevel: n })}
                        width="w-20"
                      />
                    </td>
                    {/* Read-only provenance — never an input. */}
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">
                          {formatCurrency(eff.sellingPrice)}
                        </span>
                        {eff.isOverride ? (
                          <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
                            Override
                          </span>
                        ) : (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Inherited
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={v.status}
                        onChange={(e) =>
                          patchVariant(v.id, {
                            status: e.target.value as WizardVariant["status"],
                          })
                        }
                        options={[
                          { value: "ACTIVE", label: "Active" },
                          { value: "INACTIVE", label: "Inactive" },
                        ]}
                        className="h-7 py-0 text-xs"
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <VariantRowMenu
                        hasOverride={v.priceOverride != null}
                        onOverride={() => setOverrideId(v.id)}
                        onReset={() => clearPriceOverride(v.id)}
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(v.id)) next.delete(v.id);
                            else next.add(v.id);
                            return next;
                          })
                        }
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Toggle details"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-muted/10">
                      <td colSpan={10} className="px-4 py-3">
                        <ExpandedVariant
                          variant={v}
                          sellingPrice={eff.sellingPrice}
                          onChange={(patch) => patchVariant(v.id, patch)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <PriceOverrideDialog
        open={overrideTarget != null}
        variant={overrideTarget}
        pricing={state.pricing}
        onClose={() => setOverrideId(null)}
        onSave={setPriceOverride}
        onClear={clearPriceOverride}
      />
    </StepShell>
  );
}

function CellInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-7 rounded border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className
      )}
    />
  );
}

function NumCell({
  value,
  onChange,
  width = "w-20",
}: {
  value: number;
  onChange: (n: number) => void;
  width?: string;
}) {
  return (
    <input
      type="number"
      min={0}
      value={Number.isNaN(value) ? "" : value}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      className={cn(
        "h-7 rounded border border-input bg-background px-2 text-right text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        width
      )}
    />
  );
}

function ExpandedVariant({
  variant: v,
  sellingPrice,
  onChange,
}: {
  variant: WizardVariant;
  sellingPrice: number;
  onChange: (patch: Partial<WizardVariant>) => void;
}) {
  const numOrEmpty = (val: string): number | "" => (val === "" ? "" : Number(val));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Input
          label="Max stock"
          type="number"
          min={0}
          value={v.maximumStock}
          onChange={(e) => onChange({ maximumStock: numOrEmpty(e.target.value) })}
        />
        <Input
          label="Weight (g)"
          type="number"
          min={0}
          value={v.weight}
          onChange={(e) => onChange({ weight: numOrEmpty(e.target.value) })}
        />
        <Input
          label="Supplier SKU"
          value={v.supplierSku}
          onChange={(e) => onChange({ supplierSku: e.target.value })}
        />
        <Input
          label="Variant image URL"
          value={v.imageUrl}
          onChange={(e) => onChange({ imageUrl: e.target.value })}
          placeholder="https://…"
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Input
          label="Length (cm)"
          type="number"
          min={0}
          value={v.lengthCm}
          onChange={(e) => onChange({ lengthCm: numOrEmpty(e.target.value) })}
        />
        <Input
          label="Width (cm)"
          type="number"
          min={0}
          value={v.widthCm}
          onChange={(e) => onChange({ widthCm: numOrEmpty(e.target.value) })}
        />
        <Input
          label="Height (cm)"
          type="number"
          min={0}
          value={v.heightCm}
          onChange={(e) => onChange({ heightCm: numOrEmpty(e.target.value) })}
        />
        <Input
          label="Shelf location"
          value={v.shelfLocation}
          onChange={(e) => onChange({ shelfLocation: e.target.value })}
          placeholder="e.g. A3-R2"
        />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Barcode className="h-3.5 w-3.5" />
        Label preview: <span className="font-mono">{v.sku}</span> · {v.barcode || "no barcode"} ·{" "}
        {formatCurrency(sellingPrice)}
      </div>
    </div>
  );
}
