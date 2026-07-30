/**
 * PrintJobStatus — status badge for a print job, plus a self-resolving inline
 * tracker.
 *
 * The tracker exists because printing is asynchronous: the user clicks Print,
 * gets a queued job, and needs to know how it ended without hunting through the
 * queue screen. It polls only until the job reaches a terminal state.
 */

import {
  Ban,
  CheckCircle2,
  Clock,
  Loader2,
  Printer,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui";
import { cn } from "@/utils/cn";

import { usePrintJob } from "../hooks/useLabels";
import type { PrintJobStatus as JobStatus } from "../api/labelApi";

const STATUS_CONFIG: Record<
  JobStatus,
  {
    label: string;
    variant: "default" | "success" | "warning" | "destructive" | "secondary";
    Icon: typeof Clock;
    spin?: boolean;
  }
> = {
  QUEUED: { label: "Queued", variant: "secondary", Icon: Clock },
  PENDING: { label: "Waiting to retry", variant: "warning", Icon: Clock },
  PRINTING: { label: "Printing", variant: "default", Icon: Loader2, spin: true },
  COMPLETED: { label: "Completed", variant: "success", Icon: CheckCircle2 },
  FAILED: { label: "Failed", variant: "destructive", Icon: XCircle },
  CANCELLED: { label: "Cancelled", variant: "secondary", Icon: Ban },
};

export interface PrintJobStatusBadgeProps {
  status: JobStatus;
  /** Shown as a tooltip for FAILED jobs. */
  failureReason?: string | null;
  className?: string;
}

export function PrintJobStatusBadge({
  status,
  failureReason,
  className,
}: PrintJobStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.QUEUED;
  const { Icon } = config;

  return (
    <Badge
      variant={config.variant}
      className={cn("gap-1", className)}
      title={failureReason ?? config.label}
    >
      <Icon className={cn("h-3 w-3", config.spin && "animate-spin")} />
      {config.label}
    </Badge>
  );
}

export interface PrintJobTrackerProps {
  jobId: string | null;
  onDone?: (status: JobStatus) => void;
  className?: string;
}

/**
 * Inline tracker for a single job. Polls until terminal, then stops.
 *
 * Render this next to a Print button to give immediate, self-updating feedback
 * without navigating to the queue.
 */
export function PrintJobTracker({ jobId, onDone, className }: PrintJobTrackerProps) {
  const { data: job } = usePrintJob(jobId);

  if (!jobId || !job) return null;

  const terminal =
    job.status === "COMPLETED" ||
    job.status === "FAILED" ||
    job.status === "CANCELLED";

  if (terminal) onDone?.(job.status);

  return (
    <div className={cn("flex items-center gap-2 text-sm", className)}>
      <Printer className="h-4 w-4 text-muted-foreground" />
      <span className="font-mono text-xs">{job.jobNumber}</span>
      <PrintJobStatusBadge status={job.status} failureReason={job.failureReason} />
      {job.status === "COMPLETED" && job.durationMs !== null && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {(job.durationMs / 1000).toFixed(1)}s
        </span>
      )}
      {job.status === "FAILED" && job.failureReason && (
        <span className="text-xs text-destructive">{job.failureReason}</span>
      )}
    </div>
  );
}
