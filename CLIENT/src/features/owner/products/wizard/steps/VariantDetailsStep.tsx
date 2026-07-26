import { Fragment, useState } from "react";
import { RefreshCw, ChevronDown, ChevronRight, Barcode } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatCurrency } from "@/utils/formatters";
import { cn } from "@/utils/cn";
import { useWizard } from "../WizardContext";
import { StepShell } from "../components/StepShell";
import { BulkEditBar } from "../components/BulkEditBar";
import { calcVariant, generateBarcode, isValidEan13 } from "../helpers";
import type { WizardVariant } from "../types";

/**
 * Step 5 — Variant Details. The editable variant grid: SKU, barcode (with
 * generate + EAN-13 verification + print-preview), MRP/selling/cost, opening
 * stock, reorder level, plus an expandable panel per variant for dimensions,
 * shelf location, supplier SKU, and variant image. Multi-select + bulk edit
 * apply values across many variants at once. Per-row margin/profit shown live.
 */
export function VariantDetailsStep() {
  const { state, dispatch } = useWizard();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const variants = state.variants.filter((v) => !v.removed);

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
        patchVariant(id, { sku: [prefixes.sku, v.colorName.slice(0, 3).toUpperCase(), v.sizeName, tail].filter(Boolean).join("-") });
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
          No variants yet — generate them in the previous step.
        </div>
      </StepShell>
    );
  }

  return (
    <StepShell
      title="Variant Details"
      description="Set SKU, barcode, pricing and opening stock per variant. Select rows to bulk-edit."
    >
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
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th className="px-2 py-2 text-left">Variant</th>
              <th className="px-2 py-2 text-left">SKU</th>
              <th className="px-2 py-2 text-left">Barcode</th>
              <th className="px-2 py-2 text-right">Cost</th>
              <th className="px-2 py-2 text-right">Selling</th>
              <th className="px-2 py-2 text-right">MRP</th>
              <th className="px-2 py-2 text-right">Stock</th>
              <th className="px-2 py-2 text-right">Margin</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {variants.map((v) => {
              const calc = calcVariant(v);
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
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {v.colorHex && (
                          <span className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: v.colorHex }} />
                        )}
                        <span className="font-medium">{v.colorName}</span>
                        <span className="text-muted-foreground">/ {v.sizeName}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <CellInput value={v.sku} onChange={(val) => patchVariant(v.id, { sku: val })} className="w-32 font-mono text-xs" />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <CellInput
                          value={v.barcode}
                          onChange={(val) => patchVariant(v.id, { barcode: val })}
                          className={cn("w-32 font-mono text-xs", badBarcode && "border-destructive")}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => patchVariant(v.id, { barcode: generateBarcode(state.defaults.barcodePrefix) })}
                          title="Generate barcode"
                          aria-label="Generate barcode"
                        >
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <NumCell value={v.costPrice} onChange={(n) => patchVariant(v.id, { costPrice: n })} />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <NumCell value={v.sellingPrice} onChange={(n) => patchVariant(v.id, { sellingPrice: n })} />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <NumCell value={v.mrp} onChange={(n) => patchVariant(v.id, { mrp: n })} />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <NumCell value={v.openingStock} onChange={(n) => patchVariant(v.id, { openingStock: n })} width="w-16" />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <span className={cn("font-medium", calc.margin < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400")}>
                        {calc.profitPct.toFixed(0)}%
                      </span>
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
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-muted/10">
                      <td colSpan={10} className="px-4 py-3">
                        <ExpandedVariant variant={v} onChange={(patch) => patchVariant(v.id, patch)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
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
  onChange,
}: {
  variant: WizardVariant;
  onChange: (patch: Partial<WizardVariant>) => void;
}) {
  const numOrEmpty = (val: string): number | "" => (val === "" ? "" : Number(val));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Input label="Reorder level" type="number" min={0} value={v.reorderLevel}
          onChange={(e) => onChange({ reorderLevel: e.target.value === "" ? 0 : Number(e.target.value) })} />
        <Input label="Max stock" type="number" min={0} value={v.maximumStock}
          onChange={(e) => onChange({ maximumStock: numOrEmpty(e.target.value) })} />
        <Input label="Weight (g)" type="number" min={0} value={v.weight}
          onChange={(e) => onChange({ weight: numOrEmpty(e.target.value) })} />
        <Input label="Variant image URL" value={v.imageUrl}
          onChange={(e) => onChange({ imageUrl: e.target.value })} placeholder="https://…" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Input label="Length (cm)" type="number" min={0} value={v.lengthCm}
          onChange={(e) => onChange({ lengthCm: numOrEmpty(e.target.value) })} />
        <Input label="Width (cm)" type="number" min={0} value={v.widthCm}
          onChange={(e) => onChange({ widthCm: numOrEmpty(e.target.value) })} />
        <Input label="Height (cm)" type="number" min={0} value={v.heightCm}
          onChange={(e) => onChange({ heightCm: numOrEmpty(e.target.value) })} />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Barcode className="h-3.5 w-3.5" />
        Label preview: <span className="font-mono">{v.sku}</span> · {v.barcode || "no barcode"} ·{" "}
        {formatCurrency(v.sellingPrice)}
      </div>
    </div>
  );
}
