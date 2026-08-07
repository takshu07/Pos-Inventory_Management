/**
 * Shift summary — the document a cashier hands to an owner at end of day.
 *
 * IT IS A DOCUMENT, NOT A DASHBOARD.
 *
 * The layout deliberately mirrors the printable version the server renders:
 * header block, tender breakdown, drawer reconciliation, variance, denomination
 * count, itemised drops and payouts. Someone comparing the screen to the print
 * should not have to translate between two different arrangements of the same
 * facts.
 *
 * A LIVE shift renders the same shape with an explicit "still open" warning,
 * because the figures are provisional until the drawer is counted.
 */

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Printer,
  ShieldCheck,
} from "lucide-react";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Modal, Input } from "@/components/ui";
import {
  ExportMenu,
  MetricPanel,
  PageHeader,
  StatRow,
  downloadExport,
  formatCurrencyExact,
  formatDateTime,
  formatNumber,
  PAYOUT_CATEGORY_LABELS,
  REGISTER_STATUS_LABELS,
  REGISTER_STATUS_VARIANTS,
  varianceKind,
  varianceLabel,
} from "@/components/shared/bi";
import { useAuthStore } from "@/store/auth.store";
import { cn } from "@/utils/cn";

import { useShiftSummary, useReconcileRegister } from "../hooks/useRegister";
import { ActivityTimeline } from "../components/ActivityTimeline";

