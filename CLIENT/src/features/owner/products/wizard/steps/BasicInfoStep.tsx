import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useWizard } from "../WizardContext";
import { StepShell, FieldGroup } from "../components/StepShell";
import { useCategoryOptions, useBrandOptions } from "../../hooks/useOwnerProducts";
import type { ProductStatus } from "../types";

/**
 * Step 1 — Basic Information. Core identity plus clothing-retail attributes
 * (gender, season, fabric, sleeve, neck, fit, pattern, occasion, collection) and
 * tax (HSN/GST). These persist on the Product; variants differ only by size/color.
 */

const opts = (values: string[]) => [
  { value: "", label: "—" },
  ...values.map((v) => ({ value: v, label: v })),
];

const GENDERS = ["Men", "Women", "Unisex", "Boys", "Girls"];
const SEASONS = ["Spring", "Summer", "Autumn", "Winter", "All Season"];
const FABRICS = ["Cotton", "Polyester", "Linen", "Denim", "Wool", "Silk", "Rayon", "Blend"];
const SLEEVES = ["Full Sleeve", "Half Sleeve", "Sleeveless", "Three-Quarter", "Cap Sleeve"];
const NECKS = ["Round Neck", "V-Neck", "Collar", "Polo", "Turtle Neck", "Boat Neck"];
const FITS = ["Slim", "Regular", "Relaxed", "Oversized", "Skinny"];
const PATTERNS = ["Solid", "Printed", "Striped", "Checked", "Floral", "Graphic"];
const OCCASIONS = ["Casual", "Formal", "Party", "Sports", "Ethnic", "Lounge"];
const STATUSES: { value: ProductStatus; label: string }[] = [
  { value: "ACTIVE", label: "Active (sellable immediately)" },
  { value: "DRAFT", label: "Draft (not sellable yet)" },
  { value: "INACTIVE", label: "Inactive (hidden)" },
];

export function BasicInfoStep() {
  const { state, patch } = useWizard();
  const { data: categories = [] } = useCategoryOptions();
  const { data: brands = [] } = useBrandOptions();

  return (
    <StepShell title="Basic Information" description="Identify the product and its clothing attributes.">
      <FieldGroup title="Identity">
        <div className="sm:col-span-2">
          <Input
            label="Product Name"
            required
            value={state.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="e.g. Classic Cotton Crew-Neck T-Shirt"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium">Description</label>
          <textarea
            className="min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={state.description}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="Product description shown to staff and on labels."
          />
        </div>
        <Select
          label="Category"
          required
          placeholder="Select category"
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          value={state.categoryId}
          onChange={(e) => patch({ categoryId: e.target.value })}
        />
        <Select
          label="Brand"
          placeholder="No brand"
          options={[{ value: "", label: "No brand" }, ...brands.map((b) => ({ value: b.id, label: b.name }))]}
          value={state.brandId}
          onChange={(e) => patch({ brandId: e.target.value })}
        />
      </FieldGroup>

      <FieldGroup title="Clothing attributes" columns={3}>
        <Select label="Gender" options={opts(GENDERS)} value={state.gender} onChange={(e) => patch({ gender: e.target.value })} />
        <Select label="Season" options={opts(SEASONS)} value={state.season} onChange={(e) => patch({ season: e.target.value })} />
        <Input label="Collection" value={state.collectionName} onChange={(e) => patch({ collectionName: e.target.value })} placeholder="e.g. Summer '26" />
        <Select label="Fabric Material" options={opts(FABRICS)} value={state.fabricMaterial} onChange={(e) => patch({ fabricMaterial: e.target.value })} />
        <Select label="Sleeve Type" options={opts(SLEEVES)} value={state.sleeveType} onChange={(e) => patch({ sleeveType: e.target.value })} />
        <Select label="Neck Type" options={opts(NECKS)} value={state.neckType} onChange={(e) => patch({ neckType: e.target.value })} />
        <Select label="Fit" options={opts(FITS)} value={state.fit} onChange={(e) => patch({ fit: e.target.value })} />
        <Select label="Pattern" options={opts(PATTERNS)} value={state.pattern} onChange={(e) => patch({ pattern: e.target.value })} />
        <Select label="Occasion" options={opts(OCCASIONS)} value={state.occasion} onChange={(e) => patch({ occasion: e.target.value })} />
      </FieldGroup>

      <FieldGroup title="Tax & discovery" columns={3}>
        <Input label="HSN Code" value={state.hsnCode} onChange={(e) => patch({ hsnCode: e.target.value })} placeholder="Optional" />
        <Input
          label="GST %"
          type="number"
          min={0}
          max={100}
          value={state.gstRate}
          onChange={(e) => patch({ gstRate: e.target.value === "" ? "" : Number(e.target.value) })}
          placeholder="Optional"
        />
        <Select
          label="Status"
          options={STATUSES}
          value={state.status}
          onChange={(e) => patch({ status: e.target.value as ProductStatus })}
        />
        <div className="sm:col-span-3">
          <Input
            label="Search Keywords"
            hint="Comma-separated synonyms to help cashier search."
            value={state.searchKeywords}
            onChange={(e) => patch({ searchKeywords: e.target.value })}
            placeholder="polo, collar tee, cotton"
          />
        </div>
      </FieldGroup>
    </StepShell>
  );
}
