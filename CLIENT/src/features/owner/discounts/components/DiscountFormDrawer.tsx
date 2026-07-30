import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Drawer, Input, SearchBox, Select } from "@/components/ui";
import { formatCurrency } from "@/utils/formatters";
import {
  useCategoryTargetOptions,
  useCreateCategoryDiscount,
  useCreateProductDiscount,
  useDiscountImpact,
  useProductOptions,
  useUpdateDiscount,
} from "../hooks/useDiscounts";
import type { DiscountRule, DiscountScope, DiscountType } from "../api/discountApi";

/**
 * Create / edit a discount rule.
 *
 * Two things the server enforces that this form mirrors so the owner learns them
 * before the round-trip:
 *  - scope and target are IMMUTABLE after creation (delete + recreate to
 *    retarget), which keeps the history trail honest;
 *  - percentages cap at 100; flat amounts don't (they're clamped to MRP at price
 *    time by the engine).
 *
 * Dates are sent as bare "YYYY-MM-DD". The server widens them to the whole day
 * in STORE time — so a client timezone conversion here would be actively wrong.
 */

interface FormState {
  name: string;
  description: string;
  scope: DiscountScope;
  productId: string;
  productName: string;
  categoryId: string;
  type: DiscountType;
  value: string;
  priority: string;
  startDate: string;
  endDate: string;
  isEnabled: boolean;
}

const EMPTY: FormState = {
  name: "",
  description: "",
  scope: "PRODUCT",
  productId: "",
  productName: "",
  categoryId: "",
  type: "PERCENTAGE",
  value: "",
  priority: "0",
  startDate: "",
  endDate: "",
  isEnabled: true,
};

/** Strip the server's ISO instant back to the date the owner picked. */
function toDateInput(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : "";
}

