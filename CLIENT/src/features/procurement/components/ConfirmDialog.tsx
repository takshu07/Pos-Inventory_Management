/**
 * Confirmation dialog for destructive and irreversible procurement actions.
 *
 * DESIGN DECISION — the server's refusal is the useful message.
 *
 * Deleting a brand that still has products, or a supplier with bills, returns
 * 409 with a structured `details` payload explaining exactly what is blocking
 * it. That is far more actionable than a generic "could not delete", so this
 * dialog stays OPEN on failure and renders the server's message inline, next to
 * the alternative action (deactivate) that will actually work.
 *
 * Closing the dialog and firing a toast would throw that context away and leave
 * the user to guess.
 */

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Input, Modal } from "@/components/ui";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<unknown>;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  /** Destructive by default; set false for benign confirmations. */
  destructive?: boolean;
  /**
   * When set, the user must type this exact string to enable the confirm
   * button. Reserved for genuinely unrecoverable actions — a deletion that
   * cannot be undone — not for routine ones, where friction just annoys.
   */
  typeToConfirm?: string;
  /** Offered when the primary action is blocked (e.g. "Deactivate instead"). */
  alternative?: { label: string; onClick: () => void };
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = true,
  typeToConfirm,
  alternative,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  // Reset per-open, so a previous failure never greets the next open.
  useEffect(() => {
    if (open) {
      setError(null);
      setTyped("");
      setBusy(false);
    }
  }, [open]);

  const confirmEnabled =
    !busy && (typeToConfirm ? typed.trim() === typeToConfirm : true);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      // Stay open and show why — see the file header.
      setError(e instanceof Error ? e.message : "The action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      size="md"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {alternative && (
            <Button variant="outline" onClick={alternative.onClick} disabled={busy}>
              {alternative.label}
            </Button>
          )}
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={!confirmEnabled}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">{description}</div>

        {typeToConfirm && (
          <div className="space-y-1.5">
            <label htmlFor="confirm-text" className="text-sm font-medium text-foreground">
              Type <span className="font-mono font-semibold">{typeToConfirm}</span> to confirm
            </label>
            <Input
              id="confirm-text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
