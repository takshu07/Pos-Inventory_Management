import { useEffect, useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import type { ProductDetail } from "@/shared/product";
import {
  useBrandOptions,
  useCategoryOptions,
  useCreateOwnerProduct,
  useUpdateOwnerProduct,
} from "../hooks/useOwnerProducts";
import type { ProductWriteInput } from "../api/ownerProductApi";

/**
 * OwnerProductFormDrawer — create/edit a product's core fields. Variants (with
 * SKU/barcode/pricing) are managed in the existing variant module; this drawer
 * covers product-level attributes. Owner-only by construction: it lives in the
 * owner feature and every mutation hits an OWNER-gated endpoint.
 */

interface FormState {
  name: string;
  description: string;
  categoryId: string;
  brandId: string;
  searchKeywords: string;
  imageUrls: string;
  isActive: boolean;
}

const emptyForm: FormState = {
  name: "",
  description: "",
  categoryId: "",
  brandId: "",
  searchKeywords: "",
  imageUrls: "",
  isActive: true,
};

function toForm(p: ProductDetail): FormState {
  return {
    name: p.name,
    description: p.description ?? "",
    categoryId: p.category?.id ?? "",
    brandId: p.brand?.id ?? "",
    searchKeywords: "",
    imageUrls: p.imageUrls.join(", "),
    isActive: p.isActive,
  };
}

export function OwnerProductFormDrawer({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: ProductDetail | null;
}) {
  const isEdit = !!editing;
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const { data: categories = [] } = useCategoryOptions();
  const { data: brands = [] } = useBrandOptions();
  const createMut = useCreateOwnerProduct();
  const updateMut = useUpdateOwnerProduct();
  const saving = createMut.isPending || updateMut.isPending;

  useEffect(() => {
    if (open) {
      setForm(editing ? toForm(editing) : emptyForm);
      setError(null);
    }
  }, [open, editing]);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    setError(null);
    if (form.name.trim().length < 3) {
      setError("Product name must be at least 3 characters.");
      return;
    }
    if (!form.categoryId) {
      setError("Please select a category.");
      return;
    }

    const imageUrls = form.imageUrls
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const payload: ProductWriteInput = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      categoryId: form.categoryId,
      brandId: form.brandId || null,
      imageUrls,
      ...(form.searchKeywords.trim() && { searchKeywords: form.searchKeywords.trim() }),
      ...(isEdit && { isActive: form.isActive }),
    };

    try {
      if (isEdit && editing) {
        await updateMut.mutateAsync({ id: editing.id, input: payload });
      } else {
        await createMut.mutateAsync(payload);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save product.");
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit product" : "New product"}
      description={isEdit ? editing?.name : "Add a product to the catalog"}
      width="w-full max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            {isEdit ? "Save changes" : "Create product"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="e.g. Classic Cotton T-Shirt"
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium leading-none">Description</label>
          <textarea
            className="min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Optional product description"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Category"
            required
            placeholder="Select category"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            value={form.categoryId}
            onChange={(e) => set({ categoryId: e.target.value })}
          />
          <Select
            label="Brand"
            placeholder="No brand"
            options={[{ value: "", label: "No brand" }, ...brands.map((b) => ({ value: b.id, label: b.name }))]}
            value={form.brandId}
            onChange={(e) => set({ brandId: e.target.value })}
          />
        </div>

        <Input
          label="Search keywords"
          hint="Comma-separated synonyms to help cashier search."
          value={form.searchKeywords}
          onChange={(e) => set({ searchKeywords: e.target.value })}
          placeholder="polo, collar tee, cotton"
        />

        <Input
          label="Image URLs"
          hint="Comma-separated. Up to 5 image URLs."
          value={form.imageUrls}
          onChange={(e) => set({ imageUrls: e.target.value })}
          placeholder="https://…/front.jpg, https://…/back.jpg"
        />

        {isEdit && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => set({ isActive: e.target.checked })}
              className="h-4 w-4 rounded border-input"
            />
            Active (unchecking archives the product)
          </label>
        )}

        <p className="text-xs text-muted-foreground">
          Variants (SKU, barcode, size/color, cost & selling price, stock) are managed from the
          product's Variants tab and the Inventory module.
        </p>
      </div>
    </Drawer>
  );
}
