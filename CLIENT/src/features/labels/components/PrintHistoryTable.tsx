/**
 * PrintHistoryTable — searchable, filterable print history with reprint.
 *
 * Two data sources behind one component:
 *   scope="own"  → /labels/jobs   (any role; the server scopes cashiers to self)
 *   scope="all"  → /owner/labels/history (OWNER only, every user's jobs)
 *
 * Keeping both in one component means the reprint/detail behaviour cannot drift
 * between the two screens.
 */

import * as React from "react";
import { Eye, Printer, Search } from "lucide-react";

import {
  Button,
  EmptyState,
  Input,
  Pagination,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from "@/components/ui";

import {
  usePrintHistory,
  usePrintJobs,
  useReprintJob,
} from "../hooks/useLabels";
import type { PrintJob, PrintJobStatus, PrintSourceModule } from "../api/labelApi";
import { PrintJobStatusBadge } from "./PrintJobStatus";
import { PrintJobDetailsDrawer } from "./PrintJobDetailsDrawer";

export interface PrintHistoryTableProps {
  /** "all" requires OWNER; "own" works for every role. */
  scope?: "own" | "all";
  pageSize?: number;
}

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "QUEUED", label: "Queued" },
  { value: "PENDING", label: "Waiting to retry" },
  { value: "PRINTING", label: "Printing" },
];

const SOURCE_OPTIONS = [
  { value: "", label: "All sources" },
  { value: "PRODUCT", label: "Product" },
  { value: "PURCHASE", label: "Purchase" },
  { value: "INVENTORY", label: "Inventory" },
  { value: "SEARCH", label: "Search" },
  { value: "BATCH", label: "Batch" },
  { value: "MANUAL", label: "Manual" },
];

/** Formats a duration for the history "Duration" column. */
function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function PrintHistoryTable({
  scope = "own",
  pageSize = 20,
}: PrintHistoryTableProps) {
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState("");
  const [source, setSource] = React.useState("");
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [detailJobId, setDetailJobId] = React.useState<string | null>(null);

  // Debounced search — a keystroke per request would hammer the API and, on a
  // network-latency-bound DB, feel worse than waiting.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const params = {
    page,
    limit: pageSize,
    ...(status && { status: status as PrintJobStatus }),
    ...(source && { source: source as PrintSourceModule }),
    ...(search && { search }),
  };

  // Both hooks must be CALLED unconditionally (rules of hooks), but only the
  // one matching `scope` may issue a request — the other is disabled outright.
  // Passing a dummy limit instead would still hit the API, and for scope="own"
  // that dummy call would be an OWNER-only endpoint returning 403 noise.
  const ownQuery = usePrintJobs(params, { enabled: scope === "own" });
  const allQuery = usePrintHistory(params, { enabled: scope === "all" });

  const query = scope === "all" ? allQuery : ownQuery;
  const reprintMutation = useReprintJob();

  const jobs: PrintJob[] = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          placeholder="Search job number, product, SKU…"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          leftElement={<Search className="h-4 w-4 text-muted-foreground" />}
        />
        <Select
          value={status}
          options={STATUS_OPTIONS}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        />
        <Select
          value={source}
          options={SOURCE_OPTIONS}
          onChange={(event) => {
            setSource(event.target.value);
            setPage(1);
          }}
        />
      </div>

      {query.isLoading ? (
        <TableSkeleton rows={6} cols={8} />
      ) : jobs.length === 0 ? (
        <EmptyState
          title="No print jobs found"
          description={
            search || status || source
              ? "No jobs match the current filters."
              : "Printed labels will appear here."
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Printer</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead className="text-right">Products</TableHead>
                  <TableHead className="text-right">Copies</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {new Date(job.createdAt).toLocaleString()}
                    </TableCell>

                    <TableCell className="font-mono text-xs">
                      {job.jobNumber}
                      {job.reprintOfId && (
                        <span className="ml-1 text-muted-foreground">(reprint)</span>
                      )}
                    </TableCell>

                    <TableCell className="text-sm">
                      {job.requestedBy.firstName} {job.requestedBy.lastName}
                    </TableCell>

                    <TableCell className="text-sm">
                      {job.printer?.name ?? (
                        <span className="text-muted-foreground">
                          {job.output === "PDF" ? "PDF" : "—"}
                        </span>
                      )}
                    </TableCell>

                    <TableCell className="text-sm">{job.template.name}</TableCell>

                    <TableCell className="text-right tabular-nums">
                      {job.totalLabels}
                    </TableCell>

                    <TableCell className="text-right tabular-nums">
                      {job.totalCopies}
                    </TableCell>

                    <TableCell>
                      <PrintJobStatusBadge
                        status={job.status}
                        failureReason={job.failureReason}
                      />
                    </TableCell>

                    <TableCell className="text-right tabular-nums text-sm">
                      {formatDuration(job.durationMs)}
                    </TableCell>

                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Eye className="h-3.5 w-3.5" />}
                          onClick={() => setDetailJobId(job.id)}
                        >
                          Details
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Printer className="h-3.5 w-3.5" />}
                          onClick={() =>
                            reprintMutation.mutate({
                              jobId: job.id,
                              reason: `Reprint of ${job.jobNumber}`,
                            })
                          }
                          loading={
                            reprintMutation.isPending &&
                            reprintMutation.variables?.jobId === job.id
                          }
                        >
                          Reprint
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {meta && meta.totalPages > 1 && (
            <Pagination
              currentPage={meta.page}
              totalPages={meta.totalPages}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      <PrintJobDetailsDrawer
        jobId={detailJobId}
        open={detailJobId !== null}
        onClose={() => setDetailJobId(null)}
      />
    </div>
  );
}
