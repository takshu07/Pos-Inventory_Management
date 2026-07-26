import { RefreshCw, Wand2, Trash2, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { cn } from "@/utils/cn";
import { useWizard } from "../WizardContext";
import { StepShell } from "../components/StepShell";

/**
 * Step 4 — Generate Variants. Produces every color × size combination in one
 * click, applying SKU/barcode prefixes. Unwanted combinations can be removed
 * (soft-removed so they can be restored). Regenerating preserves details already
 * entered for combinations that still exist.
 */
export function VariantGeneratorStep() {
  const { state, dispatch, patchDefaults } = useWizard();
  const { sizes, colors } = state.attributes;
  const possible = sizes.length * colors.length;
  const active = state.variants.filter((v) => !v.removed);

  const generate = () => dispatch({ type: "REGENERATE_VARIANTS" });

  return (
    <StepShell
      title="Generate Variants"
      description="Automatically create every color × size combination. Remove any you don't stock."
    >
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
        <div className="w-40">
          <Input
            label="SKU prefix"
            value={state.defaults.skuPrefix}
            onChange={(e) => patchDefaults({ skuPrefix: e.target.value })}
            placeholder="e.g. BG"
          />
        </div>
        <div className="w-40">
          <Input
            label="Barcode prefix"
            value={state.defaults.barcodePrefix}
            onChange={(e) => patchDefaults({ barcodePrefix: e.target.value.replace(/\D/g, "").slice(0, 3) })}
            placeholder="200"
            hint="3-digit EAN prefix"
          />
        </div>
        <Button
          onClick={generate}
          leftIcon={state.variants.length ? <RefreshCw className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />}
          disabled={possible === 0}
        >
          {state.variants.length ? "Regenerate variants" : "Generate variants"}
        </Button>
        <span className="text-sm text-muted-foreground">
          {possible} possible · {active.length} active
        </span>
      </div>

      {state.variants.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          {possible === 0
            ? "Add sizes and colors in the previous step first."
            : "Click Generate to create all combinations."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {state.variants.map((v) => (
            <div
              key={v.id}
              className={cn(
                "flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors",
                v.removed ? "border-dashed border-border opacity-50" : "border-border bg-card"
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                {v.colorHex && (
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-border"
                    style={{ backgroundColor: v.colorHex }}
                  />
                )}
                <span className="truncate">
                  <span className="font-medium">{v.colorName}</span> / {v.sizeName}
                </span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">{v.sku}</span>
              </div>
              {v.removed ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => dispatch({ type: "RESTORE_VARIANT", id: v.id })}
                  aria-label="Restore"
                  title="Restore"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => dispatch({ type: "REMOVE_VARIANT", id: v.id })}
                  aria-label="Remove combination"
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </StepShell>
  );
}
