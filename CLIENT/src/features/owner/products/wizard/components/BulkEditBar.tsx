import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { X } from "lucide-react";
import { useSupplierOptions } from "../../hooks/useOwnerProducts";
import type { WizardVariant } from "../types";

/**
 * BulkEditBar — apply a value to every selected variant at once. Supports the
 * spec's bulk fields: price, cost, stock, supplier, SKU prefix, barcode prefix.
 * SKU/barcode prefix rewrites the code for each selected row (prefix-<oldtail>).
 */
export function BulkEditBar({
  selectedCount,
  onApply,
  onClear,
}: {
  selectedCount: number;
  onApply: (patch: Partial<WizardVariant>, prefixes: { sku?: string; barcode?: string }) => void;
  onClear: () => void;
}) {
  const { data: suppliers = [] } = useSupplierOptions();
  const [field, setField] = useState("sellingPrice");
  const [value, setValue] = useState("");

  const apply = () => {
    if (field === "skuPrefix") return onApply({}, { sku: value });
    if (field === "barcodePrefix") return onApply({}, { barcode: value });
    if (field === "supplierId") return onApply({ supplierId: value }, {});

    const num = value === "" ? 0 : Number(value);
    const patch: Partial<WizardVariant> = {};
    if (field === "sellingPrice") patch.sellingPrice = num;
    if (field === "costPrice") patch.costPrice = num;
    if (field === "mrp") patch.mrp = num;
    if (field === "openingStock") patch.openingStock = num;
    if (field === "reorderLevel") patch.reorderLevel = num;
    onApply(patch, {});
  };

  const isSupplier = field === "supplierId";

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <span className="mb-2 text-sm font-medium">{selectedCount} selected</span>
      <div className="w-44">
        <Select
          label="Bulk edit"
          value={field}
          onChange={(e) => {
            setField(e.target.value);
            setValue("");
          }}
          options={[
            { value: "sellingPrice", label: "Selling price" },
            { value: "costPrice", label: "Cost price" },
            { value: "mrp", label: "MRP" },
            { value: "openingStock", label: "Opening stock" },
            { value: "reorderLevel", label: "Reorder level" },
            { value: "supplierId", label: "Supplier" },
            { value: "skuPrefix", label: "SKU prefix" },
            { value: "barcodePrefix", label: "Barcode prefix" },
          ]}
        />
      </div>

      {isSupplier ? (
        <div className="w-52">
          <Select
            label="Value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            options={[
              { value: "", label: "— none —" },
              ...suppliers.map((s) => ({ value: s.id, label: s.businessName })),
            ]}
          />
        </div>
      ) : (
        <div className="w-40">
          <Input
            label="Value"
            type={field.includes("Prefix") ? "text" : "number"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={field.includes("Prefix") ? "e.g. BG" : "0"}
          />
        </div>
      )}

      <Button onClick={apply}>Apply to selected</Button>
      <Button variant="ghost" size="icon" onClick={onClear} aria-label="Clear selection">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
