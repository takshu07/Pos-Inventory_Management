/**
 * Denomination counter.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * A cashier counting a drawer types one number: "14,850". That number is a
 * mental sum, and mental sums are where drawer discrepancies are invented —
 * the till was right, the arithmetic was not. Counting by denomination makes
 * the total a consequence of what is physically in the drawer rather than an
 * assertion about it.
 *
 * The server enforces the same thing: if a denomination map is submitted, it
 * must equal the declared figure, and the request is rejected otherwise. This
 * component keeps them in step so that rejection never actually fires.
 */

import { useMemo } from "react";
import { Calculator, RotateCcw } from "lucide-react";

import { Button, Card, Input } from "@/components/ui";
import { cn } from "@/utils/cn";
import { formatCurrencyExact } from "@/components/shared/bi";

/** Indian note and coin set, descending. Mirrors the server's DENOMINATIONS. */
export const DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

export type DenominationMap = Record<string, number>;

/** Totals a denomination map. Mirrors the server's countDenominations exactly. */
export function totalDenominations(map: DenominationMap): number {
  return DENOMINATIONS.reduce((sum, denom) => {
    const count = Number(map[String(denom)] ?? 0);
    if (!Number.isFinite(count) || count <= 0) return sum;
    return sum + denom * Math.trunc(count);
  }, 0);
}

/** Drops zero counts so the payload carries only what was actually counted. */
export function compactDenominations(map: DenominationMap): DenominationMap | undefined {
  const out: DenominationMap = {};
  for (const denom of DENOMINATIONS) {
    const count = Math.trunc(Number(map[String(denom)] ?? 0));
    if (count > 0) out[String(denom)] = count;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface DenominationCounterProps {
  value: DenominationMap;
  onChange: (next: DenominationMap) => void;
  /** The figure the count must match. Shown as a live reconciliation. */
  target?: number | undefined;
  disabled?: boolean;
  className?: string;
}

export function DenominationCounter({
  value,
  onChange,
  target,
  disabled,
  className,
}: DenominationCounterProps) {
  const total = useMemo(() => totalDenominations(value), [value]);

  const delta = target === undefined ? null : total - target;
  const matches = delta === null ? null : Math.abs(delta) < 0.005;

  const set = (denom: number, raw: string) => {
    // Empty clears the row rather than storing 0 — a cleared row and a counted
    // zero look identical in a total but different in an audit.
    const parsed = raw === "" ? 0 : Math.max(0, Math.trunc(Number(raw)));
    if (!Number.isFinite(parsed)) return;
    onChange({ ...value, [String(denom)]: parsed });
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Calculator className="h-4 w-4 text-muted-foreground" aria-hidden />
          Count by denomination
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || total === 0}
          onClick={() => onChange({})}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Clear
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {DENOMINATIONS.map((denom) => {
          const count = value[String(denom)] ?? 0;
          const lineValue = denom * count;

          return (
            <div
              key={denom}
              className={cn(
                "flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5",
                count > 0 && "border-primary/40 bg-primary/5"
              )}
            >
              <span className="w-12 shrink-0 text-sm font-semibold tabular-nums">₹{denom}</span>
              <span className="text-xs text-muted-foreground">×</span>
              <Input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={count === 0 ? "" : count}
                onChange={(e) => set(denom, e.target.value)}
                disabled={disabled}
                placeholder="0"
                className="h-8 w-full min-w-0 px-2 text-sm"
                aria-label={`Count of ₹${denom} notes`}
              />
              <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {lineValue > 0 ? formatCurrencyExact(lineValue) : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <Card
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 p-3",
          matches === true && "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30",
          matches === false && "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
        )}
      >
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Counted total</p>
          <p className="text-lg font-semibold tabular-nums">{formatCurrencyExact(total)}</p>
        </div>

        {target !== undefined && (
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {matches ? "Matches entered amount" : "Difference vs entered"}
            </p>
            <p
              className={cn(
                "text-lg font-semibold tabular-nums",
                matches === true && "text-emerald-700 dark:text-emerald-400",
                matches === false && "text-amber-700 dark:text-amber-400"
              )}
            >
              {matches ? "✓" : `${delta! > 0 ? "+" : "−"}${formatCurrencyExact(Math.abs(delta!))}`}
            </p>
          </div>
        )}
      </Card>

      {matches === false && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          The denomination count and the amount you entered disagree. Fix one of them — the
          server rejects a close where they do not match, because one of the two figures is wrong.
        </p>
      )}
    </div>
  );
}
