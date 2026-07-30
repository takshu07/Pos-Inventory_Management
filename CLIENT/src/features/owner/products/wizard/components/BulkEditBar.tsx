import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { X } from "lucide-react";
import { useSupplierOptions } from "../../hooks/useOwnerProducts";
import type { WizardVariant } from "../types";

/**
 * BulkEditBar — apply a value to every selected variant at once: stock, reorder
 * level, supplier, SKU prefix, barcode prefix. SKU/barcode prefix rewrites the
 * code for each selected row (prefix-<oldtail>).
 *
 * Deliberately offers NO price fields. Pricing comes from the product-level
 * Pricing step and is inherited; a deliberate single-variant deviation goes
 * through the Override Pricing dialog, so bulk price editing would reintroduce
 * exactly the duplication this wizard removes.
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
  const [field, setField] = useState("openingStock");
  const [value, setValue] = useState("");

  const apply = () => {
    if (field === "skuPrefix") return onApply({}, { sku: value });
    if (field === "barcodePrefix") return onApply({}, { barcode: value });
    if (field === "supplierId") return onApply({ supplierId: value }, {});
    if (field === "status")
      return onApply({ status: value as WizardVariant["status"] }, {});

    const num = value === "" ? 0 : Number(value);
    const patch: Partial<WizardVariant> = {};
    if (field === "openingStock") patch.openingStock = num;
    if (field === "reorderLevel") patch.reorderLevel = num;
    if (field === "maximumStock") patch.maximumStock = num;
    onApply(patch, {});
  };

  const isSupplier = field === "supplierId";
  const isStatus = field === "status";

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
            { value: "openingStock", label: "Opening stock" },
            { value: "reorderLevel", label: "Reorder level" },
            { value: "maximumStock", label: "Maximum stock" },
            { value: "status", label: "Status" },
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
      ) : isStatus ? (
        <div className="w-40">
          <Select
            label="Value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "INACTIVE", label: "Inactive" },
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
