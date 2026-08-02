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
} from "lucide-react";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import {
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ── Tender breakdown ─────────────────────────────────────────────── */}
        <MetricPanel
          title="Sales by tender"
          description="Everything rung up on this shift"
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
            <StatRow
              label="Gross sales"
              value={formatCurrencyExact(live?.sales?.gross ?? 0)}
              emphasis
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
          <div className="space-y-0.5">
            <StatRow
              label="Opening cash"
              value={formatCurrencyExact(live?.position?.openingCash ?? 0)}
            />
            <StatRow
              label="+ Cash received"
              value={formatCurrencyExact(live?.position?.cashIn ?? 0)}
              tone="positive"
            />
            <StatRow
              label="− Cash out"
              value={formatCurrencyExact(live?.position?.cashOut ?? 0)}
              tone="negative"
            />
            <StatRow
              label="Expected cash"
              value={formatCurrencyExact(expectedCash)}
              emphasis
            />
            <div className="pt-2">
              <StatRow
                label="Cash drops"
                value={formatCurrencyExact(live?.drops?.total ?? 0)}
                tone="muted"
              />
              <StatRow
                label="Cash payouts"
                value={formatCurrencyExact(live?.payouts?.total ?? 0)}
                tone="muted"
              />
              <StatRow
                label="Refunds paid out"
                value={formatCurrencyExact(live?.sales?.refunds ?? 0)}
                tone="muted"
              />
            </div>
          </div>
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
            />
            <StatRow
              label="Refunds"
              value={formatNumber(live?.sales?.refundCount ?? 0)}
            />
            <StatRow
              label="Refund value"
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