export function DiscountFormDrawer({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: DiscountRule | null;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [productSearch, setProductSearch] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const isEdit = !!editing;

  const createProduct = useCreateProductDiscount();
  const createCategory = useCreateCategoryDiscount();
  const updateRule = useUpdateDiscount();
  const saving = createProduct.isPending || createCategory.isPending || updateRule.isPending;

  const { data: categories = [] } = useCategoryTargetOptions();
  const { data: productResults = [], isFetching: searchingProducts } = useProductOptions(productSearch);

  // Live "this affects N variants" — only meaningful once a target is chosen.
  const impactTarget = useMemo(
    () =>
      form.scope === "PRODUCT"
        ? { scope: "PRODUCT" as const, productId: form.productId }
        : { scope: "CATEGORY" as const, categoryId: form.categoryId },
    [form.scope, form.productId, form.categoryId]
  );
  const { data: impact, isFetching: loadingImpact } = useDiscountImpact(impactTarget);

  // Reset from the editing target every time the drawer opens.
  useEffect(() => {
    if (!open) return;
    setErrors([]);
    setProductSearch("");
    if (editing) {
      setForm({
        name: editing.name,
        description: editing.description ?? "",
        scope: editing.scope,
        productId: editing.scope === "PRODUCT" ? editing.target?.id ?? "" : "",
        productName: editing.scope === "PRODUCT" ? editing.target?.name ?? "" : "",
        categoryId: editing.scope === "CATEGORY" ? editing.target?.id ?? "" : "",
        type: editing.type,
        value: String(editing.value),
        priority: String(editing.priority),
        startDate: toDateInput(editing.startDate),
        endDate: toDateInput(editing.endDate),
        isEnabled: editing.isEnabled,
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, editing]);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  function validate(): string[] {
    const errs: string[] = [];
    const value = Number(form.value);
    const priority = Number(form.priority);

    if (form.name.trim().length < 2) errs.push("Name must be at least 2 characters.");
    if (form.name.trim().length > 120) errs.push("Name must be at most 120 characters.");
    if (form.description.length > 500) errs.push("Description must be at most 500 characters.");
    if (!form.value.trim() || Number.isNaN(value)) errs.push("Enter a discount value.");
    else if (value < 0) errs.push("Discount cannot be negative.");
    else if (form.type === "PERCENTAGE" && value > 100)
      errs.push("A percentage discount cannot exceed 100%.");
    if (Number.isNaN(priority) || !Number.isInteger(priority) || priority < 0 || priority > 1000)
      errs.push("Priority must be a whole number between 0 and 1000.");
    if (!isEdit) {
      if (form.scope === "PRODUCT" && !form.productId) errs.push("Select a product to discount.");
      if (form.scope === "CATEGORY" && !form.categoryId) errs.push("Select a category to discount.");
    }
    if (form.startDate && form.endDate && form.endDate < form.startDate)
      errs.push("End date must be on or after the start date.");

    return errs;
  }

  const handleSubmit = () => {
    const errs = validate();
    setErrors(errs);
    if (errs.length) {
      toast.error(errs[0] as string);
      return;
    }

    const base = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      type: form.type,
      value: Number(form.value),
      priority: Number(form.priority),
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      isEnabled: form.isEnabled,
    };

    const onSuccess = (rule: DiscountRule) => {
      const n = rule.affectedVariants;
      toast.success(
        isEdit
          ? `Discount updated${n != null ? ` — ${n} variant(s) re-priced.` : "."}`
          : `Discount created${n != null ? ` — ${n} variant(s) re-priced.` : "."}`
      );
      onClose();
    };
    const onError = (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to save discount.");

    if (isEdit && editing) {
      // scope/target are immutable server-side, so they are never sent here.
      updateRule.mutate({ id: editing.id, input: base }, { onSuccess, onError });
    } else if (form.scope === "PRODUCT") {
      createProduct.mutate({ ...base, productId: form.productId }, { onSuccess, onError });
    } else {
      createCategory.mutate({ ...base, categoryId: form.categoryId }, { onSuccess, onError });
    }
  };

  const targetChosen = form.scope === "PRODUCT" ? !!form.productId : !!form.categoryId;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit discount" : "New discount"}
      description={
        isEdit
          ? "Scope and target are fixed — delete and recreate the rule to retarget it."
          : "Catalog discount — sets the shelf price. Cart-level promotions are configured separately."
      }
      width="w-full max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={saving}>
            {isEdit ? "Save changes" : "Create discount"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {errors.length > 0 && (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-4 w-4" /> Fix the following
            </div>
            <ul className="list-inside list-disc space-y-0.5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        <Input
          label="Rule name"
          placeholder="e.g. Winter Clearance"
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          maxLength={120}
        />

        <Input
          label="Description (optional)"
          placeholder="What this rule is for"
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
          maxLength={500}
        />

        {/* ── Target ───────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Applies to
          </div>

          <Select
            label="Scope"
            options={[
              { value: "PRODUCT", label: "A single product" },
              { value: "CATEGORY", label: "An entire category" },
            ]}
            value={form.scope}
            disabled={isEdit}
            onChange={(e) =>
              set({ scope: e.target.value as DiscountScope, productId: "", categoryId: "", productName: "" })
            }
          />

          {form.scope === "PRODUCT" ? (
            isEdit ? (
              <Input label="Product" value={form.productName || "—"} disabled readOnly />
            ) : (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Product</label>
                {form.productId ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                    <span className="truncate">{form.productName}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => set({ productId: "", productName: "" })}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <>
                    <SearchBox
                      value={productSearch}
                      onChange={setProductSearch}
                      loading={searchingProducts}
                      placeholder="Search products by name…"
                    />
                    {productSearch.trim().length >= 2 && (
                      <div className="max-h-44 overflow-y-auto rounded-md border border-border">
                        {productResults.length === 0 && !searchingProducts ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">
                            No products match “{productSearch}”.
                          </div>
                        ) : (
                          productResults.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                set({ productId: p.id, productName: p.name });
                                setProductSearch("");
                              }}
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                            >
                              {p.name}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          ) : (
            <Select
              label="Category"
              placeholder="Select a category"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              value={form.categoryId}
              disabled={isEdit}
              onChange={(e) => set({ categoryId: e.target.value })}
            />
          )}

          {targetChosen && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {loadingImpact ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculating impact…
                </>
              ) : impact ? (
                <>
                  <Info className="h-3.5 w-3.5" />
                  This rule covers <strong className="text-foreground">{impact.affectedVariants}</strong>{" "}
                  variant(s).
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* ── Amount ───────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Type"
            options={[
              { value: "PERCENTAGE", label: "Percentage (%)" },
              { value: "FLAT", label: "Flat amount" },
            ]}
            value={form.type}
            onChange={(e) => set({ type: e.target.value as DiscountType })}
          />
          <Input
            label={form.type === "PERCENTAGE" ? "Value (%)" : "Value (₹)"}
            type="number"
            min={0}
            {...(form.type === "PERCENTAGE" ? { max: 100 } : {})}
            step="0.01"
            value={form.value}
            onChange={(e) => set({ value: e.target.value })}
            hint={
              form.type === "FLAT" && Number(form.value) > 0
                ? `${formatCurrency(Number(form.value))} off MRP`
                : undefined
            }
          />
        </div>

        <Input
          label="Priority"
          type="number"
          min={0}
          max={1000}
          step="1"
          value={form.priority}
          onChange={(e) => set({ priority: e.target.value })}
          hint="Higher wins when several rules apply. Product rules already beat category rules."
        />

        {/* ── Window ───────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Starts (optional)"
            type="date"
            value={form.startDate}
            onChange={(e) => set({ startDate: e.target.value })}
          />
          <Input
            label="Ends (optional)"
            type="date"
            value={form.endDate}
            onChange={(e) => set({ endDate: e.target.value })}
          />
        </div>
        <p className="-mt-3 text-xs text-muted-foreground">
          Dates are read in store time — an end date covers that whole day. Leave both blank to run
          until disabled.
        </p>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isEnabled}
            onChange={(e) => set({ isEnabled: e.target.checked })}
            className="h-4 w-4 rounded border-input accent-primary"
          />
          Enabled
        </label>
      </div>
    </Drawer>
  );
}
