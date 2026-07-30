/**
 * PrintQueueTable — the live queue with cancel/retry controls.
 *
 * Shows only non-terminal jobs. Completed work belongs in the history table;
 * mixing them would bury the one job the user is actually waiting on.
 */

import { Ban, RefreshCw, RotateCcw } from "lucide-react";

import {
  Button,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from "@/components/ui";

import { useCancelJob, usePrintQueue, useRetryJob } from "../hooks/useLabels";
import { PrintJobStatusBadge } from "./PrintJobStatus";

export interface PrintQueueTableProps {
  /** Pause polling when the table is off-screen (e.g. an inactive tab). */
  enabled?: boolean;
}

export function PrintQueueTable({ enabled = true }: PrintQueueTableProps) {
  const { data: jobs, isLoading, refetch, isFetching } = usePrintQueue({ enabled });
  const cancelMutation = useCancelJob();
  const retryMutation = useRetryJob();

  if (isLoading) return <TableSkeleton rows={4} cols={7} />;

  if (!jobs || jobs.length === 0) {
    return (
      <EmptyState
        title="The print queue is empty"
        description="Queued jobs appear here while they wait for a printer."
        action={{ label: "Refresh", onClick: () => void refetch() }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {jobs.length} job{jobs.length === 1 ? "" : "s"} in the queue
        </p>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<RefreshCw className="h-4 w-4" />}
          onClick={() => void refetch()}
          loading={isFetching}
        >
          Refresh
        </Button>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Printer</TableHead>
              <TableHead className="text-right">Labels</TableHead>
              <TableHead>Requested by</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="font-mono text-xs">{job.jobNumber}</TableCell>

                <TableCell>
                  <PrintJobStatusBadge
                    status={job.status}
                    failureReason={job.failureReason}
                  />
                  {/* Attempt counter only appears once a retry has happened —
                      "1 of 3" on a healthy job is noise. */}
                  {job.attempts > 1 && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      attempt {job.attempts}/{job.maxAttempts}
                    </span>
                  )}
                </TableCell>

                <TableCell className="text-sm">{job.template.name}</TableCell>

                <TableCell className="text-sm">
                  {job.printer?.name ?? (
                    <span className="text-muted-foreground">
                      {job.output === "PDF" ? "PDF output" : "Not assigned"}
                    </span>
                  )}
                </TableCell>

                <TableCell className="text-right tabular-nums">
                  {job.totalCopies}
                </TableCell>

                <TableCell className="text-sm">
                  {job.requestedBy.firstName} {job.requestedBy.lastName}
                </TableCell>

                <TableCell>
                  <div className="flex justify-end gap-1">
                    {/* Only PENDING/FAILED can be retried; a QUEUED job is
                        already going to run. */}
                    {(job.status === "PENDING" || job.status === "FAILED") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                        onClick={() => retryMutation.mutate({ jobId: job.id })}
                        loading={
                          retryMutation.isPending &&
                          retryMutation.variables?.jobId === job.id
                        }
                      >
                        Retry
                      </Button>
                    )}

                    {/* A PRINTING job has bytes in flight and cannot be recalled. */}
                    {(job.status === "QUEUED" || job.status === "PENDING") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Ban className="h-3.5 w-3.5" />}
                        onClick={() => cancelMutation.mutate(job.id)}
                        loading={
                          cancelMutation.isPending &&
                          cancelMutation.variables === job.id
                        }
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
