/**
 * The sync indicator — the one piece of this feature a cashier ever looks at.
 *
 * ── What it is for ───────────────────────────────────────────────────────────
 * Not "is there internet". A cashier does not care about the network; they care
 * whether the sales they just rang up exist anywhere other than this machine.
 * Those two questions have different answers often enough to matter — a till
 * can be online and three days behind — so the indicator reports the SECOND one.
 *
 * ── Why offline is not styled as an error ────────────────────────────────────
 * Operating offline is the feature working exactly as designed, so it is shown
 * in a neutral, informational tone. Reserving red for states that actually need
 * a human is what keeps red meaningful; a till that shows an alarm every time
 * the broadband hiccups trains its operator to ignore alarms.
 *
 * The genuinely alarming state — change capture stopped, so sales are being
 * taken and not recorded — is the ONLY one that gets red and the only one that
 * says "call support".
 */

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  CloudOff,
  Loader2,
  RefreshCw,
  UploadCloud,
} from "lucide-react";

import { Button } from "@/components/ui";
import { cn } from "@/utils/cn";

import { useRunSync, useSyncHealthState } from "../hooks/useSync";
import type { SyncHealth, SyncStatus } from "../types";

// =============================================================================
// PRESENTATION
// =============================================================================

interface HealthPresentation {
  readonly label: string;
  readonly icon: typeof Check;
  /** Tailwind classes for the pill. */
  readonly tone: string;
  readonly srDescription: string;
}

const PRESENTATION: Record<SyncHealth, HealthPresentation> = {
  SYNCED: {
    label: "Synced",
    icon: Check,
    tone: "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-900",
    srDescription: "All work has been saved to the cloud.",
  },
  PENDING: {
    label: "Syncing",
    icon: UploadCloud,
    tone: "text-sky-700 bg-sky-50 border-sky-200 dark:text-sky-300 dark:bg-sky-950/40 dark:border-sky-900",
    srDescription: "Work is being uploaded to the cloud.",
  },
  OFFLINE: {
    label: "Offline",
    icon: CloudOff,
    // Neutral, not red: this is normal operation, not a fault.
    tone: "text-slate-700 bg-slate-100 border-slate-300 dark:text-slate-300 dark:bg-slate-800 dark:border-slate-700",
    srDescription:
      "Working offline. Sales are being saved on this machine and will upload when the connection returns.",
  },
  DEGRADED: {
    label: "Needs attention",
    icon: AlertTriangle,
    tone: "text-amber-800 bg-amber-50 border-amber-300 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-900",
    srDescription: "Some work could not be uploaded and needs review.",
  },
  BROKEN: {
    label: "Not recording",
    icon: AlertTriangle,
    tone: "text-red-800 bg-red-50 border-red-300 dark:text-red-300 dark:bg-red-950/40 dark:border-red-900",
    srDescription:
      "This till is not recording sales for upload. Contact support before continuing.",
  },
};

// =============================================================================
// HELPERS
// =============================================================================

function formatAge(seconds: number | null): string | null {
  if (seconds === null) return null;

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;

  return `${Math.floor(seconds / 86_400)}d ago`;
}

function formatLastSync(status: SyncStatus | undefined): string {
  const run = status?.lastUpload;
  if (run?.finishedAt == null) return "never";

  const elapsed = Math.floor((Date.now() - new Date(run.finishedAt).getTime()) / 1000);
  return formatAge(elapsed) ?? "just now";
}

// =============================================================================
// COMPONENT
// =============================================================================

export interface SyncIndicatorProps {
  /** Compact renders the pill only — for a crowded cashier header. */
  compact?: boolean;
  className?: string;
}

export function SyncIndicator({ compact = false, className }: SyncIndicatorProps) {
  const { data: status, health, isLoading } = useSyncHealthState();
  const runSync = useRunSync();
  const [expanded, setExpanded] = useState(false);

  // On a cloud deployment there is nothing to show — no queue, no local
  // database. Rendering "Synced" there would be a meaningless reassurance.
  if (status?.role === "cloud") return null;

  const presentation = PRESENTATION[health];
  const Icon = presentation.icon;

  const pending = status?.queue.pending ?? 0;
  const failed = status?.queue.failed ?? 0;
  const conflicted = status?.queue.conflicted ?? 0;
  const busy = status?.syncing === true || runSync.isPending;

  const pill = (
    <button
      type="button"
      onClick={() => {
        setExpanded((open) => !open);
      }}
      aria-expanded={expanded}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
        presentation.tone
      )}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Icon className="h-4 w-4" aria-hidden="true" />
      )}

      <span>{presentation.label}</span>

      {/* The count only appears when there IS something outstanding, so a
          quiet indicator stays quiet rather than showing a permanent "0". */}
      {pending > 0 && (
        <span className="rounded-full bg-black/10 px-1.5 text-xs tabular-nums dark:bg-white/10">
          {pending > 999 ? "999+" : pending}
        </span>
      )}

      {/* Screen readers get the meaning, not just the label — "Offline" alone
          does not tell someone whether their work is safe. */}
      <span className="sr-only">
        {isLoading ? "Checking synchronization status." : presentation.srDescription}
      </span>
    </button>
  );

  if (compact && !expanded) return <div className={className}>{pill}</div>;

  return (
    <div className={cn("relative", className)}>
      {pill}

      {expanded && (
        <div
          className={cn(
            "absolute right-0 z-50 mt-2 w-72 rounded-lg border bg-white p-4 shadow-lg",
            "dark:border-slate-700 dark:bg-slate-900"
          )}
        >
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Last upload</dt>
              <dd className="font-medium tabular-nums">{formatLastSync(status)}</dd>
            </div>

            <div className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Waiting to upload</dt>
              <dd className="font-medium tabular-nums">{pending}</dd>
            </div>

            {/* Age is shown only when it is old enough to be worth knowing.
                "oldest: just now" is noise on a healthy till. */}
            {status?.queue.oldestPendingAgeSeconds != null &&
              status.queue.oldestPendingAgeSeconds > 300 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">Oldest item</dt>
                  <dd className="font-medium">
                    {formatAge(status.queue.oldestPendingAgeSeconds)}
                  </dd>
                </div>
              )}

            {failed > 0 && (
              <div className="flex justify-between gap-4 text-amber-700 dark:text-amber-400">
                <dt>Failed</dt>
                <dd className="font-medium tabular-nums">{failed}</dd>
              </div>
            )}

            {conflicted > 0 && (
              <div className="flex justify-between gap-4 text-amber-700 dark:text-amber-400">
                <dt>Conflicts</dt>
                <dd className="font-medium tabular-nums">{conflicted}</dd>
              </div>
            )}
          </dl>

          {health === "BROKEN" && (
            <p className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              This till is not recording sales for upload. Keep serving customers,
              but contact support now — today&apos;s takings are not being captured.
            </p>
          )}

          {health === "OFFLINE" && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Carry on as normal. Everything is saved on this machine and uploads
              automatically when the connection returns.
            </p>
          )}

          <Button
            type="button"
            variant="secondary"
            className="mt-3 w-full"
            disabled={busy}
            onClick={() => {
              runSync.mutate("FULL");
            }}
          >
            <RefreshCw
              className={cn("mr-2 h-4 w-4", busy && "animate-spin")}
              aria-hidden="true"
            />
            {busy ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      )}
    </div>
  );
}
