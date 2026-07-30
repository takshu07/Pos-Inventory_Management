import { Archive, CheckCircle2, Download, PauseCircle, Tag, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui";

export type CategoryBulkAction =
  | "ARCHIVE"
  | "ACTIVATE"
  | "DEACTIVATE"
  | "DELETE"
  | "DISCOUNT"
  | "EXPORT";

/**
 * CategoryBulkToolbar — the selection action bar (Phase 2).
 *
 * Renders only while a selection exists, docked above the table so the selected
 * rows stay visible. It is presentation only: it reports the requested action
 * and the caller decides what confirmation the action needs. Destructive
 * actions are styled distinctly but are NOT confirmed here — that belongs with
 * the owner of the data.
 */
export function CategoryBulkToolbar({
  selectedCount,
  onAction,
  onClear,
  busy = false,
}: {
  selectedCount: number;
  onAction: (action: CategoryBulkAction) => void;
  onClear: () => void;
  busy?: boolean;
}) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
      <span className="text-sm font-medium">
        {selectedCount} {selectedCount === 1 ? "category" : "categories"} selected
      </span>

      <div className="mx-2 h-5 w-px bg-border" aria-hidden />

      <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("ACTIVATE")}>
        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
        Activate
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("DEACTIVATE")}>
        <PauseCircle className="mr-1.5 h-3.5 w-3.5" />
        Deactivate
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("ARCHIVE")}>
        <Archive className="mr-1.5 h-3.5 w-3.5" />
        Archive
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("DISCOUNT")}>
        <Tag className="mr-1.5 h-3.5 w-3.5" />
        Assign discount
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("EXPORT")}>
        <Download className="mr-1.5 h-3.5 w-3.5" />
        Export
      </Button>
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => onAction("DELETE")}>
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
        Delete
      </Button>

      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        <X className="mr-1.5 h-3.5 w-3.5" />
        Clear
      </Button>
    </div>
  );
}