export default function ShiftSummaryPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const userId = useAuthStore((s) => s.user?.id);

  const { data, isLoading } = useShiftSummary(sessionId);
  const reconcile = useReconcileRegister();

  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileNotes, setReconcileNotes] = useState("");

  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader title="Shift Summary" />
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Loading shift summary…
          </CardContent>
        </Card>
      </div>
    );
  }

  const { totals, shift, session, drawer } = data;
  const kind = varianceKind(totals.difference);

  // Named once so the tender panel's total and its net cannot drift apart.
  const totalCollected =
    totals.cashSales + totals.upiSales + totals.cardSales + totals.otherSales;

  // Reconciliation requires a supervisor who did NOT work the shift. Both
  // conditions are enforced server-side; hiding the button when they fail
  // simply avoids offering an action that would 403.
  const canReconcile =
    (role === "OWNER" || role === "MANAGER") &&
    session.status === "CLOSED" &&
    session.employeeId !== userId;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Shift Summary"
        breadcrumb={
          <Link to="/register/history" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="h-3 w-3" aria-hidden />
            Register History
          </Link>
        }
        description={`${shift.registerNumber} · ${shift.employee}${shift.employeeCode ? ` (${shift.employeeCode})` : ""}`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void downloadExport(`/register/${session.id}/summary/export`, "pdf")
              }
            >
              <Printer className="mr-1.5 h-3.5 w-3.5" />
              Print
            </Button>

            <ExportMenu path={`/register/${session.id}/summary/export`} label="Export" />

            {canReconcile && (
              <Button size="sm" onClick={() => setReconcileOpen(true)}>
                <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                Reconcile
              </Button>
            )}
          </>
        }
      />

      {/* ── Provisional-figures warning ────────────────────────────────────── */}
      {data.isLive && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="flex items-start gap-2.5 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <p className="text-sm text-amber-900 dark:text-amber-200">
              <strong>This shift is still open.</strong> Every figure below is provisional and
              will change as sales are rung up. Nothing is final until the drawer is counted and
              the register is closed.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Shift identity ─────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 py-4 sm:grid-cols-4">
          <Field label="Session" value={session.sessionNumber ?? session.id.slice(-8)} />
          <Field label="Register" value={shift.registerNumber} />
          <Field
            label="Status"
            value={
              <Badge variant={REGISTER_STATUS_VARIANTS[session.status] ?? "secondary"}>
                {REGISTER_STATUS_LABELS[session.status] ?? session.status}
              </Badge>
            }
          />
          <Field label="Duration" value={shift.durationLabel} />
          <Field label="Opened" value={formatDateTime(shift.openedAt)} />
          <Field label="Closed" value={shift.closedAt ? formatDateTime(shift.closedAt) : "—"} />
          <Field label="Closed by" value={shift.closedBy ?? "—"} />
          <Field label="Reconciled by" value={shift.reconciledBy ?? "—"} />
        </CardContent>
      </Card>

      {/* ── The variance, given prominence ─────────────────────────────────── */}
      <Card
        className={cn(
          "border-2",
          kind === "BALANCED" && "border-emerald-300 dark:border-emerald-800",
          kind === "OVER" && "border-blue-300 dark:border-blue-800",
          kind === "SHORT" && "border-red-300 dark:border-red-800",
          kind === null && "border-border"
        )}
      >
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-3">
            {kind === "BALANCED" ? (
              <CheckCircle2 className="h-7 w-7 text-emerald-600" aria-hidden />
            ) : kind === null ? (
              <AlertTriangle className="h-7 w-7 text-muted-foreground" aria-hidden />
            ) : (
              <AlertTriangle className="h-7 w-7 text-amber-600" aria-hidden />
            )}
            <div>
              <p className="text-lg font-semibold">{varianceLabel(totals.difference)}</p>
              <p className="text-xs text-muted-foreground">
                Counted {formatCurrencyExact(totals.countedCash)} against expected{" "}
                {formatCurrencyExact(totals.expectedCash)}
              </p>
            </div>
          </div>

          {shift.discrepancyReason && (
            <div className="max-w-md rounded-lg border-l-2 border-muted-foreground bg-muted/40 px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">Stated reason</p>
              <p className="text-sm">{shift.discrepancyReason}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ── Tenders ──────────────────────────────────────────────────────── */}
        <MetricPanel title="Sales by tender">
          <div className="space-y-0.5">
            <StatRow label="Cash sales" value={formatCurrencyExact(totals.cashSales)} />
            <StatRow label="UPI sales" value={formatCurrencyExact(totals.upiSales)} />
            <StatRow label="Card sales" value={formatCurrencyExact(totals.cardSales)} />
            <StatRow label="Other tenders" value={formatCurrencyExact(totals.otherSales)} />
            <StatRow
              label="Total money collected"
              value={formatCurrencyExact(totalCollected)}
              emphasis
            />
            {/* Cash refunds only — store credit hands over a balance, not
                money, so deducting it would understate what was taken. */}
            <StatRow
              label="− Cash refunds"
              value={formatCurrencyExact(totals.refunds)}
              tone="negative"
            />
            <StatRow
              label="Net collected"
              value={formatCurrencyExact(totalCollected - totals.refunds)}
              emphasis
            />
            <StatRow
              label="Split payments"
              value={formatCurrencyExact(totals.splitSales)}
              tone="muted"
            />
            <StatRow
              label="Discounts given"
              value={formatCurrencyExact(totals.discounts)}
              tone="muted"
            />
            <StatRow
              label="Transactions"
              value={formatNumber(totals.transactionCount)}
              tone="muted"
            />
          </div>

          {/* Fenced off: merchandise and account credit are not takings. */}
          <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/20 p-2.5">
            <p className="text-xs font-medium text-muted-foreground">
              Informational — not money
            </p>
            <div className="mt-1 space-y-0.5">
              <StatRow
                label="Exchange value issued"
                value={formatCurrencyExact(totals.exchanges)}
                tone="muted"
              />
              <StatRow
                label="Store credit refunds"
                value={formatCurrencyExact(totals.storeCreditRefunds)}
                tone="muted"
              />
            </div>
          </div>
        </MetricPanel>

        {/* ── Reconciliation ───────────────────────────────────────────────── */}
        {/* Every line here is a CASH movement, and they sum exactly to
            "Expected in drawer". The panel previously listed cash sales and
            refunds against a total derived from the drawer ledger, so the
            arithmetic on screen did not add up to the figure beneath it. */}
        <MetricPanel title="Drawer reconciliation">
          <div className="space-y-0.5">
            <StatRow label="Opening float" value={formatCurrencyExact(drawer.openingFloat)} />
            <StatRow
              label="+ Cash collected"
              value={formatCurrencyExact(drawer.cashCollected)}
              tone="positive"
            />
            <StatRow
              label="− Cash refunds"
              value={formatCurrencyExact(drawer.cashRefunds)}
              tone="negative"
            />
            <StatRow
              label="− Cash payouts"
              value={formatCurrencyExact(drawer.cashPayouts)}
              tone="negative"
            />
            <StatRow
              label="− Cash drops"
              value={formatCurrencyExact(drawer.cashDrops)}
              tone="negative"
            />
            {!!drawer.otherAdjustments && (
              <StatRow
                label="± Other cash adjustments"
                value={formatCurrencyExact(drawer.otherAdjustments)}
                tone={drawer.otherAdjustments > 0 ? "positive" : "negative"}
              />
            )}
            <StatRow
              label="Expected in drawer"
              value={formatCurrencyExact(drawer.expectedInDrawer)}
              emphasis
            />
            <StatRow
              label="Closing cash (counted)"
              value={
                drawer.closingCash === null ? "—" : formatCurrencyExact(drawer.closingCash)
              }
            />
            <StatRow
              label="Difference"
              value={
                totals.difference === null ? "—" : formatCurrencyExact(totals.difference)
              }
              emphasis
              tone={
                totals.difference === null || totals.difference === 0
                  ? "default"
                  : totals.difference > 0
                    ? "positive"
                    : "negative"
              }
            />
          </div>

          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
            Cash only. UPI, card, exchange value and store credit never enter the
            drawer and are excluded.
          </p>
        </MetricPanel>

        {/* ── Denominations ────────────────────────────────────────────────── */}
        <MetricPanel
          title="Denomination count"
          description={
            data.denominations.length === 0
              ? "No denomination count was recorded for this shift."
              : undefined
          }
        >
          {data.denominations.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              The cashier entered a single total rather than counting by note.
            </p>
          ) : (
            <div className="space-y-0.5">
              {data.denominations.map((d) => (
                <StatRow
                  key={d.denomination}
                  label={`₹${d.denomination} × ${d.count}`}
                  value={formatCurrencyExact(d.value)}
                />
              ))}
              <StatRow
                label="Counted total"
                value={formatCurrencyExact(
                  data.denominations.reduce((sum, d) => sum + d.value, 0)
                )}
                emphasis
              />
            </div>
          )}
        </MetricPanel>
      </div>

      {/* ── Drops & payouts ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cash drops ({data.drops.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {data.drops.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No cash was moved to the safe on this shift.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {data.drops.map((drop) => (
                  <li key={drop.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{drop.dropNumber}</p>
                      <p className="truncate text-xs text-muted-foreground">{drop.reason}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(drop.createdAt)}
                        {drop.destination ? ` · ${drop.destination}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatCurrencyExact(drop.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cash payouts ({data.payouts.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {data.payouts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No expenses were paid from the drawer on this shift.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {data.payouts.map((payout) => (
                  <li key={payout.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-medium">{payout.payoutNumber}</p>
                        <Badge variant="secondary">
                          {PAYOUT_CATEGORY_LABELS[payout.category] ?? payout.category}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{payout.reason}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(payout.createdAt)}
                        {payout.payeeName ? ` · ${payout.payeeName}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatCurrencyExact(payout.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Timeline ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Shift timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityTimeline activities={data.activity} />
        </CardContent>
      </Card>

      {/* ── Reconcile dialog ───────────────────────────────────────────────── */}
      <Modal
        open={reconcileOpen}
        onClose={() => setReconcileOpen(false)}
        title="Reconcile this shift"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Signing off freezes this shift. Its summary can never change afterwards, which is
            what makes it usable as an audit record.
          </p>

          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{varianceLabel(totals.difference)}</p>
            {shift.discrepancyReason && (
              <p className="mt-1 text-muted-foreground">Reason: {shift.discrepancyReason}</p>
            )}
          </div>

          <Input
            label="Sign-off notes (optional)"
            value={reconcileNotes}
            onChange={(e) => setReconcileNotes(e.target.value)}
            placeholder="e.g. Verified against the safe, shortage accepted"
            disabled={reconcile.isPending}
          />

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button
              variant="outline"
              onClick={() => setReconcileOpen(false)}
              disabled={reconcile.isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={reconcile.isPending}
              onClick={() =>
                sessionId &&
                reconcile.mutate(
                  { registerId: sessionId, ...(reconcileNotes.trim() ? { notes: reconcileNotes.trim() } : {}) },
                  {
                    onSuccess: () => {
                      setReconcileOpen(false);
                      navigate("/register/history");
                    },
                  }
                )
              }
            >
              <ShieldCheck className="mr-1.5 h-4 w-4" />
              {reconcile.isPending ? "Signing off…" : "Reconcile Shift"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 truncate text-sm font-medium">{value}</div>
    </div>
  );
}
