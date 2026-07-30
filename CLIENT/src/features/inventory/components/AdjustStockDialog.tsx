/**
 * Stock adjustment request / damage write-off.
 *
 * One dialog, two modes, because they are the same gesture with a different
 * ledger consequence: an adjustment corrects the count, a damage write-off
 * removes unsellable goods AND records why. Splitting them into two screens
 * would make the user choose before they know which one they mean.
 *
 * THE CONSEQUENCE IS SHOWN BEFORE THE ACTION. The resulting stock level is
 * computed live, so nobody discovers they typed −100 instead of −10 after the
 * ledger has already recorded it.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Minus, Plus } from "lucide-react";

import { Button, Card, Input, Modal, Select } from "@/components/ui";
import { canManageEmployees } from "@/features/auth";
import { useAuthStore } from "@/store/auth.store";
import { cn } from "@/utils/cn";
import { useCreateAdjustment, useReportDamage } from "../hooks/useInventory";
import { ADJUSTMENT_REASON_OPTIONS, formatNumber } from "../utils/format";
import type { AdjustmentReason, StockRow } from "../types";

type Mode = "ADJUST" | "DAMAGE";

export function AdjustStockDialog({
  row,
  open,
  onClose,
  initialMode = "ADJUST",
}: {
  row: StockRow | null;
  open: boolean;
  onClose: () => void;
  initialMode?: Mode;
}) {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const isOwner = canManageEmployees(role);

  const [mode, setMode] = useState<Mode>(initialMode);
  const [direction, setDirection] = useState<"add" | "remove">("remove");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<AdjustmentReason>("MISCOUNT");
  const [notes, setNotes] = useState("");

  const createAdjustment = useCreateAdjustment();
  const reportDamage = useReportDamage();

  // Re-seed whenever a different item is opened, so a typed quantity can never
  // carry over onto the wrong product.
  useEffect(() => {
    setMode(initialMode);
    setDirection("remove");
    setQuantity("");
    setReason(initialMode === "DAMAGE" ? "DAMAGE" : "MISCOUNT");
    setNotes("");
  }, [row?.id, open, initialMode]);

  if (!row) return null;

  const qty = Math.max(0, Number(quantity) || 0);
  const delta = mode === "DAMAGE" ? -qty : direction === "add" ? qty : -qty;
  const resulting = row.currentStock + delta;

  const wouldGoNegative = resulting < 0;
  const notesRequired = mode === "ADJUST" && reason === "OTHER";
  const reasonRequired = mode === "DAMAGE";

  const canSubmit =
    qty > 0 &&
    !wouldGoNegative &&
    (!notesRequired || notes.trim().length > 0) &&
    (!reasonRequired || notes.trim().length > 0) &&
    !createAdjustment.isPending &&
    !reportDamage.isPending;

  const submit = () => {
    if (!canSubmit) return;

    if (mode === "DAMAGE") {
      reportDamage.mutate(
        { variantId: row.id, quantity: qty, reason: notes.trim() },
        { onSuccess: onClose }
      );
      return;
    }

    createAdjustment.mutate(
      {
        variantId: row.id,
        quantityChange: delta,
        reason,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
      { onSuccess: onClose }
    );
  };

  const isPending = createAdjustment.isPending || reportDamage.isPending;
  const isError = createAdjustment.isError || reportDamage.isError;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "DAMAGE" ? "Write off damaged stock" : "Adjust stock"}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} loading={isPending}>
            {mode === "DAMAGE"
              ? "Write off"
              : isOwner
                ? "Adjust stock"
                : "Submit for approval"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Card className="p-3">
          <div className="truncate text-sm font-medium">{row.productName}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            <span className="font-mono">{row.sku}</span> · {formatNumber(row.currentStock)} on hand
            {row.reserved > 0 && ` · ${formatNumber(row.reserved)} reserved`}
          </div>
        </Card>

        {/* Damage write-off is owner-only; a manager sees only the request path. */}
        {isOwner && (
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(["ADJUST", "DAMAGE"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setReason(m === "DAMAGE" ? "DAMAGE" : "MISCOUNT");
                }}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-sm transition-colors",
                  mode === m ? "bg-background font-medium shadow-sm" : "text-muted-foreground"
                )}
              >
                {m === "ADJUST" ? "Correction" : "Damaged"}
              </button>
            ))}
          </div>
        )}

        {mode === "ADJUST" && (
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => setDirection("remove")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                direction === "remove"
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground"
              )}
            >
              <Minus className="h-3.5 w-3.5" />
              Remove
            </button>
            <button
              type="button"
              onClick={() => setDirection("add")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                direction === "add"
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground"
              )}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Quantity</span>
          <Input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0"
            autoFocus
          />
        </label>

        {mode === "ADJUST" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Reason</span>
            <Select
              options={ADJUSTMENT_REASON_OPTIONS}
              value={reason}
              onChange={(e) => setReason(e.target.value as AdjustmentReason)}
            />
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            {mode === "DAMAGE" ? "What happened?" : "Notes"}
            {(notesRequired || reasonRequired) && (
              <span className="ml-1 text-destructive">*</span>
            )}
          </span>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={
              mode === "DAMAGE"
                ? "e.g. Water damage in storeroom"
                : reason === "OTHER"
                  ? "Required — explain the correction"
                  : "Optional context"
            }
            maxLength={500}
          />
        </label>

        {/* The consequence, before the action. */}
        {qty > 0 && (
          <Card
            className={cn(
              "flex items-center justify-between gap-3 p-3",
              wouldGoNegative && "border-destructive/40 bg-destructive/[0.04]"
            )}
          >
            <div className="text-xs text-muted-foreground">Resulting stock</div>
            <div className="flex items-center gap-2 text-sm tabular-nums">
              <span className="text-muted-foreground">{formatNumber(row.currentStock)}</span>
              <span className="text-muted-foreground">→</span>
              <span
                className={cn(
                  "font-bold",
                  wouldGoNegative ? "text-destructive" : "text-foreground"
                )}
              >
                {formatNumber(resulting)}
              </span>
            </div>
          </Card>
        )}

        {wouldGoNegative && (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              That would take stock below zero. Reduce the quantity, or run a cycle count if
              you believe the system figure is wrong.
            </span>
          </div>
        )}

        {!isOwner && mode === "ADJUST" && (
          <p className="text-[11px] text-muted-foreground">
            This will be submitted for the owner to approve. Stock does not change until
            they do.
          </p>
        )}

        {isError && (
          <p className="text-sm text-destructive">
            Could not save. Please check the values and try again.
          </p>
        )}
      </div>
    </Modal>
  );
}
