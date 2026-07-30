import { useEffect, useRef, useState } from "react";
import { MoreVertical, IndianRupee, RotateCcw } from "lucide-react";
import { cn } from "@/utils/cn";

/**
 * VariantRowMenu — the ⋮ row action menu in the Variant Details table. Keeps
 * pricing OUT of the grid: overriding a variant's price is an explicit action
 * that opens a dialog, not an inline field.
 */
export function VariantRowMenu({
  hasOverride,
  onOverride,
  onReset,
}: {
  hasOverride: boolean;
  onOverride: () => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent transition-colors";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Variant actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-border",
            "bg-card py-1 shadow-lg"
          )}
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onOverride();
            }}
          >
            <IndianRupee className="h-3.5 w-3.5" />
            {hasOverride ? "Edit price override" : "Override pricing"}
          </button>
          {hasOverride && (
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false);
                onReset();
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset to product pricing
            </button>
          )}
        </div>
      )}
    </div>
  );
}
