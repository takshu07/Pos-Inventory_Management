import { useState } from "react";
import { Plus, Tag } from "lucide-react";
import { Badge, Button, Input, Select } from "@/components/ui";
import { formatCurrency } from "@/utils/formatters";
import { useAssignCategoryDiscount, useCategoryDiscounts } from "../../useCategories";
import { CategoryDetailSkeleton } from "../CategorySkeleton";
import type { CategoryDiscount } from "../../types";

/**
 * CategoryDiscountTab — discounts targeting this category (Phase 2).
 *
 * The form here only chooses the TARGET and the terms; creation is handled by
 * the server's discount rule service, which owns rule validation, history and
 * the variant price recompute. No pricing arithmetic is performed on the client
 * — a discount shown here and the price charged at checkout resolve from the
 * same engine, so they cannot disagree.
 *
 * Status is DERIVED server-side from (isEnabled, startDate, endDate), never
 * stored, so a scheduled discount becomes ACTIVE on the clock with no cron job.
 */

const STATUS_VARIANT: Record<
  CategoryDiscount["status"],
  "success" | "info" | "secondary" | "warning"
> = {
  ACTIVE: "success",
  SCHEDULED: "info",
  EXPIRED: "secondary",
  DISABLED: "warning",
};

export function CategoryDiscountTab({
  categoryId,
  categoryName,
}: {
  categoryId: string;
  categoryName: string;
}) {
  const { data: discounts, isPending, isError, error } = useCategoryDiscounts(categoryId);
  const assign = useAssignCategoryDiscount();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    type: "PERCENTAGE" as "PERCENTAGE" | "FLAT",
    value: "",
    startDate: "",
    endDate: "",
  });
  const [formError, setFormError] = useState<string | null>(null);

  const value = Number(form.value);
  const isValid =
    form.name.trim().length >= 2 &&
    Number.isFinite(value) &&
    value > 0 &&
    (form.type !== "PERCENTAGE" || value <= 100) &&
    (!form.startDate || !form.endDate || new Date(form.endDate) > new Date(form.startDate));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setFormError(null);

    assign.mutate(
      {
        id: categoryId,
        input: {
          name: form.name.trim(),
          type: form.type,
          value,
          ...(form.startDate ? { startDate: new Date(form.startDate).toISOString() } : {}),
          ...(form.endDate ? { endDate: new Date(form.endDate).toISOString() } : {}),
        },
      },
      {
        onSuccess: () => {
          setShowForm(false);
          setForm({ name: "", type: "PERCENTAGE", value: "", startDate: "", endDate: "" });
        },
        onError: (err) =>
          setFormError(err instanceof Error ? err.message : "Could not assign the discount."),
      }
    );
  };

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—";

  if (isPending) return <CategoryDetailSkeleton />;

  if (isError) {
    return (
      <p className="py-8 text-center text-sm text-destructive">
        {error instanceof Error ? error.message : "Could not load discounts."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Discounts applied to every product in {categoryName}.
        </p>
        {!showForm && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Assign discount
          </Button>
        )}
      </div>

      {showForm && (
        <form onSubmit={submit} className="space-y-3 rounded-lg border border-border p-4">
          {formError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
              {formError}
            </p>
          )}

          <Input
            label="Discount name"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Summer Sale"
          />

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Type"
              value={form.type}
              onChange={(e) =>
                setForm((f) => ({ ...f, type: e.target.value as "PERCENTAGE" | "FLAT" }))
              }
              options={[
                { value: "PERCENTAGE", label: "Percentage (%)" },
                { value: "FLAT", label: "Flat amount (₹)" },
              ]}
            />
            <Input
              label={form.type === "PERCENTAGE" ? "Percentage off" : "Amount off"}
              required
              type="number"
              min="0"
              step="0.01"
              {...(form.type === "PERCENTAGE" ? { max: "100" } : {})}
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium leading-none">Starts (optional)</label>
              <input
                type="datetime-local"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium leading-none">Ends (optional)</label>
              <input
                type="datetime-local"
                value={form.endDate}
                min={form.startDate || undefined}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Leave the dates empty to apply the discount immediately and indefinitely.
          </p>

          <div className="flex gap-2 pt-1">
            <Button type="submit" size="sm" disabled={!isValid || assign.isPending}>
              {assign.isPending ? "Assigning…" : "Assign discount"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setShowForm(false);
                setFormError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {discounts && discounts.length > 0 ? (
        <div className="space-y-2">
          {discounts.map((d) => (
            <div key={d.id} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{d.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Source: Category · Priority {d.priority}
                  </div>
                </div>
                <Badge variant={STATUS_VARIANT[d.status]}>{d.status}</Badge>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <Meta label="Discount">
                  <span className="font-medium text-foreground">
                    {d.type === "PERCENTAGE" ? `${d.value}%` : formatCurrency(d.value)}
                  </span>
                </Meta>
                <Meta label="Starts">{fmtDate(d.startDate)}</Meta>
                <Meta label="Ends">{fmtDate(d.endDate)}</Meta>
              </div>
            </div>
          ))}
        </div>
      ) : (
        !showForm && (
          <div className="flex flex-col items-center py-10 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Tag className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No discounts assigned</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Assigning a discount here applies it to every product in this category.
            </p>
          </div>
        )
      )}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
