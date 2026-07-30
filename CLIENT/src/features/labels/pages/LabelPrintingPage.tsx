/**
 * LabelPrintingPage — the operational label screen (MANAGER + OWNER).
 *
 * Deliberately NOT an admin screen: it shows the live queue and the user's own
 * print history, both of which a manager needs to run the floor. Printer and
 * template configuration lives on the owner-only settings page.
 */

import * as React from "react";
import { Layers, Printer } from "lucide-react";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { useAuthStore } from "@/store/auth.store";
import {
  canBatchPrintLabels,
  canViewPrintHistory,
} from "@/features/auth/utils/permissions";

import { BatchPrintDialog } from "../components/BatchPrintDialog";
import { PrintHistoryTable } from "../components/PrintHistoryTable";
import { PrintQueueTable } from "../components/PrintQueueTable";
import { useQueueStats } from "../hooks/useLabels";

function StatTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warning" | "danger" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "success"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-foreground";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

export default function LabelPrintingPage() {
  const role = useAuthStore((state) => state.user?.role ?? null);
  const { data: stats } = useQueueStats();
  const [batchOpen, setBatchOpen] = React.useState(false);

  const counts = stats?.counts;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Label Printing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Print queue and print history. Jobs are processed one at a time, so
            nothing is lost if a printer is offline.
          </p>
        </div>

        {canBatchPrintLabels(role) && (
          <Button
            leftIcon={<Layers className="h-4 w-4" />}
            onClick={() => setBatchOpen(true)}
          >
            Batch print
          </Button>
        )}
      </div>

      {counts && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Queued" value={counts.QUEUED} />
          <StatTile label="Printing" value={counts.PRINTING} />
          <StatTile label="Awaiting retry" value={counts.PENDING} tone="warning" />
          <StatTile label="Completed" value={counts.COMPLETED} tone="success" />
          <StatTile label="Failed" value={counts.FAILED} tone="danger" />
          <StatTile label="Cancelled" value={counts.CANCELLED} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Printer className="h-4 w-4" />
            Print queue
          </CardTitle>
          <CardDescription>
            Live view of jobs waiting for or currently using a printer.
            {stats?.worker && !stats.worker.running && (
              <span className="ml-1 text-destructive">
                The print worker is not running — jobs will queue but not print.
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PrintQueueTable />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {canViewPrintHistory(role) ? "Print history" : "My print history"}
          </CardTitle>
          <CardDescription>
            {canViewPrintHistory(role)
              ? "Every print job across all users."
              : "Jobs you have printed."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Owners get the cross-user endpoint; everyone else sees their own. */}
          <PrintHistoryTable scope={canViewPrintHistory(role) ? "all" : "own"} />
        </CardContent>
      </Card>

      <BatchPrintDialog open={batchOpen} onClose={() => setBatchOpen(false)} />
    </div>
  );
}
