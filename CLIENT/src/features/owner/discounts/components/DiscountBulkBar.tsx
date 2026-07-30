import { Pause, Play, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { useBulkDiscountAction } from "../hooks/useDiscounts";

/**
 * Appears only when rows are selected. DELETE confirms first — a bulk delete
 * re-prices every variant the selected rules covered, which is not undoable.
 */
export function DiscountBulkBar({
  selected,
  onClear,
}: {
  selected: string[];
  onClear: () => void;
}) {
  const bulk = useBulkDiscountAction();

  if (selected.length === 0) return null;

  const run = (action: "ENABLE" | "DISABLE" | "DELETE") => {
    if (
      action === "DELETE" &&
      !window.confirm(
        `Delete ${selected.length} discount(s)? Every variant they covered will be re-priced. This cannot be undone.`
      )
    ) {
      return;
    }

    bulk.mutate(
      { ids: selected, action },
      {
        onSuccess: (res) => {
          toast.success(
            `${res.processed} discount(s) ${action.toLowerCase()}d — ${res.affectedVariants} variant(s) re-priced.`
          );
          onClear();
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Bulk action failed."),
      }
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
      <span className="text-sm font-medium">{selected.length} selected</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => run("ENABLE")}
          loading={bulk.isPending}
          leftIcon={<Play className="h-3.5 w-3.5" />}
        >
          Enable
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => run("DISABLE")}
          loading={bulk.isPending}
          leftIcon={<Pause className="h-3.5 w-3.5" />}
        >
          Disable
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => run("DELETE")}
          loading={bulk.isPending}
          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
        >
          Delete
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear} leftIcon={<X className="h-3.5 w-3.5" />}>
          Clear
        </Button>
      </div>
    </div>
  );
}
