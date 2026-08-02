/**
 * The four drawer dialogs: Open, Cash Drop, Payout, Close.
 *
 * A RECURRING PATTERN WORTH NAMING
 * --------------------------------
 * Every one of these is a MONEY-MOVING form, so each follows the same rules:
 *   • The submit button is disabled until the form is genuinely valid, not
 *     merely non-empty. A cashier should never be able to click "Drop" and
 *     receive a server rejection they could have been shown inline.
 *   • Amounts validate against the LIVE drawer position where one exists —
 *     dropping more than the till holds is caught here, not after a round trip.
 *   • The dialog closes only on success. A form that closes optimistically and
 *     then toasts a failure has already discarded what the user typed.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownToLine, Banknote, LockOpen, Receipt } from "lucide-react";

import { Button, Input, Modal, Select } from "@/components/ui";
import { cn } from "@/utils/cn";
import { formatCurrencyExact, PAYOUT_CATEGORY_LABELS, varianceLabel, varianceKind } from "@/components/shared/bi";
import {
  DenominationCounter,
  compactDenominations,
  totalDenominations,
  type DenominationMap,
} from "./DenominationCounter";
import type { ClosePreview, PayoutCategory } from "../types";

// =============================================================================
// SHARED
// =============================================================================

/** Parses a money input. Returns null for anything that is not a valid amount. */
function parseMoney(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  // Two decimal places, matching the server's `.multipleOf(0.01)` rule.
  return Math.round(n * 100) / 100;
}

