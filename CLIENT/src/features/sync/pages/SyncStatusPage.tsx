/**
 * Synchronization — the operator screen.
 *
 * Answers three questions, in the order someone actually asks them when a till
 * is misbehaving:
 *
 *   1. Is anything wrong right now?          the health banner
 *   2. What is stuck, and can I unstick it?  the queue + retry
 *   3. What happened?                        run history and conflicts
 *
 * MANAGER and above. A cashier sees the indicator in the header — that is the
 * whole of what they need — but the per-record detail here exposes the shape of
 * the business data behind each failure, so it sits behind the same guard as
 * the other diagnostic surfaces in this system.
 */

import { useState } from "react";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";

import { Badge, Button, Card, EmptyState, ErrorState, TableSkeleton } from "@/components/ui";
import { cn } from "@/utils/cn";

import {
  useRetryFailedSync,
  useRunSync,
  useSyncConflicts,
  useSyncHealthState,
  useSyncHistory,
  useSyncQueue,
} from "../hooks/useSync";
import type { SyncRunStatus } from "../types";

// =============================================================================
// HELPERS
// =============================================================================

function formatTimestamp(value: string | null): string {
  if (value === null) return "—";
  return new Date(value).toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

const RUN_STATUS_TONE: Record<SyncRunStatus, string> = {
  SUCCESS: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  PARTIAL: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  INTERRUPTED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  RUNNING: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
};

type Tab = "queue" | "history" | "conflicts";

// =============================================================================
// PAGE
// =============================================================================

export function SyncStatusPage() {
  const { data: status, health, isLoading, isError } = useSyncHealthState();
  const runSync = useRunSync();
  const retry = useRetryFailedSync();

  const [tab, setTab] = useState<Tab>("queue");

  const history = useSyncHistory(50);
  // 100, not more. The /sync/queue endpoint would allow up to 500, but the
  // shared server pagination cap is 100 and a repo guard test enforces that
  // ceiling across the whole client — a limit above it has silently rendered
  // an empty screen three times in this codebase. The total count below the
  // tabs reports the real depth, so nothing is hidden by paging at 100.
  const queue = useSyncQueue({ limit: 100 });
  const conflicts = useSyncConflicts(50);

  if (isError && status === undefined) {
    return (
      <ErrorState
        title="Cannot read synchronization status"
        message="The local server did not answer. Synchronization state is unknown."
      />
    );
  }

  if (status?.role === "cloud") {
    return (
      <EmptyState
        title="This is the cloud server"
        description="Synchronization state lives on each in-store node. Open this page on a till to see its queue."
      />
    );
  }

  const busy = status?.syncing === true || runSync.isPending;

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Synchronization</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Device <span className="font-mono">{status?.deviceId || "unregistered"}</span>
            {" · "}
            operating on {status?.dataSource === "local" ? "the local database" : "the cloud"}
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              runSync.mutate("FULL");
            }}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", busy && "animate-spin")} />
            {busy ? "Syncing…" : "Sync now"}
          </Button>

          <Button
            variant="outline"
            disabled={retry.isPending || (status?.queue.failed ?? 0) === 0}
            onClick={() => {
              retry.mutate(undefined);
            }}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Retry failed
          </Button>
        </div>
      </div>

      {/* ── The alarm that beats everything else ──────────────────────────── */}
      {health === "BROKEN" && (
        <div className="flex gap-3 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
          <div className="text-sm text-red-800 dark:text-red-300">
            <p className="font-semibold">This till is not recording sales for upload.</p>
            <p className="mt-1">
              Change capture is not installed or has been disabled. The POS is still
              taking payments, but nothing since this started is queued to reach the
              cloud. Restart the node to reinstall capture, then run a consistency
              check. Do not close the day until this is resolved.
            </p>
          </div>
        </div>
      )}

      {/* ── Summary tiles ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryTile
          label="Waiting to upload"
          value={status?.queue.pending ?? 0}
          hint={
            status?.queue.oldestPendingAgeSeconds != null
              ? `oldest ${Math.floor(status.queue.oldestPendingAgeSeconds / 60)}m old`
              : undefined
          }
        />
        <SummaryTile
          label="Failed"
          value={status?.queue.failed ?? 0}
          tone={(status?.queue.failed ?? 0) > 0 ? "warn" : undefined}
        />
        <SummaryTile
          label="Conflicts"
          value={status?.queue.conflicted ?? 0}
          tone={(status?.queue.conflicted ?? 0) > 0 ? "warn" : undefined}
        />
        <SummaryTile
          label="Connection"
          value={status?.connectivity.state ?? "unknown"}
          hint={
            status?.connectivity.latencyMs != null
              ? `${status.connectivity.latencyMs}ms`
              : undefined
          }
        />
      </div>

      {/* ── Last runs ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
            Last upload
          </h2>
          <RunLine run={status?.lastUpload ?? null} />
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
            Last download
          </h2>
          <RunLine run={status?.lastDownload ?? null} />
        </Card>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-200 dark:border-slate-700">
        <nav className="flex gap-4" aria-label="Synchronization detail">
          {(
            [
              ["queue", `Queue${queue.data ? ` (${queue.data.total})` : ""}`],
              ["history", "History"],
              ["conflicts", `Conflicts${conflicts.data?.length ? ` (${conflicts.data.length})` : ""}`],
            ] as Array<[Tab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
              }}
              aria-current={tab === key ? "page" : undefined}
              className={cn(
                "border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
                tab === key
                  ? "border-primary text-primary"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "queue" && (
        <QueueTable
          isLoading={queue.isLoading || isLoading}
          items={queue.data?.items ?? []}
          onRetry={(id) => {
            retry.mutate([id]);
          }}
        />
      )}

      {tab === "history" && (
        <HistoryTable isLoading={history.isLoading} runs={history.data ?? []} />
      )}

      {tab === "conflicts" && (
        <ConflictTable isLoading={conflicts.isLoading} conflicts={conflicts.data ?? []} />
      )}
    </div>
  );
}

// =============================================================================
// PIECES
// =============================================================================

function SummaryTile(props: {
  label: string;
  value: number | string;
  hint?: string | undefined;
  tone?: "warn" | undefined;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {props.label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          props.tone === "warn" && "text-amber-700 dark:text-amber-400"
        )}
      >
        {props.value}
      </p>
      {props.hint !== undefined && (
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{props.hint}</p>
      )}
    </Card>
  );
}

function RunLine({ run }: { run: { status: SyncRunStatus; finishedAt: string | null; durationMs: number | null; itemsSucceeded: number; itemsFailed: number; error: string | null } | null }) {
  if (run === null) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Never run</p>;
  }

  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-2">
        <Badge className={RUN_STATUS_TONE[run.status]}>{run.status}</Badge>
        <span className="text-slate-500 dark:text-slate-400">
          {formatTimestamp(run.finishedAt)}
        </span>
      </div>
      <p className="text-slate-600 dark:text-slate-300">
        {run.itemsSucceeded} succeeded
        {run.itemsFailed > 0 && `, ${run.itemsFailed} failed`}
        {" · "}
        {formatDuration(run.durationMs)}
      </p>
      {run.error !== null && (
        <p className="text-xs text-red-700 dark:text-red-400">{run.error}</p>
      )}
    </div>
  );
}

function QueueTable(props: {
  isLoading: boolean;
  items: Array<{
    id: number;
    entity: string;
    entityId: string;
    operation: string;
    status: string;
    attempts: number;
    lastError: string | null;
    localTimestamp: string;
  }>;
  onRetry: (id: number) => void;
}) {
  if (props.isLoading) return <TableSkeleton />;

  if (props.items.length === 0) {
    return (
      <EmptyState
        title="Queue is empty"
        description="Everything this till has recorded has reached the cloud."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500 dark:text-slate-400">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Entity</th>
            <th className="px-3 py-2">Operation</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Attempts</th>
            <th className="px-3 py-2">Recorded</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => (
            <tr
              key={item.id}
              className="border-t border-slate-100 dark:border-slate-800"
            >
              <td className="px-3 py-2 font-mono text-xs tabular-nums">{item.id}</td>
              <td className="px-3 py-2">
                {item.entity}
                <span className="ml-1 font-mono text-xs text-slate-400">
                  {item.entityId.slice(0, 8)}
                </span>
              </td>
              <td className="px-3 py-2">{item.operation}</td>
              <td className="px-3 py-2">
                <Badge
                  className={
                    item.status === "FAILED" || item.status === "CONFLICT"
                      ? RUN_STATUS_TONE.FAILED
                      : item.status === "SYNCED"
                        ? RUN_STATUS_TONE.SUCCESS
                        : RUN_STATUS_TONE.RUNNING
                  }
                >
                  {item.status}
                </Badge>
                {item.lastError !== null && (
                  <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                    {item.lastError}
                  </p>
                )}
              </td>
              <td className="px-3 py-2 tabular-nums">{item.attempts}</td>
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                {formatTimestamp(item.localTimestamp)}
              </td>
              <td className="px-3 py-2 text-right">
                {item.status === "FAILED" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      props.onRetry(item.id);
                    }}
                  >
                    Retry
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTable(props: {
  isLoading: boolean;
  runs: Array<{
    id: string;
    direction: string;
    trigger: string;
    status: SyncRunStatus;
    startedAt: string;
    durationMs: number | null;
    itemsSucceeded: number;
    itemsFailed: number;
    itemsConflicted: number;
    error: string | null;
  }>;
}) {
  if (props.isLoading) return <TableSkeleton />;

  if (props.runs.length === 0) {
    return <EmptyState title="No sync runs yet" description="This till has not synchronized." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500 dark:text-slate-400">
          <tr>
            <th className="px-3 py-2">Started</th>
            <th className="px-3 py-2">Direction</th>
            <th className="px-3 py-2">Trigger</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Items</th>
            <th className="px-3 py-2">Duration</th>
          </tr>
        </thead>
        <tbody>
          {props.runs.map((run) => (
            <tr key={run.id} className="border-t border-slate-100 dark:border-slate-800">
              <td className="px-3 py-2">{formatTimestamp(run.startedAt)}</td>
              <td className="px-3 py-2">{run.direction}</td>
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{run.trigger}</td>
              <td className="px-3 py-2">
                <Badge className={RUN_STATUS_TONE[run.status]}>{run.status}</Badge>
                {run.error !== null && (
                  <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                    {run.error}
                  </p>
                )}
              </td>
              <td className="px-3 py-2 tabular-nums">
                {run.itemsSucceeded}
                {run.itemsFailed > 0 && (
                  <span className="text-red-600 dark:text-red-400">
                    {" "}/ {run.itemsFailed} failed
                  </span>
                )}
                {run.itemsConflicted > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {" "}/ {run.itemsConflicted} conflict
                  </span>
                )}
              </td>
              <td className="px-3 py-2 tabular-nums">{formatDuration(run.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConflictTable(props: {
  isLoading: boolean;
  conflicts: Array<{
    id: string;
    entity: string;
    entityId: string;
    resolution: string;
    reason: string;
    detectedAt: string;
  }>;
}) {
  if (props.isLoading) return <TableSkeleton />;

  if (props.conflicts.length === 0) {
    return (
      <EmptyState
        title="No conflicts"
        description="Nothing has been changed in two places at once since this till last synced."
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Stated explicitly because "conflict" reads as "data was lost" and here
          it is not — both versions are retained and recoverable. */}
      <p className="text-sm text-slate-500 dark:text-slate-400">
        A conflict means the same record changed here and in the cloud. Both
        versions are kept — nothing has been deleted.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Detected</th>
              <th className="px-3 py-2">Record</th>
              <th className="px-3 py-2">Kept</th>
              <th className="px-3 py-2">Why</th>
            </tr>
          </thead>
          <tbody>
            {props.conflicts.map((conflict) => (
              <tr
                key={conflict.id}
                className="border-t border-slate-100 dark:border-slate-800"
              >
                <td className="px-3 py-2">{formatTimestamp(conflict.detectedAt)}</td>
                <td className="px-3 py-2">
                  {conflict.entity}
                  <span className="ml-1 font-mono text-xs text-slate-400">
                    {conflict.entityId.slice(0, 8)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Badge>
                    {conflict.resolution === "CLOUD_WINS" ? "Cloud version" : "This till"}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                  {conflict.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default SyncStatusPage;
