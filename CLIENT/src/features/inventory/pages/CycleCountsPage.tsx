/**
 * Cycle Counts — the stock-take list.
 *
 * Sessions are scoped by category/brand/supplier rather than counting the whole
 * catalogue, because a full count of a retail catalogue is a day's work nobody
 * does. Partial counts that actually happen are worth more than a complete one
 * that does not.
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { ClipboardList, Plus } from "lucide-react";

import {
  Button, EmptyState, ErrorState, Input, Modal, Pagination, Select,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui";
import { useAuthStore } from "@/store/auth.store";
import { CycleCountStatusBadge, InventoryTableSkeleton } from "../components/InventoryAtoms";
import { useCycleCounts, useStartCycleCount, useStock } from "../hooks/useInventory";
import { accuracyAccent, formatDateTime, formatNumber, formatPercent } from "../utils/format";
import type { CycleCountStatus } from "../types";

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "All counts" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

export default function CycleCountsPage() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role ?? null);
  const canCount = role === "OWNER" || role === "MANAGER";

  const [status, setStatus] = useState<CycleCountStatus | "">("");
  const [page, setPage] = useState(1);
  const [starting, setStarting] = useState(false);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const { data, isLoading, isError, refetch } = useCycleCounts({
    page,
    limit: PAGE_SIZE,
    ...(status ? { status } : {}),
  });

  // Category options come from the loaded stock rather than a lookup endpoint,
  // so the list shows categories that actually have stock to count.
  const { data: stock } = useStock({ page: 1, limit: 200 });
  const categories = [
    ...new Map(
      (stock?.data ?? [])
        .filter((r) => r.categoryId && r.categoryName)
        .map((r) => [r.categoryId!, r.categoryName!])
    ),
  ].map(([id, label]) => ({ value: id, label }));

  const startCount = useStartCycleCount();

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const submit = () => {
    startCount.mutate(
      {
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(categoryId ? { categoryId } : {}),
      },
      {
        onSuccess: (session) => {
          setStarting(false);
          setName("");
          setCategoryId("");
          // Straight into the session — starting a count means you intend to
          // count now, not admire the list.
          navigate(`/admin/inventory/cycle-counts/${session.id}`);
        },
      }
    );
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cycle Counts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Physical stock takes. Expected quantities are frozen when a count starts, so
            variances reflect the count — not sales made while counting.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select
            className="w-auto min-w-[10rem]"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as CycleCountStatus | "");
              setPage(1);
            }}
            aria-label="Filter by status"
          />
          {canCount && (
            <Button
              size="sm"
              onClick={() => setStarting(true)}
              leftIcon={<Plus className="h-3.5 w-3.5" />}
            >
              Start Count
            </Button>
          )}
        </div>
      </div>

      {isError ? (
        <ErrorState message="Failed to load cycle counts." onRetry={() => refetch()} />
      ) : !isLoading && rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8 text-muted-foreground" />}
          title="No cycle counts yet"
          description="Start a count to verify what is physically on the shelves against what the system believes."
          {...(canCount
            ? { action: { label: "Start a count", onClick: () => setStarting(true) } }
            : {})}
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Variances</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Accuracy</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <InventoryTableSkeleton columns={9} />
              ) : (
                rows.map((c) => {
                  // Accuracy by LINES, matching the server's engine definition.
                  const accuracy =
                    c.countedItems > 0
                      ? Math.round(
                          ((c.countedItems - c.varianceItems) / c.countedItems) * 1000
                        ) / 10
                      : null;

                  return (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/admin/inventory/cycle-counts/${c.id}`)}
                    >
                      <TableCell className="whitespace-nowrap">
                        <div className="font-mono text-sm">{c.reference}</div>
                        {c.name && (
                          <div className="text-[11px] text-muted-foreground">{c.name}</div>
                        )}
                      </TableCell>

                      <TableCell>
                        <CycleCountStatusBadge status={c.status} />
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(c.startedAt)}
                      </TableCell>

                      <TableCell className="text-right tabular-nums">
                        {formatNumber(c.totalItems)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(c.countedItems)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.varianceItems > 0 ? (
                          <span className="text-destructive">{c.varianceItems}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.netVariance === 0 ? (
                          <span className="text-muted-foreground">0</span>
                        ) : (
                          <span
                            className={
                              c.netVariance > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-destructive"
                            }
                          >
                            {c.netVariance > 0 ? "+" : ""}
                            {c.netVariance}
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="text-right tabular-nums">
                        <span className={accuracyAccent(accuracy)}>
                          {accuracy != null ? formatPercent(accuracy) : "—"}
                        </span>
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {c.startedBy
                          ? `${c.startedBy.firstName} ${c.startedBy.lastName}`.trim()
                          : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {total > 0 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}

      <Modal
        open={starting}
        onClose={() => setStarting(false)}
        title="Start a cycle count"
        footer={
          <>
            <Button variant="outline" onClick={() => setStarting(false)}>
              Cancel
            </Button>
            <Button onClick={submit} loading={startCount.isPending}>
              Start counting
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Name (optional)</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Monday morning — denim wall"
              maxLength={120}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Scope</span>
            <Select
              options={[{ value: "", label: "Everything in stock" }, ...categories]}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            />
            <span className="text-[11px] text-muted-foreground">
              Narrowing the scope keeps a count short enough to actually finish.
            </span>
          </label>

          {startCount.isError && (
            <p className="text-sm text-destructive">
              Could not start the count. There may be no products in that scope.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
