/**
 * A cycle count session — the screen someone stands on the shop floor using.
 *
 * THE SCANNER IS THE PRIMARY INPUT. A handheld scanner is a keyboard that types
 * fast and presses Enter, so the flow is: scan → type quantity → Enter → focus
 * returns to the scan box. No mouse, no mode switch, no clicking between
 * fields. Anything that breaks that loop makes counting slower than a clipboard.
 *
 * Expected quantities were frozen when the session started, so a variance is
 * attributable to the count rather than to sales made while counting.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { AlertTriangle, Check, ScanLine } from "lucide-react";

import {
  Badge, Button, Card, ErrorState, Input, Modal, Skeleton,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui";
import { canManageEmployees } from "@/features/auth";
import { useAuthStore } from "@/store/auth.store";
import { cn } from "@/utils/cn";
import { CycleCountStatusBadge, DeltaCell, KpiCard } from "../components/InventoryAtoms";
import {
  useCompleteCycleCount,
  useCycleCount,
  useRecordCountByCode,
} from "../hooks/useInventory";
import { accuracyAccent, formatNumber, formatPercent, formatVariantName } from "../utils/format";

export default function CycleCountSessionPage() {
  const { countId } = useParams<{ countId: string }>();
  const navigate = useNavigate();

  const role = useAuthStore((s) => s.user?.role ?? null);
  const canPost = canManageEmployees(role);

  const [code, setCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [completing, setCompleting] = useState(false);
  const [postAdjustments, setPostAdjustments] = useState(true);

  const codeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, isError, refetch } = useCycleCount(countId);
  const recordByCode = useRecordCountByCode(countId);
  const complete = useCompleteCycleCount();

  // Keep the scan box focused whenever the session is live — a counter should
  // never have to click before scanning the next item.
  useEffect(() => {
    if (data?.status === "IN_PROGRESS") codeRef.current?.focus();
  }, [data?.status]);

  if (isError) {
    return (
      <div className="p-6">
        <ErrorState message="Failed to load this count." onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const isLive = data.status === "IN_PROGRESS";
  const counted = data.items.filter((i) => i.countedQuantity !== null);
  const variances = data.items.filter((i) => (i.variance ?? 0) !== 0);
  const progress = data.totalItems > 0 ? (counted.length / data.totalItems) * 100 : 0;

  const submitScan = () => {
    const trimmed = code.trim();
    const qty = Number(quantity);

    if (!trimmed || quantity === "" || Number.isNaN(qty) || qty < 0) return;

    recordByCode.mutate(
      { code: trimmed, countedQuantity: qty },
      {
        onSuccess: (item: any) => {
          const variance = item?.variance ?? 0;
          setFeedback({
            ok: variance === 0,
            message:
              variance === 0
                ? `${item?.variant?.sku ?? trimmed} matches at ${qty}`
                : `${item?.variant?.sku ?? trimmed}: counted ${qty}, expected ${item?.expectedQuantity} (${variance > 0 ? "+" : ""}${variance})`,
          });
          // Reset and return focus so the next scan lands immediately.
          setCode("");
          setQuantity("");
          codeRef.current?.focus();
        },
        onError: () => {
          setFeedback({ ok: false, message: `No product found for "${trimmed}".` });
          setCode("");
          codeRef.current?.focus();
        },
      }
    );
  };

  const finish = () => {
    if (!countId) return;
    complete.mutate(
      { id: countId, payload: { postAdjustments: postAdjustments && canPost } },
      {
        onSuccess: () => {
          setCompleting(false);
          refetch();
        },
      }
    );
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight font-mono">{data.reference}</h1>
            <CycleCountStatusBadge status={data.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.name ?? "Stock take"} · started by{" "}
            {data.startedBy ? `${data.startedBy.firstName} ${data.startedBy.lastName}` : "—"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/admin/inventory/cycle-counts")}>
            Back to counts
          </Button>
          {isLive && (
            <Button size="sm" onClick={() => setCompleting(true)}>
              Complete count
            </Button>
          )}
        </div>
      </div>

      {/* ── Progress ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard icon={Check} label="Counted" value={`${counted.length} / ${data.totalItems}`} />
        <KpiCard
          icon={AlertTriangle}
          label="Variances"
          value={formatNumber(variances.length)}
          accent={variances.length > 0 ? "text-destructive" : undefined}
        />
        <KpiCard
          icon={ScanLine}
          label="Net variance"
          value={`${data.netVariance > 0 ? "+" : ""}${formatNumber(data.netVariance)}`}
          hint="+5 and −5 both count as errors"
        />
        <KpiCard
          icon={Check}
          label="Accuracy"
          value={counted.length > 0 ? formatPercent(data.accuracy) : "—"}
          accent={accuracyAccent(counted.length > 0 ? data.accuracy : null)}
          hint="by line, not units"
        />
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* ── Scanner ──────────────────────────────────────────────────────── */}
      {isLive && (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
              <span className="text-sm font-medium">Scan or type a code</span>
              <div className="relative">
                <ScanLine
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  ref={codeRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    // A scanner fires Enter after the code — jump to quantity
                    // rather than submitting a count of nothing.
                    if (code.trim()) qtyRef.current?.focus();
                  }}
                  placeholder="Barcode or SKU"
                  className="pl-9 font-mono"
                />
              </div>
            </label>

            <label className="flex w-32 flex-col gap-1.5">
              <span className="text-sm font-medium">Counted</span>
              <Input
                ref={qtyRef}
                type="number"
                min={0}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitScan();
                  }
                }}
                placeholder="0"
                className="tabular-nums"
              />
            </label>

            <Button onClick={submitScan} disabled={recordByCode.isPending}>
              Record
            </Button>
          </div>

          {feedback && (
            <p
              className={cn(
                "text-sm",
                feedback.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
              )}
              role="status"
            >
              {feedback.message}
            </p>
          )}

          <p className="text-[11px] text-muted-foreground">
            Zero is a valid count — it records an empty shelf, which is different from not
            having counted the item at all.
          </p>
        </Card>
      )}

      {/* ── Lines ────────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[16rem]">Product</TableHead>
              <TableHead>Barcode</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Counted</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {data.items.map((item) => {
              const isCounted = item.countedQuantity !== null;
              const hasVariance = (item.variance ?? 0) !== 0;

              return (
                <TableRow
                  key={item.id}
                  className={cn(
                    hasVariance && "bg-destructive/[0.04]",
                    // Uncounted lines are dimmed so what remains is obvious at
                    // a glance from across the shop floor.
                    !isCounted && "opacity-60"
                  )}
                >
                  <TableCell>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{item.productName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        <span className="font-mono">{item.sku}</span>
                        {formatVariantName(item.variantName) !== "—" && (
                          <> · {formatVariantName(item.variantName)}</>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {item.barcode ?? "—"}
                  </TableCell>

                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatNumber(item.expectedQuantity)}
                  </TableCell>

                  <TableCell className="text-right tabular-nums">
                    {isCounted ? (
                      <span className="font-medium">{formatNumber(item.countedQuantity)}</span>
                    ) : (
                      <Badge variant="outline">Not counted</Badge>
                    )}
                  </TableCell>

                  <TableCell className="text-right">
                    {isCounted ? (
                      <DeltaCell value={item.variance ?? 0} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {item.countedByName ?? "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* ── Completion ───────────────────────────────────────────────────── */}
      <Modal
        open={completing}
        onClose={() => setCompleting(false)}
        title="Complete this count"
        footer={
          <>
            <Button variant="outline" onClick={() => setCompleting(false)}>
              Cancel
            </Button>
            <Button onClick={finish} loading={complete.isPending}>
              Complete
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            {counted.length} of {data.totalItems} items counted, with{" "}
            <span className="font-medium">{variances.length}</span> discrepanc
            {variances.length === 1 ? "y" : "ies"}.
          </p>

          {counted.length < data.totalItems && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden="true"
              />
              <p className="text-xs text-muted-foreground">
                {data.totalItems - counted.length} item
                {data.totalItems - counted.length === 1 ? " was" : "s were"} not counted. Those
                lines are left untouched — only counted items can produce a variance.
              </p>
            </div>
          )}

          {canPost ? (
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={postAdjustments}
                onChange={(e) => setPostAdjustments(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span className="text-sm">
                Post variances to the ledger
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  Adjusts stock to match what was counted. Unchecking makes this a dry run —
                  the findings are recorded but stock is left as it is.
                </span>
              </span>
            </label>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Your count will be recorded, but only the owner can post variances to the stock
              ledger.
            </p>
          )}

          {complete.isError && (
            <p className="text-sm text-destructive">
              Could not complete the count. Please try again.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
