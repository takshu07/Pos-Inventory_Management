import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, PackageX } from "lucide-react";
import { Button, Modal, Select } from "@/components/ui";
import { useAuthStore } from "@/store/auth.store";
import { useCategoryOptions } from "../useCategories";
import type { CategoryRow } from "../types";

/**
 * CategoryDeleteDialog — SAFE DELETE.
 *
 * A category holding products is never deleted outright. Products are the
 * source of truth for catalog data, and Product.categoryId is a non-nullable
 * FK — deleting the parent would either orphan them or cascade them away.
 * Neither is acceptable, so the flow is:
 *
 *      "This category contains products."
 *          → Move products → Select new category → Delete
 *
 * The move and the delete run in ONE server transaction, so products can never
 * be left half-migrated with the source category still present.
 *
 * Empty categories skip straight to a plain confirmation.
 */
export function CategoryDeleteDialog({
  category,
  open,
  onClose,
  onConfirm,
  submitting = false,
  error,
}: {
  category: CategoryRow | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (reassignToId?: string) => void;
  submitting?: boolean;
  error?: string | null;
}) {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const [destination, setDestination] = useState("");

  // Only load destinations when they are actually needed.
  const needsReassign = (category?.productCount ?? 0) > 0;
  const { data: options, isPending: loadingOptions } = useCategoryOptions(
    role,
    category?.id,
    open && needsReassign
  );

  useEffect(() => {
    if (open) setDestination("");
  }, [open, category?.id]);

  if (!category) return null;

  const count = category.productCount;
  const canConfirm = !needsReassign || !!destination;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={needsReassign ? "This category contains products" : "Delete category"}
      size="md"
      footer={
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canConfirm || submitting}
            onClick={() => onConfirm(needsReassign ? destination : undefined)}
            className="flex-1"
          >
            {submitting
              ? "Deleting…"
              : needsReassign
                ? `Move ${count} & delete`
                : "Delete category"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {needsReassign ? (
          <>
            <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
              <PackageX className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="text-sm">
                <p className="font-medium text-foreground">
                  {count} {count === 1 ? "product is" : "products are"} still in “{category.name}”.
                </p>
                <p className="mt-1 text-muted-foreground">
                  Products are never deleted with a category. Choose where they should
                  go — they will be moved first, then the category is removed.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-md border border-border p-3 text-sm">
              <span className="truncate font-medium">{category.name}</span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <Select
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder={loadingOptions ? "Loading…" : "Select a destination"}
                  options={(options ?? []).map((o) => ({
                    value: o.id,
                    label: `${o.name} (${o.productCount})`,
                  }))}
                />
              </div>
            </div>

            {!loadingOptions && (options?.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">
                There is no other active category to move these products into. Create
                one first, then delete this category.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Delete <span className="font-medium text-foreground">“{category.name}”</span>?
            It has no products attached. This cannot be undone — consider archiving
            instead if you may need it later.
          </p>
        )}
      </div>
    </Modal>
  );
}
