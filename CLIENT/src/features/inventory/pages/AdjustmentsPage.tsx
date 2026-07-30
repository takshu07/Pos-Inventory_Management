/**
 * Stock Adjustments — the approval queue.
 *
 * Pending requests come first and are visually distinct, because this screen
 * exists to answer "what is waiting on me". A chronological list that buries
 * three pending approvals under fifty historical ones would defeat the point of
 * having an approval step at all.
 *
 * Approve/reject is OWNER-only: the endpoint is absent from the manager route
 * tree entirely, and the service refuses a non-owner reviewer independently.
 */

import { useState } from "react";
import { ClipboardCheck, Check, X } from "lucide-react";

import {
  Button, Card, EmptyState, ErrorState, Input, Modal, Pagination, Select,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui";
import { canManageEmployees } from "@/features/auth";
import { useAuthStore } from "@/store/auth.store";
import { cn } from "@/utils/cn";
import {
  AdjustmentStatusBadge,
  DeltaCell,
  InventoryTableSkeleton,
  ProductCell,
} from "../components/InventoryAtoms";
import { InventoryExportMenu } from "../components/InventoryExportMenu";
import { useAdjustments, useReviewAdjustment } from "../hooks/useInventory";
import {
  ADJUSTMENT_REASON_LABELS,
  formatDateTime,
  formatNumber,
  formatVariantName,
} from "../utils/format";
import type { Adjustment, AdjustmentStatus } from "../types";

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "All adjustments" },
  { value: "PENDING", label: "Pending approval" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

export default function AdjustmentsPage() {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const canReview = canManageEmployees(role);

  const [status, setStatus] = useState<AdjustmentStatus | "">("");
  const [page, setPage] = useState(1);
  const [rejecting, setRejecting] = useState<Adjustment | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  const { data, isLoading, isError, refetch } = useAdjustments({
    page,
    limit: PAGE_SIZE,
    ...(status ? { status } : {}),
  });

  const review = useReviewAdjustment();

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const pendingCount = rows.filter((r) => r.status === "PENDING").length;

  const approve = (id: string) => {
    review.mutate({ id, payload: { approve: true } });
  };

  const confirmReject = () => {
    if (!rejecting || !rejectNotes.trim()) return;
    review.mutate(
      { id: rejecting.id, payload: { approve: false, reviewNotes: rejectNotes.trim() } },
      {
        onSuccess: () => {
          setRejecting(null);
          setRejectNotes("");
        },
      }
    );
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stock Adjustments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manual corrections to stock. Nothing changes until an owner approves.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select
            className="w-auto min-w-[11rem]"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as AdjustmentStatus | "");
              setPage(1);
            }}
            aria-label="Filter by status"
          />
          <InventoryExportMenu
            report="adjustments"
            filters={{ ...(status ? { status } : {}) }}
            disabled={rows.length === 0}
          />
        </div>
      </div>

      {canReview && pendingCount > 0 && (
        <Card className="flex items-center gap-3 border-amber-500/40 bg-amber-500/[0.05] p-3">
          <ClipboardCheck
            className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <p className="text-sm">
            <span className="font-medium">
              {pendingCount} adjustment{pendingCount === 1 ? "" : "s"}
            </span>{" "}
            <span className="text-muted-foreground">
              waiting for your approval on this page.
            </span>
          </p>
        </Card>
      )}

      {isError ? (
        <ErrorState message="Failed to load adjustments." onRetry={() => refetch()} />
      ) : !isLoading && rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-8 w-8 text-muted-foreground" />}
          title="No adjustments"
          description="Stock corrections requested from the inventory drawer will appear here for approval."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requested</TableHead>
                <TableHead className="min-w-[16rem]">Product</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Stock Then</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>By</TableHead>
                {canReview && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <InventoryTableSkeleton columns={canReview ? 8 : 7} />
              ) : (
                rows.map((a) => (
                  <TableRow
                    key={a.id}
                    className={cn(
                      // Pending rows are tinted so they are findable while
                      // scrolling, not just badged.
                      a.status === "PENDING" && "bg-amber-500/[0.04]"
                    )}
                  >
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(a.createdAt)}
                    </TableCell>

                    <TableCell>
                      <ProductCell
                        imageUrl={a.variant?.product?.imageUrls?.[0] ?? null}
                        productName={a.variant?.product?.name ?? "Unknown"}
                        variantName={formatVariantName(
                          `${a.variant?.size?.name ?? ""} / ${a.variant?.color?.name ?? ""}`
                        )}
                        sku={a.variant?.sku ?? "—"}
                      />
                    </TableCell>

                    <TableCell className="text-right">
                      <DeltaCell value={a.quantityChange} />
                    </TableCell>

                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatNumber(a.stockAtRequest)}
                    </TableCell>

                    <TableCell className="max-w-[14rem] text-xs">
                      <div>{ADJUSTMENT_REASON_LABELS[a.reason]}</div>
                      {a.notes && (
                        <div className="truncate text-[11px] text-muted-foreground">
                          {a.notes}
                        </div>
                      )}
                    </TableCell>

                    <TableCell>
                      <AdjustmentStatusBadge status={a.status} />
                      {a.reviewNotes && (
                        <div className="mt-0.5 max-w-[12rem] truncate text-[11px] text-muted-foreground">
                          {a.reviewNotes}
                        </div>
                      )}
                    </TableCell>

                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {a.requestedBy
                        ? `${a.requestedBy.firstName} ${a.requestedBy.lastName}`.trim()
                        : "—"}
                      {a.reviewedBy && (
                        <div className="text-[11px]">
                          reviewed by {a.reviewedBy.firstName}
                        </div>
                      )}
                    </TableCell>

                    {canReview && (
                      <TableCell className="text-right">
                        {a.status === "PENDING" ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={review.isPending}
                              onClick={() => approve(a.id)}
                              leftIcon={<Check className="h-3.5 w-3.5" />}
                            >
                              Approve
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={review.isPending}
                              onClick={() => {
                                setRejecting(a);
                                setRejectNotes("");
                              }}
                              leftIcon={<X className="h-3.5 w-3.5" />}
                            >
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {total > 0 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}

      {/* Rejection requires a reason — the server enforces it too, but asking
          here means the requester always learns why. */}
      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title="Reject adjustment"
        footer={
          <>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              onClick={confirmReject}
              disabled={!rejectNotes.trim() || review.isPending}
              loading={review.isPending}
            >
              Reject
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Stock will not change. Let the requester know why so they can correct it.
          </p>
          <Input
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            placeholder="e.g. Please recount before adjusting"
            maxLength={1000}
            autoFocus
          />
        </div>
      </Modal>
    </div>
  );
}
