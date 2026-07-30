import { Pencil } from "lucide-react";
import { Button } from "@/components/ui";
import type { CategoryRow } from "../../types";
import { CategoryStatusBadge } from "../CategoryStatusBadge";

/**
 * CategoryOverviewTab — the category's own attributes and audit trail.
 *
 * Pure presentation over data the drawer already holds, so opening the drawer
 * costs no extra request. Edit is offered only when the caller passes a handler
 * (owner); a manager simply never receives one.
 */
export function CategoryOverviewTab({
  category: c,
  onEdit,
}: {
  category: CategoryRow;
  onEdit?: () => void;
}) {
  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
      : "—";

  return (
    <div className="space-y-6">
      {onEdit && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit category
          </Button>
        </div>
      )}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        <Field label="Name">
          <span className="font-medium">{c.name}</span>
        </Field>

        <Field label="Status">
          <CategoryStatusBadge status={c.status} />
        </Field>

        <Field label="Description" full>
          <span className={c.description ? "" : "text-muted-foreground"}>
            {c.description || "No description"}
          </span>
        </Field>

        <Field label="Search keywords" full>
          {c.searchKeywords ? (
            <div className="flex flex-wrap gap-1.5">
              {c.searchKeywords.split(",").map((k) => {
                const keyword = k.trim();
                return keyword ? (
                  <span
                    key={keyword}
                    className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs"
                  >
                    {keyword}
                  </span>
                ) : null;
              })}
            </div>
          ) : (
            <span className="text-muted-foreground">No keywords</span>
          )}
        </Field>

        <Field label="Products">
          <span className="text-lg font-semibold tabular-nums">{c.productCount}</span>
          <span className="ml-1 text-sm text-muted-foreground">
            {c.productCount === 1 ? "Product" : "Products"}
          </span>
        </Field>

        <Field label="Display order">
          <span className="tabular-nums">{c.displayOrder}</span>
        </Field>

        <Field label="Created by">{c.createdBy?.name ?? "—"}</Field>
        <Field label="Created on">{fmt(c.createdAt)}</Field>

        <Field label="Last updated by">{c.updatedBy?.name ?? "—"}</Field>
        <Field label="Last updated">{fmt(c.updatedAt)}</Field>

        {c.archivedAt && <Field label="Archived on">{fmt(c.archivedAt)}</Field>}
      </dl>
    </div>
  );
}

function Field({
  label,
  children,
  full = false,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <dt className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}
