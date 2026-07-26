import { useState, useRef, useEffect } from "react";
import {
  MoreHorizontal,
  Eye,
  Pencil,
  Copy,
  Archive,
  ArchiveRestore,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/utils/cn";
import type { ProductRow } from "@/shared/product";
import {
  useArchiveOwnerProduct,
  useDeleteOwnerProduct,
  useDuplicateOwnerProduct,
  useRestoreOwnerProduct,
} from "../hooks/useOwnerProducts";

/**
 * OwnerProductRowActions — the per-row action menu for the owner table. Injected
 * into the shared ProductTable via its `renderActions` slot, so the shared table
 * stays permission-agnostic. Destructive actions confirm before firing.
 */
export function OwnerProductRowActions({
  product,
  onView,
  onEdit,
}: {
  product: ProductRow;
  onView: (p: ProductRow) => void;
  onEdit: (p: ProductRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const archiveMut = useArchiveOwnerProduct();
  const restoreMut = useRestoreOwnerProduct();
  const duplicateMut = useDuplicateOwnerProduct();
  const deleteMut = useDeleteOwnerProduct();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const close = () => setOpen(false);

  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  const confirmDelete = () => {
    if (
      window.confirm(
        `Delete "${product.name}"? This cannot be undone. Products with variants cannot be deleted — archive instead.`
      )
    ) {
      deleteMut.mutate(product.id);
    }
  };

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((o) => !o)}
        aria-label="Row actions"
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          <MenuItem icon={Eye} label="View details" onClick={run(() => onView(product))} />
          <MenuItem icon={Pencil} label="Edit" onClick={run(() => onEdit(product))} />
          <MenuItem
            icon={Copy}
            label="Duplicate"
            onClick={run(() => duplicateMut.mutate(product.id))}
          />
          {product.isActive ? (
            <MenuItem
              icon={Archive}
              label="Archive"
              onClick={run(() => archiveMut.mutate(product.id))}
            />
          ) : (
            <MenuItem
              icon={ArchiveRestore}
              label="Restore"
              onClick={run(() => restoreMut.mutate(product.id))}
            />
          )}
          <div className="border-t border-border" />
          <MenuItem icon={Trash2} label="Delete" destructive onClick={run(confirmDelete)} />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent",
        destructive && "text-destructive hover:bg-destructive/10"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
