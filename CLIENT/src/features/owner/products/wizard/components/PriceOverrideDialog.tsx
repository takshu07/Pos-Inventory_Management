import { useEffect, useState } from "react";
import { RotateCcw, Info } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatCurrency } from "@/utils/formatters";
import { cn } from "@/utils/cn";
import { productPricing } from "../helpers";
import { validatePriceTriplet } from "../validation";
import type { VariantPriceOverride, WizardState, WizardVariant } from "../types";

/**
 * PriceOverrideDialog — the ONLY per-variant pricing surface in the wizard.
 *
 * Pricing is never editable inline in the variant table; a variant inherits the
 * product pricing unless the owner deliberately overrides it here (e.g.
 * Black/XL ₹1000 vs Black/XXL ₹1100). Saving marks the variant as overridden;
 * "Reset to product pricing" restores inheritance.
 */
export function PriceOverrideDialog({
  open,
  variant,
  pricing,
  onClose,
  onSave,
  onClear,
}: {
  open: boolean;
  variant: WizardVariant | null;
  pricing: WizardState["pricing"];
  onClose: () => void;
  onSave: (id: string, override: VariantPriceOverride) => void;
  onClear: (id: string) => void;
}) {
  const base = productPricing(pricing);
  const [cost, setCost] = useState<number | "">("");
  const [sell, setSell] = useState<number | "">("");
  const [mrp, setMrp] = useState<number | "">("");

  // Seed from the existing override, else from the inherited product pricing so
  // the owner edits a concrete starting point rather than empty boxes.
  useEffect(() => {
    if (!open || !variant) return;
    const seed = variant.priceOverride ?? base;
    setCost(seed.costPrice);
    setSell(seed.sellingPrice);
    setMrp(seed.mrp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, variant?.id]);

  if (!variant) return null;

  const nCost = cost === "" ? 0 : Number(cost);
  const nSell = sell === "" ? 0 : Number(sell);
  const nMrp = mrp === "" ? 0 : Number(mrp);

  const errors = validatePriceTriplet(
    { costPrice: nCost, sellingPrice: nSell, mrp: nMrp },
    { requirePositiveSelling: true }
  );
  const margin = nSell - nCost;
  const marginPct = nSell > 0 ? (margin / nSell) * 100 : 0;

  // An "override" identical to the product pricing is pointless duplication —
  // steer the owner back to inheritance instead of storing a redundant copy.
  const matchesProduct =
    nCost === base.costPrice && nSell === base.sellingPrice && nMrp === base.mrp;

  const num = (v: string): number | "" => (v === "" ? "" : Number(v));

  const save = () => {
    if (errors.length > 0) return;
    if (matchesProduct) {
      onClear(variant.id); // same as product → keep inheriting
    } else {
      onSave(variant.id, { costPrice: nCost, sellingPrice: nSell, mrp: nMrp });
    }
    onClose();
  };

  const label = `${variant.colorName} / ${variant.sizeName}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Override pricing"
      description={`${label} · ${variant.sku}`}
      size="md"
      footer={
        <>
          {variant.priceOverride && (
            <Button
              variant="ghost"
              onClick={() => {
                onClear(variant.id);
                onClose();
              }}
              leftIcon={<RotateCcw className="h-4 w-4" />}
            >
              Reset to product pricing
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={errors.length > 0}>
            Save override
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Product pricing is {formatCurrency(base.costPrice)} cost ·{" "}
            {formatCurrency(base.sellingPrice)} selling · {formatCurrency(base.mrp)} MRP. Values
            saved here apply to this variant only.
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            label="Cost price"
            type="number"
            min={0}
            step="0.01"
            value={cost}
            onChange={(e) => setCost(num(e.target.value))}
            autoFocus
          />
          <Input
            label="Selling price"
            type="number"
            min={0}
            step="0.01"
            value={sell}
            onChange={(e) => setSell(num(e.target.value))}
          />
          <Input
            label="MRP"
            type="number"
            min={0}
            step="0.01"
            value={mrp}
            onChange={(e) => setMrp(num(e.target.value))}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
          <span className="text-muted-foreground">Unit margin</span>
          <span
            className={cn(
              "font-semibold",
              margin < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
            )}
          >
            {formatCurrency(margin)} · {marginPct.toFixed(1)}%
          </span>
        </div>

        {errors.length > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <ul className="list-inside list-disc space-y-0.5">
              {errors.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          </div>
        )}

        {errors.length === 0 && matchesProduct && (
          <p className="text-xs text-muted-foreground">
            These values match the product pricing — saving will keep this variant inheriting
            instead of storing a duplicate override.
          </p>
        )}
      </div>
    </Modal>
  );
}
