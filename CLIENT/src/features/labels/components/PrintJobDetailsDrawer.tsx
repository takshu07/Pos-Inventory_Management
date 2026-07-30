/**
 * PrintJobDetailsDrawer — per-item breakdown of one print job.
 *
 * Item-level status is what makes a partial failure legible: a 40-label job
 * where 3 variants were deleted shows 37 COMPLETED and 3 FAILED with reasons,
 * rather than one opaque "failed" on the whole job.
 */

import { Printer } from "lucide-react";

import {
  Badge,
  Button,
  Drawer,
  LoadingSpinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";

import { usePrintJob, useReprintJob } from "../hooks/useLabels";
import { BarcodeRenderer } from "./BarcodeRenderer";
import { PrintJobStatusBadge } from "./PrintJobStatus";

export interface PrintJobDetailsDrawerProps {
  jobId: string | null;
  open: boolean;
  onClose: () => void;
}

const ITEM_STATUS_VARIANT = {
  PENDING: "secondary",
  PRINTING: "default",
  COMPLETED: "success",
  FAILED: "destructive",
  SKIPPED: "warning",
} as const;

export function PrintJobDetailsDrawer({
  jobId,
  open,
  onClose,
}: PrintJobDetailsDrawerProps) {
  const { data: job, isLoading } = usePrintJob(open ? jobId : null);
  const reprintMutation = useReprintJob();

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={job ? `Print job ${job.jobNumber}` : "Print job"}
      description={job?.reason ?? undefined}
      width="w-full max-w-2xl"
      footer={
        job && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button
              leftIcon={<Printer className="h-4 w-4" />}
              onClick={() =>
                reprintMutation.mutate({
                  jobId: job.id,
                  reason: `Reprint of ${job.jobNumber}`,
                })
              }
              loading={reprintMutation.isPending}
            >
              Reprint
            </Button>
          </div>
        )
      }
    >
      {isLoading || !job ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* ── Summary ────────────────────────────────────────────────────── */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="mt-1">
                <PrintJobStatusBadge
                  status={job.status}
                  failureReason={job.failureReason}
                />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Requested</dt>
              <dd className="mt-1">{new Date(job.createdAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">By</dt>
              <dd className="mt-1">
                {job.requestedBy.firstName} {job.requestedBy.lastName}
                <span className="ml-1 text-xs text-muted-foreground">
                  ({job.requestedBy.role})
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Printer</dt>
              <dd className="mt-1">{job.printer?.name ?? job.output}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Template</dt>
              <dd className="mt-1">{job.template.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Source</dt>
              <dd className="mt-1">{job.source}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Labels / copies</dt>
              <dd className="mt-1 tabular-nums">
                {job.totalLabels} / {job.totalCopies}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="mt-1 tabular-nums">
                {job.durationMs !== null ? `${(job.durationMs / 1000).toFixed(1)}s` : "—"}
              </dd>
            </div>
          </dl>

          {job.failureReason && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-sm font-medium text-destructive">Failure reason</p>
              <p className="mt-1 text-sm text-destructive/90">{job.failureReason}</p>
              {job.attempts > 1 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Attempted {job.attempts} of {job.maxAttempts} times.
                </p>
              )}
            </div>
          )}

          {/* ── Items ──────────────────────────────────────────────────────── */}
          <div>
            <h3 className="mb-2 text-sm font-medium">
              Products ({job.items?.length ?? 0})
            </h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead className="text-right">Copies</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(job.items ?? []).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-sm">
                        {item.variant.product.name}
                        {(item.variant.color || item.variant.size) && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            {[item.variant.color?.name, item.variant.size?.name]
                              .filter(Boolean)
                              .join(" / ")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.variant.sku}
                      </TableCell>
                      <TableCell>
                        {/* Rendered from the VALUE captured at queue time, so a
                            later catalog change never rewrites history. */}
                        <BarcodeRenderer
                          value={item.barcodeValue}
                          height={22}
                          showText
                          className="w-28"
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.copies}
                      </TableCell>
                      <TableCell>
                        <Badge variant={ITEM_STATUS_VARIANT[item.status] ?? "secondary"}>
                          {item.status}
                        </Badge>
                        {item.failureReason && (
                          <p className="mt-1 text-xs text-destructive">
                            {item.failureReason}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
