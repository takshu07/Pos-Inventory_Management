/**
 * The Cash Register — the screen a cashier lives on for a whole shift.
 *
 * TWO STATES, ONE PAGE
 * --------------------
 * With no open drawer this is a single call to action, because nothing else on
 * the page would be true: no sale can be recorded, so no figure can be shown.
 * With a drawer open it becomes the live dashboard.
 *
 * Splitting these into two routes was the alternative, and it is worse: a
 * cashier arriving at "/register" after closing a shift would land on a page
 * that redirects, and the reason their POS is blocked would be one navigation
 * further away than it needs to be.
 */

import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  Banknote,
  Clock,
  CreditCard,
  FileText,
  IndianRupee,
  LockOpen,
  Printer,
  Receipt,
  RefreshCw,
  Smartphone,
  TrendingDown,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import {
  AnimatedNumber,
  KpiCard,
  KpiGrid,
  KpiGridSkeleton,
  MetricPanel,
  PageHeader,
  SectionHeader,
  StatRow,
  downloadExport,
  formatCurrency,
  formatCurrencyExact,
  formatDateTime,
  formatNumber,
  REGISTER_STATUS_LABELS,
  REGISTER_STATUS_VARIANTS,
} from "@/components/shared/bi";
import { useAuthStore } from "@/store/auth.store";

import {
  useLiveRegister,
  useRegisterNumbers,
  useOpenRegister,
  useCloseRegister,
  useCreateCashDrop,
  useCreateCashPayout,
  useClosePreview,
} from "../hooks/useRegister";
import {
  CashDropDialog,
  CashPayoutDialog,
  CloseRegisterDialog,
  OpenRegisterDialog,
} from "../components/RegisterDialogs";
import { ActivityTimeline } from "../components/ActivityTimeline";

/**
 * One tender's contribution to the shift, with its share of the total.
 *
 * The share is the reason this is a tile and not another StatRow: "₹880" only
 * becomes meaningful next to "31% of takings", and that comparison is the
 * question the panel exists to answer.
 */
