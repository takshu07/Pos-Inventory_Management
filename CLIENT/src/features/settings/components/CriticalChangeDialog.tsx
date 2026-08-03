/**
 * Confirmation for settings changes with consequences beyond this screen.
 *
 * WHY CONFIRM AT ALL — most settings do not need this, and confirming everything
 * trains people to click through without reading. Only the fields in
 * CRITICAL_FIELDS get a dialog: the ones where a mistake is both silent and
 * expensive (tax mode, discount ceilings, negative stock, session lifetime).
 * A wrong `itemsPerPage` is obvious immediately and self-corrects; a wrong
 * `taxInclusive` misprices every sale until somebody reconciles the books.
 *
 * The dialog names each change and states its consequence, rather than asking
 * "Are you sure?" — the second question cannot be answered without the first.
 */

import { AlertTriangle } from "lucide-react";

import { Button, Modal } from "@/components/ui";
import { CRITICAL_FIELDS } from "../validation";

import { CRITICAL_FIELD_LABELS } from "../validation/criticalLabels";

interface CriticalChangeDialogProps {
  open: boolean;
  /** `"block.field"` paths, from `findCriticalChanges(patch)`. */
  paths: string[];
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CriticalChangeDialog({
  open,
  paths,
  saving,
  onConfirm,
  onCancel,
}: CriticalChangeDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Confirm these changes"
      description={
        paths.length === 1
          ? "This setting affects how the POS operates."
          : `${paths.length} of your changes affect how the POS operates.`
      }
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Go back
          </Button>
          <Button onClick={onConfirm} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-3">
        {paths.map((path) => (
          <li
            key={path}
            className="flex gap-3 rounded-lg border border-border bg-muted/40 p-3"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {CRITICAL_FIELD_LABELS[path] ?? path}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {CRITICAL_FIELDS[path]}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-muted-foreground">
        Existing records are never rewritten — these settings apply to what
        happens from now on. Every change is recorded in the audit log.
      </p>
    </Modal>
  );
}