function FieldError({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <p className="mt-1 text-xs text-destructive">{children}</p>;
}

// =============================================================================
// OPEN REGISTER
// =============================================================================

export function OpenRegisterDialog({
  open,
  onClose,
  onSubmit,
  isSubmitting,
  registerNumbers,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    registerNumber: string;
    openingCash: number;
    notes?: string;
    denominations?: DenominationMap;
  }) => void;
  isSubmitting: boolean;
  registerNumbers: string[];
}) {
  const [registerNumber, setRegisterNumber] = useState("REG-01");
  const [openingCash, setOpeningCash] = useState("");
  const [notes, setNotes] = useState("");
  const [useDenominations, setUseDenominations] = useState(false);
  const [denominations, setDenominations] = useState<DenominationMap>({});

  useEffect(() => {
    if (!open) return;
    setRegisterNumber(registerNumbers[0] ?? "REG-01");
    setOpeningCash("");
    setNotes("");
    setUseDenominations(false);
    setDenominations({});
  }, [open, registerNumbers]);

  const amount = parseMoney(openingCash);
  const denomTotal = totalDenominations(denominations);
  const denomMismatch = useDenominations && amount !== null && Math.abs(denomTotal - amount) >= 0.005;

  const canSubmit = amount !== null && !denomMismatch && !isSubmitting;

  const options = useMemo(() => {
    const known = registerNumbers.length > 0 ? registerNumbers : ["REG-01"];
    return known.map((n) => ({ value: n, label: n }));
  }, [registerNumbers]);

  return (
    <Modal open={open} onClose={onClose} title="Open Register" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          A sale cannot be recorded without an open drawer. Count the opening float and confirm
          the amount below.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Register"
            options={options}
            value={registerNumber}
            onChange={(e) => setRegisterNumber(e.target.value)}
            disabled={isSubmitting}
          />

          <div>
            <Input
              label="Opening Cash (₹)"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              placeholder="0.00"
              disabled={isSubmitting}
              autoFocus
            />
            <FieldError>
              {openingCash !== "" && amount === null ? "Enter a valid amount." : null}
            </FieldError>
          </div>
        </div>

        <Input
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Morning shift, float from safe"
          disabled={isSubmitting}
        />

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useDenominations}
            onChange={(e) => {
              setUseDenominations(e.target.checked);
              if (!e.target.checked) setDenominations({});
            }}
            disabled={isSubmitting}
            className="h-4 w-4 rounded border-border"
          />
          Count the float by denomination
        </label>

        {useDenominations && (
          <DenominationCounter
            value={denominations}
            onChange={setDenominations}
            target={amount ?? undefined}
            disabled={isSubmitting}
          />
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                registerNumber,
                openingCash: amount!,
                ...(notes.trim() ? { notes: notes.trim() } : {}),
                ...(useDenominations
                  ? { denominations: compactDenominations(denominations) }
                  : {}),
              })
            }
          >
            <LockOpen className="mr-1.5 h-4 w-4" />
            {isSubmitting ? "Opening…" : "Open Register"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// CASH DROP
// =============================================================================

export function CashDropDialog({
  open,
  onClose,
  onSubmit,
  isSubmitting,
  expectedCash,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    amount: number;
    reason: string;
    destination?: string;
    referenceNumber?: string;
  }) => void;
  isSubmitting: boolean;
  expectedCash: number;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [destination, setDestination] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setReason("");
    setDestination("");
    setReferenceNumber("");
  }, [open]);

  const parsed = parseMoney(amount);
  const exceedsDrawer = parsed !== null && parsed > expectedCash;
  const canSubmit =
    parsed !== null && parsed > 0 && !exceedsDrawer && reason.trim().length >= 3 && !isSubmitting;

  return (
    <Modal open={open} onClose={onClose} title="Cash Drop" size="md">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Moving cash out of the drawer to a safe or the bank. This reduces the expected drawer
          balance but is <strong>not</strong> an expense — the money still belongs to the business.
        </p>

        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Drawer currently expected to hold </span>
          <span className="font-semibold tabular-nums">{formatCurrencyExact(expectedCash)}</span>
        </div>

        <div>
          <Input
            label="Amount (₹)"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            disabled={isSubmitting}
            autoFocus
          />
          <FieldError>
            {exceedsDrawer
              ? `You cannot drop more than the drawer holds (${formatCurrencyExact(expectedCash)}).`
              : amount !== "" && (parsed === null || parsed === 0)
                ? "Enter an amount greater than zero."
                : null}
          </FieldError>
        </div>

        <div>
          <Input
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Mid-shift drop to safe"
            disabled={isSubmitting}
          />
          <FieldError>
            {reason.length > 0 && reason.trim().length < 3
              ? "Say why cash is leaving the drawer."
              : null}
          </FieldError>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Destination (optional)"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Safe / Bank"
            disabled={isSubmitting}
          />
          <Input
            label="Reference (optional)"
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
            placeholder="Deposit slip no."
            disabled={isSubmitting}
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                amount: parsed!,
                reason: reason.trim(),
                ...(destination.trim() ? { destination: destination.trim() } : {}),
                ...(referenceNumber.trim() ? { referenceNumber: referenceNumber.trim() } : {}),
              })
            }
          >
            <ArrowDownToLine className="mr-1.5 h-4 w-4" />
            {isSubmitting ? "Recording…" : "Record Drop"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// CASH PAYOUT
// =============================================================================

const PAYOUT_OPTIONS = Object.entries(PAYOUT_CATEGORY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export function CashPayoutDialog({
  open,
  onClose,
  onSubmit,
  isSubmitting,
  expectedCash,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    category: PayoutCategory;
    amount: number;
    reason: string;
    payeeName?: string;
  }) => void;
  isSubmitting: boolean;
  expectedCash: number;
}) {
  const [category, setCategory] = useState<PayoutCategory>("TEA");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [payeeName, setPayeeName] = useState("");

  useEffect(() => {
    if (!open) return;
    setCategory("TEA");
    setAmount("");
    setReason("");
    setPayeeName("");
  }, [open]);

  const parsed = parseMoney(amount);
  const exceedsDrawer = parsed !== null && parsed > expectedCash;
  const canSubmit =
    parsed !== null && parsed > 0 && !exceedsDrawer && reason.trim().length >= 3 && !isSubmitting;

  return (
    <Modal open={open} onClose={onClose} title="Cash Payout" size="md">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          A business expense paid straight from the drawer. Unlike a cash drop this
          <strong> does</strong> hit the profit &amp; loss — an expense record is created
          automatically and appears in the Finance module.
        </p>

        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Drawer currently expected to hold </span>
          <span className="font-semibold tabular-nums">{formatCurrencyExact(expectedCash)}</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Category"
            options={PAYOUT_OPTIONS}
            value={category}
            onChange={(e) => setCategory(e.target.value as PayoutCategory)}
            disabled={isSubmitting}
          />
          <div>
            <Input
              label="Amount (₹)"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={isSubmitting}
              autoFocus
            />
            <FieldError>
              {exceedsDrawer
                ? `You cannot pay out more than the drawer holds (${formatCurrencyExact(expectedCash)}).`
                : null}
            </FieldError>
          </div>
        </div>

        <div>
          <Input
            label="What was it for?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Tea for staff, afternoon"
            disabled={isSubmitting}
          />
          <FieldError>
            {reason.length > 0 && reason.trim().length < 3
              ? "State what the money was spent on."
              : null}
          </FieldError>
        </div>

        <Input
          label="Paid to (optional)"
          value={payeeName}
          onChange={(e) => setPayeeName(e.target.value)}
          placeholder="Vendor or person"
          disabled={isSubmitting}
        />

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                category,
                amount: parsed!,
                reason: reason.trim(),
                ...(payeeName.trim() ? { payeeName: payeeName.trim() } : {}),
              })
            }
          >
            <Receipt className="mr-1.5 h-4 w-4" />
            {isSubmitting ? "Recording…" : "Record Payout"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// CLOSE REGISTER
// =============================================================================

export function CloseRegisterDialog({
  open,
  onClose,
  onSubmit,
  isSubmitting,
  preview,
  isLoadingPreview,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    countedCash: number;
    notes?: string;
    discrepancyReason?: string;
    denominations?: DenominationMap;
    expectedCashAtSubmit: number;
  }) => void;
  isSubmitting: boolean;
  preview: ClosePreview | undefined;
  isLoadingPreview: boolean;
}) {
  const [countedCash, setCountedCash] = useState("");
  const [notes, setNotes] = useState("");
  const [discrepancyReason, setDiscrepancyReason] = useState("");
  const [useDenominations, setUseDenominations] = useState(true);
  const [denominations, setDenominations] = useState<DenominationMap>({});

  useEffect(() => {
    if (!open) return;
    setCountedCash("");
    setNotes("");
    setDiscrepancyReason("");
    setUseDenominations(true);
    setDenominations({});
  }, [open]);

  // When counting by denomination the total IS the counted figure — typing a
  // second, different number would create exactly the ambiguity this dialog
  // exists to remove.
  const denomTotal = totalDenominations(denominations);
  const counted = useDenominations ? denomTotal : parseMoney(countedCash);

  const expected = preview?.expectedCash ?? 0;
  const difference = counted === null ? null : Math.round((counted - expected) * 100) / 100;
  const kind = varianceKind(difference);
  const needsReason = difference !== null && difference !== 0;

  const canSubmit =
    counted !== null &&
    !isLoadingPreview &&
    !isSubmitting &&
    Boolean(preview) &&
    (!needsReason || discrepancyReason.trim().length >= 3);

  return (
    <Modal open={open} onClose={onClose} title="Close Register" size="xl">
      <div className="space-y-4">
        {isLoadingPreview || !preview ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Calculating what the drawer should hold…
          </p>
        ) : (
          <>
            {/* ── What the system expects ─────────────────────────────────── */}
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Expected drawer balance
              </p>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Opening cash</dt>
                  <dd className="tabular-nums">{formatCurrencyExact(preview.openingCash)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">+ Cash received</dt>
                  <dd className="tabular-nums">{formatCurrencyExact(preview.cashIn)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">− Cash out (drops, payouts, refunds)</dt>
                  <dd className="tabular-nums">{formatCurrencyExact(preview.cashOut)}</dd>
                </div>
                <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                  <dt>Expected cash</dt>
                  <dd className="tabular-nums">{formatCurrencyExact(preview.expectedCash)}</dd>
                </div>
              </dl>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useDenominations}
                onChange={(e) => {
                  setUseDenominations(e.target.checked);
                  setDenominations({});
                  setCountedCash("");
                }}
                disabled={isSubmitting}
                className="h-4 w-4 rounded border-border"
              />
              Count by denomination (recommended)
            </label>

            {useDenominations ? (
              <DenominationCounter
                value={denominations}
                onChange={setDenominations}
                disabled={isSubmitting}
              />
            ) : (
              <Input
                label="Counted Cash (₹)"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                placeholder="0.00"
                disabled={isSubmitting}
                autoFocus
              />
            )}

            {/* ── The variance ────────────────────────────────────────────── */}
            {counted !== null && (
              <div
                className={cn(
                  "flex items-center justify-between gap-3 rounded-xl border p-3",
                  kind === "BALANCED" &&
                    "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30",
                  kind === "OVER" &&
                    "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30",
                  kind === "SHORT" &&
                    "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
                )}
              >
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Counted {formatCurrencyExact(counted)} vs expected{" "}
                    {formatCurrencyExact(expected)}
                  </p>
                  <p className="text-base font-semibold">{varianceLabel(difference)}</p>
                </div>
                {kind !== "BALANCED" && (
                  <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden />
                )}
              </div>
            )}

            {needsReason && (
              <div>
                <Input
                  label="Reason for the discrepancy (required)"
                  value={discrepancyReason}
                  onChange={(e) => setDiscrepancyReason(e.target.value)}
                  placeholder="e.g. Gave ₹200 change from own pocket, not recorded"
                  disabled={isSubmitting}
                />
                <FieldError>
                  {discrepancyReason.length > 0 && discrepancyReason.trim().length < 3
                    ? "Give a real reason — this is the audit trail for the missing cash."
                    : null}
                </FieldError>
                <p className="mt-1 text-xs text-muted-foreground">
                  A shift cannot be closed with an unexplained difference. This is recorded
                  against your name.
                </p>
              </div>
            )}

            <Input
              label="Shift notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the next shift should know"
              disabled={isSubmitting}
            />
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                countedCash: counted!,
                expectedCashAtSubmit: expected,
                ...(notes.trim() ? { notes: notes.trim() } : {}),
                ...(needsReason ? { discrepancyReason: discrepancyReason.trim() } : {}),
                ...(useDenominations
                  ? { denominations: compactDenominations(denominations) }
                  : {}),
              })
            }
          >
            <Banknote className="mr-1.5 h-4 w-4" />
            {isSubmitting ? "Closing…" : "Close Register"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
