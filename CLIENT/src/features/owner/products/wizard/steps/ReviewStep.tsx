import { formatCurrency } from "@/utils/formatters";
import { useWizard } from "../WizardContext";
import { StepShell } from "../components/StepShell";
import { ValidationPanel } from "../components/ValidationPanel";
import { collectIssues } from "../validation";
import { calcTotals, effectivePricing, productPricing } from "../helpers";
import { useCategoryOptions, useBrandOptions } from "../../hooks/useOwnerProducts";

/**
 * Step 9 — Review. Complete summary + the aggregated validation panel (errors
 * block the final Create; warnings are informational). Everything the owner is
 * about to commit is shown here before the single transactional create.
 */
export function ReviewStep() {
  const { state } = useWizard();
  const issues = collectIssues(state);
  const totals = calcTotals(state.variants, state.pricing);
  const base = productPricing(state.pricing);
  const { data: categories = [] } = useCategoryOptions();
  const { data: brands = [] } = useBrandOptions();

  const categoryName = categories.find((c) => c.id === state.categoryId)?.name ?? "—";
  const brandName = brands.find((b) => b.id === state.brandId)?.name ?? "—";
  const variants = state.variants.filter((v) => !v.removed);

  return (
    <StepShell title="Review & Create" description="Confirm everything before creating the product.">
      <ValidationPanel issues={issues} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="Basic Information">
          <Row label="Name" value={state.name || "—"} />
          <Row label="Category" value={categoryName} />
          <Row label="Brand" value={brandName} />
          <Row label="Status" value={state.status} />
          {state.gender && <Row label="Gender" value={state.gender} />}
          {state.fabricMaterial && <Row label="Fabric" value={state.fabricMaterial} />}
          {state.hsnCode && <Row label="HSN" value={state.hsnCode} />}
        </Panel>

        <Panel title="Pricing (applies to all variants)">
          <Row label="Cost price" value={formatCurrency(base.costPrice)} />
          <Row label="MRP" value={formatCurrency(base.mrp)} />
          <Row
            label="Base discount"
            value={
              state.pricing.isManualPricing
                ? "Manual price"
                : state.pricing.defaultDiscountValue === "" ||
                    Number(state.pricing.defaultDiscountValue) === 0
                  ? "None"
                  : state.pricing.defaultDiscountType === "PERCENTAGE"
                    ? `${state.pricing.defaultDiscountValue}% off MRP`
                    : `${formatCurrency(Number(state.pricing.defaultDiscountValue))} off MRP`
            }
          />
          <Row label="Selling price" value={formatCurrency(base.sellingPrice)} />
          <Row
            label="GST"
            value={state.pricing.gstRate !== "" ? `${state.pricing.gstRate}%` : "—"}
          />
          <Row
            label="Cashier discount"
            value={
              state.pricing.discountAllowed
                ? state.pricing.maxDiscountPct !== ""
                  ? `Allowed · max ${state.pricing.maxDiscountPct}%`
                  : "Allowed"
                : "Not allowed"
            }
          />
          <Row
            label="Price overrides"
            value={
              totals.overrideCount > 0
                ? `${totals.overrideCount} variant${totals.overrideCount === 1 ? "" : "s"}`
                : "None — all inherit"
            }
          />
        </Panel>

        <Panel title="Totals">
          <Row label="Images" value={String(state.images.length)} />
          <Row label="Variants" value={String(totals.variantCount)} />
          <Row label="Total opening units" value={String(totals.totalUnits)} />
          <Row label="Inventory value (cost)" value={formatCurrency(totals.totalStockValue)} />
          <Row label="Retail value" value={formatCurrency(totals.totalRetailValue)} />
          <Row label="Projected profit" value={formatCurrency(totals.projectedProfit)} />
          <Row
            label="Estimated avg. margin"
            value={totals.avgMarginPct != null ? `${totals.avgMarginPct.toFixed(1)}%` : "—"}
          />
        </Panel>
      </div>

      <Panel title={`Variants (${variants.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1 text-left">Variant</th>
                <th className="py-1 text-left">SKU</th>
                <th className="py-1 text-left">Barcode</th>
                <th className="py-1 text-right">Selling</th>
                <th className="py-1 text-right">Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {variants.map((v) => {
                const eff = effectivePricing(v, state.pricing);
                return (
                  <tr key={v.id}>
                    <td className="py-1.5">
                      <span className="font-medium">{v.colorName}</span> / {v.sizeName}
                    </td>
                    <td className="py-1.5 font-mono text-xs">{v.sku}</td>
                    <td className="py-1.5 font-mono text-xs">{v.barcode || "—"}</td>
                    <td className="py-1.5 text-right">
                      {formatCurrency(eff.sellingPrice)}
                      {eff.isOverride && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          override
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">{v.openingStock}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </StepShell>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
