import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Play, Pause, Trash2, History } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { cn } from "@/utils/cn";
import { useDeleteDiscount, useUpdateDiscount } from "../hooks/useDiscounts";
import type { DiscountRule } from "../api/discountApi";

/**
 * Per-row actions. Enable/disable is a PATCH of isEnabled — the server rederives
 * status from it, so we never send a status. Delete warns with the variant count
 * because deleting a rule silently re-prices every variant it covered.
 */
export function DiscountRowActions({
  rule,
  onEdit,
  onHistory,
}: {
  rule: DiscountRule;
  onEdit: (rule: DiscountRule) => void;
  onHistory: (rule: DiscountRule) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const updateMut = useUpdateDiscount();
  const deleteMut = useDeleteDiscount();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const toggleEnabled = () => {
    updateMut.mutate(
      { id: rule.id, input: { isEnabled: !rule.isEnabled } },
      {
        onSuccess: () => toast.success(rule.isEnabled ? "Discount disabled." : "Discount enabled."),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update discount."),
      }
    );
  };

  const confirmDelete = () => {
    if (
      window.confirm(
        `Delete "${rule.name}"? Prices for every variant it covers will be recalculated without it. This cannot be undone.`
      )
    ) {
      deleteMut.mutate(rule.id, {
        onSuccess: (res) =>
          toast.success(`Discount deleted — ${res.affectedVariants} variant(s) re-priced.`),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete discount."),
      });
    }
  };

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <Button variant="ghost" size="icon" onClick={() => setOpen((o) => !o)} aria-label="Row actions">
        <MoreHorizontal className="h-4 w-4" />
      </Button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          <MenuItem icon={Pencil} label="Edit rule" onClick={run(() => onEdit(rule))} />
          <MenuItem
            icon={rule.isEnabled ? Pause : Play}
            label={rule.isEnabled ? "Disable" : "Enable"}
            onClick={run(toggleEnabled)}
          />
          <MenuItem icon={History} label="View history" onClick={run(() => onHistory(rule))} />
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
