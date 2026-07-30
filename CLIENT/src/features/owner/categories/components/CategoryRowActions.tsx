import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  Tag,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/utils/cn";
import type { CategoryRow } from "@/shared/category";

/**
 * CategoryRowActions — the owner's per-row action menu.
 *
 * Lives in the OWNER feature, not in shared/category: these are write actions,
 * and keeping them out of the shared layer means the manager module has no
 * import path to them at all. The shared table takes them through its
 * `renderActions` slot and stays permission-agnostic.
 */
export function CategoryRowActions({
  category,
  onEdit,
  onArchive,
  onActivate,
  onDelete,
  onAssignDiscount,
}: {
  category: CategoryRow;
  onEdit: (c: CategoryRow) => void;
  onArchive: (c: CategoryRow) => void;
  onActivate: (c: CategoryRow) => void;
  onDelete: (c: CategoryRow) => void;
  onAssignDiscount: (c: CategoryRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape — a menu that traps focus in a data grid
  // is worse than no menu.
  useEffect(() => {
    if (!open) return;

    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isArchived = category.status === "ARCHIVED";

  const items = [
    { label: "Edit", icon: Pencil, run: () => onEdit(category) },
    { label: "Assign discount", icon: Tag, run: () => onAssignDiscount(category) },
    isArchived
      ? { label: "Restore", icon: ArchiveRestore, run: () => onActivate(category) }
      : { label: "Archive", icon: Archive, run: () => onArchive(category) },
    { label: "Delete", icon: Trash2, run: () => onDelete(category), danger: true },
  ];

  return (
    <div ref={ref} className="relative inline-block">
      <Button
        size="icon"
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${category.name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-md border border-border bg-popover shadow-lg"
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                role="menuitem"
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                  "danger" in item && item.danger && "text-destructive hover:bg-destructive/10"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