function TenderTile({
  label,
  icon: Icon,
  amount,
  total,
  accent,
}: {
  label: string;
  icon: LucideIcon;
  amount: number;
  total: number;
  accent: string;
}) {
  // Guard the empty shift: 0/0 is NaN, which would render as "NaN% of takings".
  const share = total > 0 ? (amount / total) * 100 : 0;

  return (
    // The accent sits on the container so the icon and the bar below both
    // inherit it via currentColor.
    <div className={`rounded-lg border border-border p-3 ${accent}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {label}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {total > 0 ? `${share.toFixed(0)}%` : "—"}
        </span>
      </div>

      <p className="mt-1.5 text-lg font-semibold tabular-nums leading-tight text-foreground">
        {formatCurrencyExact(amount)}
      </p>

      {/* Decorative only — the percentage above is the accessible carrier. */}
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className="h-full rounded-full bg-current opacity-70 transition-[width] duration-500"
          style={{ width: `${Math.min(100, share)}%` }}
        />
      </div>
    </div>
  );
}

export default function CashRegisterPage() {
  const role = useAuthStore((s) => s.user?.role);

  const { data: live, isLoading, refetch, isFetching } = useLiveRegister();
  const { data: registerNumbers = [] } = useRegisterNumbers();

  const [openDialog, setOpenDialog] = useState<null | "open" | "drop" | "payout" | "close">(null);

  const openRegister = useOpenRegister();
  const closeRegister = useCloseRegister();
  const createDrop = useCreateCashDrop();
  const createPayout = useCreateCashPayout();

  const session = live?.session ?? null;
  const registerId = session?.id;
  const isOpen = live?.hasOpenSession ?? false;

  // The close preview is only fetched while the dialog is open. It is
  // deliberately uncached (staleTime 0), so fetching it eagerly would issue a
  // request on every dashboard poll for a dialog nobody opened.
  const closePreview = useClosePreview(registerId, openDialog === "close");

  const expectedCash = live?.position?.expectedCash ?? 0;

  const tenderRows = useMemo(
    () => [
      { label: "Cash", value: live?.sales?.cash ?? 0, icon: IndianRupee },
      { label: "UPI", value: live?.sales?.upi ?? 0, icon: Smartphone },
      { label: "Card", value: live?.sales?.card ?? 0, icon: CreditCard },
      { label: "Other tenders", value: live?.sales?.other ?? 0, icon: Wallet },
    ],
    [live?.sales]
  );

  // The one-glance answer to "what did this shift take, and in what form?".
  //
  // The two panels below it each answer a narrower question — what was rung up
  // (sales ledger) and what should be in the drawer (cash ledger) — and those
  // are deliberately different numbers: a card sale never touches the till, and
  // a cash exchange top-up touches it without being a sale. Reading one panel
  // expecting the other's answer is the confusion this section removes, so it
  // states the collected total AND names the split rather than implying the
  // tender rows and the drawer figure should reconcile to each other.
  //
  // These totals are computed SERVER-SIDE in the cash-register engine, not here.
  // Re-deriving them in the component is how the screen and the printed summary
  // drift apart, and it puts currency arithmetic into IEEE-754 floats.
  const collected = useMemo(
    () => ({
      cash: live?.collected?.cash ?? 0,
      upi: live?.collected?.upi ?? 0,
      card: live?.collected?.card ?? 0,
      other: live?.collected?.other ?? 0,
      digital: live?.collected?.digital ?? 0,
      totalCollected: live?.collected?.totalCollected ?? 0,
      cashRefunds: live?.collected?.cashRefunds ?? 0,
      storeCreditRefunds: live?.collected?.storeCreditRefunds ?? 0,
      netCollected: live?.collected?.netCollected ?? 0,
      exchangeTopUps: live?.collected?.exchangeTopUps ?? 0,
      exchangeValue: live?.sales?.exchangeValue ?? 0,
    }),
    [live?.collected, live?.sales?.exchangeValue]
  );

  const drawer = live?.drawer ?? null;

  // ── No open drawer ────────────────────────────────────────────────────────
  if (!isLoading && !isOpen) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Cash Register"
          description="Open your drawer to start selling. Every sale is recorded against a register session."
        />

        <Card className="mx-auto max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <span className="rounded-full bg-muted p-4">
              <Wallet className="h-8 w-8 text-muted-foreground" aria-hidden />
            </span>

            <div>
              <h2 className="text-lg font-semibold">No register is open</h2>
              <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
                A sale cannot be recorded without an open drawer. Count your opening float and
                open the register to begin your shift.
              </p>
            </div>

            <Button size="lg" onClick={() => setOpenDialog("open")}>
              <LockOpen className="mr-2 h-4 w-4" />
              Open Register
            </Button>
          </CardContent>
        </Card>

        <OpenRegisterDialog
          open={openDialog === "open"}
          onClose={() => setOpenDialog(null)}
          isSubmitting={openRegister.isPending}
          registerNumbers={registerNumbers}
          onSubmit={(payload) =>
            openRegister.mutate(payload, { onSuccess: () => setOpenDialog(null) })
          }
        />
      </div>
    );
  }

  // ── Live drawer ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cash Register"
        description={
          session
            ? `${session.registerNumber} · ${session.employee?.name ?? "—"} · opened ${formatDateTime(session.openedAt)}`
            : undefined
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>

            {registerId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void downloadExport(`/register/${registerId}/summary/export`, "pdf")
                }
              >
                <Printer className="mr-1.5 h-3.5 w-3.5" />
                Shift Summary
              </Button>
            )}

            <Button variant="outline" size="sm" onClick={() => setOpenDialog("drop")}>
              <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />
              Cash Drop
            </Button>

            <Button variant="outline" size="sm" onClick={() => setOpenDialog("payout")}>
              <Receipt className="mr-1.5 h-3.5 w-3.5" />
              Payout
            </Button>

            <Button size="sm" onClick={() => setOpenDialog("close")}>
              <Banknote className="mr-1.5 h-3.5 w-3.5" />
              Close Register
            </Button>
          </>
        }
      />

      {/* ── Status strip ───────────────────────────────────────────────────── */}
      {session && (
        <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge variant={REGISTER_STATUS_VARIANTS[session.status] ?? "secondary"}>
              {REGISTER_STATUS_LABELS[session.status] ?? session.status}
            </Badge>
            <span className="text-sm font-medium">
              {session.sessionNumber ?? session.registerNumber}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {live?.shift?.elapsedLabel ?? session.durationLabel} elapsed
            </span>
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Expected in drawer</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatCurrencyExact(expectedCash)}
            </p>
          </div>
        </Card>
      )}

      {/* ── Headline metrics ───────────────────────────────────────────────── */}
      {isLoading ? (
        <KpiGridSkeleton count={4} />
      ) : (
        <KpiGrid columns={4}>
          <KpiCard
            label="Opening Cash"
            value={live?.position?.openingCash ?? 0}
            format={formatCurrency}
            icon={Wallet}
            hint="Float at the start of this shift"
          />
          <KpiCard
            label="Cash Sales"
            value={live?.sales?.cash ?? 0}
            format={formatCurrency}
            icon={IndianRupee}
            accent="success"
            hint={`${formatNumber(live?.sales?.transactionCount ?? 0)} transactions today`}
          />
          <KpiCard
            label="Expected Cash"
            value={expectedCash}
            format={formatCurrency}
            icon={Banknote}
            accent="info"
            hint="Opening + cash in − cash out"
          />
          <KpiCard
            label="Drops & Payouts"
            value={(live?.drops?.total ?? 0) + (live?.payouts?.total ?? 0)}
            format={formatCurrency}
            icon={TrendingDown}
            accent="warning"
            hint={`${live?.drops?.count ?? 0} drops · ${live?.payouts?.count ?? 0} payouts`}
          />
        </KpiGrid>
      )}

      {/* ── Total collected ────────────────────────────────────────────────── */}
      <MetricPanel
        title="Total collected this shift"
        description="Every rupee taken, and the form it came in"
        isLoading={isLoading}
      >
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {/* The headline. Sized so it wins against the four KPI cards above,
              because this is the number a cashier is actually looking for. */}
          <div className="flex flex-col justify-center rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total money collected
            </p>
            <p className="mt-1.5 text-3xl font-semibold leading-tight tracking-tight">
              <AnimatedNumber value={collected.totalCollected} format={formatCurrencyExact} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Cash + UPI + Card + other tenders, across sales and exchanges
            </p>

            <div className="mt-3 space-y-0.5 border-t border-border pt-2">
              {/* Only CASH refunds are deducted. A refund issued as store credit
                  hands over a balance, not money — the shop still holds every
                  rupee it took, so subtracting it would understate takings. */}
              <StatRow
                label="− Cash refunds paid back"
                value={formatCurrencyExact(collected.cashRefunds)}
                tone="negative"
              />
              <StatRow
                label="Net collected"
                value={formatCurrencyExact(collected.netCollected)}
                emphasis
              />
              {collected.storeCreditRefunds > 0 && (
                <StatRow
                  label="Store credit issued (not cash)"
                  value={formatCurrencyExact(collected.storeCreditRefunds)}
                  tone="muted"
                />
              )}
            </div>
          </div>

          {/* The breakdown. Each row carries its share of the total, so "how
              much of today was UPI?" is answered without mental arithmetic. */}
          <div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TenderTile
                label="Cash"
                icon={IndianRupee}
                amount={collected.cash}
                total={collected.totalCollected}
                accent="text-emerald-600 dark:text-emerald-400"
              />
              <TenderTile
                label="UPI"
                icon={Smartphone}
                amount={collected.upi}
                total={collected.totalCollected}
                accent="text-blue-600 dark:text-blue-400"
              />
              <TenderTile
                label="Card"
                icon={CreditCard}
                amount={collected.card}
                total={collected.totalCollected}
                accent="text-violet-600 dark:text-violet-400"
              />
              <TenderTile
                label="Other tenders"
                icon={Wallet}
                amount={collected.other}
                total={collected.totalCollected}
                accent="text-amber-600 dark:text-amber-400"
              />
            </div>

            <div className="mt-3 space-y-0.5 border-t border-border pt-2">
              <StatRow
                label="Digital (UPI + Card)"
                value={formatCurrencyExact(collected.digital)}
                tone="muted"
              />
              <StatRow
                label="Expected in drawer (cash only)"
                value={formatCurrencyExact(expectedCash)}
                tone="muted"
              />
            </div>

            {/* Exchange value is merchandise, not money. It sat next to the cash
                rows before, which invited a cashier to add it into a total it
                has no part in — so it is now fenced off and labelled. */}
            <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/20 p-2.5">
              <p className="text-xs font-medium text-muted-foreground">
                Informational — not money
              </p>
              <div className="mt-1 space-y-0.5">
                <StatRow
                  label={`Exchange value issued · ${formatNumber(live?.sales?.exchangeCount ?? 0)}`}
                  value={formatCurrencyExact(collected.exchangeValue)}
                  tone="muted"
                />
                <StatRow
                  label="Store credit refunds"
                  value={formatCurrencyExact(collected.storeCreditRefunds)}
                  tone="muted"
                />
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Goods and account credit. Excluded from every total above.
              </p>
            </div>

            {/* Named explicitly because the drawer figure and the tender total
                are different by design, and a cashier who does not know that
                reads the gap as a shortage. */}
            <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
              Only cash reaches the drawer — UPI and card settle to the bank. The
              drawer figure also includes your opening float, drops and payouts,
              so it will not match the total above.
            </p>
          </div>
        </div>
      </MetricPanel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ── Tender breakdown ─────────────────────────────────────────────── */}
        <MetricPanel
          title="Money in by tender"
          description="Sales and exchange top-ups taken this shift"
          isLoading={isLoading}
        >
          <div className="space-y-0.5">
            {tenderRows.map((row) => (
              <StatRow
                key={row.label}
                label={row.label}
                value={formatCurrencyExact(row.value)}
              />
            ))}
            {/* The tender rows sum to money COLLECTED, which includes exchange
                top-ups. Labelling that sum "Gross sales" was wrong: it would
                not equal the sales figure it named whenever an exchange took
                cash across the counter. */}
            <StatRow
              label="Total collected"
              value={formatCurrencyExact(collected.totalCollected)}
              emphasis
            />
            <StatRow
              label="of which: gross sales"
              value={formatCurrencyExact(live?.sales?.gross ?? 0)}
              tone="muted"
            />
            <StatRow
              label="of which: exchange top-ups"
              value={formatCurrencyExact(collected.exchangeTopUps)}
              tone="muted"
            />
            <StatRow
              label="Split payments"
              value={formatCurrencyExact(live?.sales?.split ?? 0)}
              tone="muted"
            />
            <StatRow
              label="Discounts given"
              value={formatCurrencyExact(live?.sales?.discounts ?? 0)}
              tone="muted"
            />
          </div>
        </MetricPanel>

        {/* ── Drawer reconciliation ────────────────────────────────────────── */}
        <MetricPanel
          title="Drawer position"
          description="How the expected balance is built"
          isLoading={isLoading}
        >
          {/* Each line is a real cash movement, and they sum to the total. A
              cashier who counts short can walk this list to find where the gap
              is — which is the whole reason the components are shown at all
              rather than a single "expected" assertion. */}
          <div className="space-y-0.5">
            <StatRow
              label="Opening float"
              value={formatCurrencyExact(drawer?.openingFloat ?? 0)}
            />
            <StatRow
              label="+ Cash collected"
              value={formatCurrencyExact(drawer?.cashCollected ?? 0)}
              tone="positive"
            />
            <StatRow
              label="− Cash refunds"
              value={formatCurrencyExact(drawer?.cashRefunds ?? 0)}
              tone="negative"
            />
            <StatRow
              label="− Cash payouts"
              value={formatCurrencyExact(drawer?.cashPayouts ?? 0)}
              tone="negative"
            />
            <StatRow
              label="− Cash drops"
              value={formatCurrencyExact(drawer?.cashDrops ?? 0)}
              tone="negative"
            />
            {/* Only shown when non-zero: a permanent "± ₹0.00" row trains the
                eye to skip the line that matters when it finally isn't zero. */}
            {!!drawer?.otherAdjustments && (
              <StatRow
                label="± Other cash adjustments"
                value={formatCurrencyExact(drawer.otherAdjustments)}
                tone={drawer.otherAdjustments > 0 ? "positive" : "negative"}
              />
            )}
            <StatRow
              label="Expected in drawer"
              value={formatCurrencyExact(drawer?.expectedInDrawer ?? expectedCash)}
              emphasis
            />
          </div>

          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
            Cash only. UPI, card, exchange value and store credit are excluded —
            they never enter the drawer.
          </p>
        </MetricPanel>

        {/* ── Returns & exchanges ──────────────────────────────────────────── */}
        <MetricPanel
          title="Returns & exchanges"
          description="Goods that came back this shift"
          isLoading={isLoading}
        >
          <div className="space-y-0.5">
            <StatRow
              label="Exchanges"
              value={formatNumber(live?.sales?.exchangeCount ?? 0)}
            />
            <StatRow
              label="Exchange value issued"
              value={formatCurrencyExact(live?.sales?.exchangeValue ?? 0)}
              tone="muted"
            />
            <StatRow
              label="Refunds"
              value={formatNumber(live?.sales?.refundCount ?? 0)}
            />
            <StatRow
              label="Store credit issued"
              value={formatCurrencyExact(live?.sales?.storeCreditRefunds ?? 0)}
              tone="muted"
            />
            {/* Cash is the last and emphasised row because it is the only one
                of the three that the drawer has to answer for. */}
            <StatRow
              label="Refunded in cash"
              value={formatCurrencyExact(live?.sales?.refunds ?? 0)}
              tone="negative"
              emphasis
            />
          </div>

          {session?.notes && (
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-2.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <FileText className="h-3.5 w-3.5" aria-hidden />
                Shift note
              </p>
              <p className="mt-1 text-sm">{session.notes}</p>
            </div>
          )}
        </MetricPanel>
      </div>

      {/* ── Timeline ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Shift activity</CardTitle>
        </CardHeader>
        <CardContent>
          <SectionHeader
            title="Most recent first"
            description="Every event that moved — or could have moved — the drawer"
            className="mb-4"
          />
          <ActivityTimeline
            activities={live?.recentActivity ?? []}
            isLoading={isLoading}
            emptyMessage="No activity yet. Ring up a sale and it will appear here."
          />
        </CardContent>
      </Card>

      {/* ── Dialogs ────────────────────────────────────────────────────────── */}
      <CashDropDialog
        open={openDialog === "drop"}
        onClose={() => setOpenDialog(null)}
        isSubmitting={createDrop.isPending}
        expectedCash={expectedCash}
        onSubmit={(payload) =>
          registerId &&
          createDrop.mutate(
            { registerId, payload },
            { onSuccess: () => setOpenDialog(null) }
          )
        }
      />

      <CashPayoutDialog
        open={openDialog === "payout"}
        onClose={() => setOpenDialog(null)}
        isSubmitting={createPayout.isPending}
        expectedCash={expectedCash}
        onSubmit={(payload) =>
          registerId &&
          createPayout.mutate(
            { registerId, payload },
            { onSuccess: () => setOpenDialog(null) }
          )
        }
      />

      <CloseRegisterDialog
        open={openDialog === "close"}
        onClose={() => setOpenDialog(null)}
        isSubmitting={closeRegister.isPending}
        preview={closePreview.data}
        isLoadingPreview={closePreview.isLoading}
        onSubmit={(payload) =>
          registerId &&
          closeRegister.mutate(
            { registerId, payload },
            { onSuccess: () => setOpenDialog(null) }
          )
        }
      />

      {/* Owners and managers also reach the history screen; a cashier only ever
          sees their own sessions there, so the link is shown to everyone. */}
      {role && (
        <p className="text-center text-xs text-muted-foreground">
          Looking for a previous shift? Open <strong>Register History</strong> from the sidebar.
        </p>
      )}
    </div>
  );
}
