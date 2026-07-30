import { useState } from "react";
import { Badge, Drawer, EmptyState, ErrorState, Pagination, Skeleton } from "@/components/ui";
import { History } from "lucide-react";
import { useDiscountHistory } from "../hooks/useDiscounts";
import type { DiscountHistoryEntry } from "../api/discountApi";

const ACTION_VARIANT: Record<DiscountHistoryEntry["action"], "success" | "info" | "warning" | "destructive" | "secondary"> = {
  CREATED: "success",
  UPDATED: "info",
  ENABLED: "success",
  DISABLED: "warning",
  DELETED: "destructive",
};

/**
 * The audit trail. Opened either for one rule (`ruleId`) or for the whole module.
 * Entries survive their rule — a DELETED row keeps `ruleName` after `ruleId`
 * goes null, which is the whole point of storing the name alongside the id.
 */
export function DiscountHistoryDrawer({
  open,
  onClose,
  ruleId,
  ruleName,
}: {
  open: boolean;
  onClose: () => void;
  ruleId?: string | undefined;
  ruleName?: string | undefined;
}) {
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, isError, refetch } = useDiscountHistory({
    page,
    limit,
    ...(ruleId ? { ruleId } : {}),
  });

  const entries = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Discount history"
      description={ruleName ? `Changes to “${ruleName}”` : "Every change made to catalog discounts"}
      width="w-full max-w-lg"
    >
      {isError ? (
        <ErrorState message="Failed to load history." onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<History className="h-8 w-8" />}
          title="No history yet"
          description="Changes to discount rules will show up here."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{entry.ruleName}</span>
                <Badge variant={ACTION_VARIANT[entry.action] ?? "secondary"}>{entry.action}</Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {new Date(entry.createdAt).toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                {entry.ruleId == null && " · rule deleted"}
              </div>
            </div>
          ))}

          {total > limit && (
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          )}
        </div>
      )}
    </Drawer>
  );
}
