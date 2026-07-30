import { useState } from "react";
import { History, Percent, Plus } from "lucide-react";
import {
  Button,
  EmptyState,
  ErrorState,
  Pagination,
  SearchBox,
  Skeleton,
} from "@/components/ui";
import { DiscountBulkBar } from "../components/DiscountBulkBar";
import { DiscountDashboard } from "../components/DiscountDashboard";
import { DiscountFilters } from "../components/DiscountFilters";
import { DiscountFormDrawer } from "../components/DiscountFormDrawer";
import { DiscountHistoryDrawer } from "../components/DiscountHistoryDrawer";
import { DiscountRowActions } from "../components/DiscountRowActions";
import { DiscountTable } from "../components/DiscountTable";
import { useDiscountFilters } from "../hooks/useDiscountFilters";
import { useDiscounts } from "../hooks/useDiscounts";
import type { DiscountRule, DiscountStatus } from "../api/discountApi";

/**
 * DiscountsPage — catalog discount administration (OWNER only).
 *
 * Mounted behind OwnerRoute; every write hits an OWNER-gated backend route, so
 * the frontend guard is convenience and the 403 is the real boundary.
 *
 * This module governs SHELF prices — the discount rules that feed
 * ProductVariant.sellingPrice through the pricing engine. Cart-level promotions
 * applied at checkout are a separate subsystem.
 */
export default function DiscountsPage() {
  const { filters, setFilters, page, limit, setPage, reset, hasActiveFilters, serverParams } =
    useDiscountFilters(20);

  const [selected, setSelected] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DiscountRule | null>(null);
  const [historyFor, setHistoryFor] = useState<DiscountRule | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useDiscounts(serverParams);

  const rules = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (rule: DiscountRule) => {
    setEditing(rule);
    setFormOpen(true);
  };

  const openHistory = (rule: DiscountRule | null) => {
    setHistoryFor(rule);
    setHistoryOpen(true);
  };

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const toggleAll = (ids: string[]) =>
    setSelected((s) => (ids.every((id) => s.includes(id)) ? [] : ids));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Discounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Catalog discount rules — these set the shelf price on products and categories.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => openHistory(null)}
            leftIcon={<History className="h-4 w-4" />}
          >
            History
          </Button>
          <Button onClick={openCreate} leftIcon={<Plus className="h-4 w-4" />}>
            New Discount
          </Button>
        </div>
      </div>

      <DiscountDashboard
        onSelectStatus={(status) => setFilters({ status: (status || "") as DiscountStatus | "" })}
      />

      <div className="flex flex-col gap-4">
        <SearchBox
          className="max-w-sm"
          value={filters.search}
          onChange={(v) => setFilters({ search: v })}
          loading={isFetching}
          placeholder="Search discounts by name…"
        />
        <DiscountFilters
          filters={filters}
          onChange={setFilters}
          onReset={reset}
          hasActiveFilters={hasActiveFilters}
        />
      </div>

      <DiscountBulkBar selected={selected} onClear={() => setSelected([])} />

      {isError ? (
        <ErrorState message="Failed to load discounts." onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<Percent className="h-8 w-8 text-muted-foreground" />}
          title={hasActiveFilters ? "No discounts match these filters" : "No discounts yet"}
          description={
            hasActiveFilters
              ? "Try clearing the filters to see every rule."
              : "Create a rule to discount a product or a whole category."
          }
          action={
            hasActiveFilters
              ? { label: "Clear filters", onClick: reset }
              : { label: "New discount", onClick: openCreate }
          }
        />
      ) : (
        <DiscountTable
          rules={rules}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          onRowClick={openEdit}
          renderActions={(rule) => (
            <DiscountRowActions rule={rule} onEdit={openEdit} onHistory={openHistory} />
          )}
        />
      )}

      {total > 0 && <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />}

      <DiscountFormDrawer open={formOpen} onClose={() => setFormOpen(false)} editing={editing} />

      <DiscountHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        ruleId={historyFor?.id}
        ruleName={historyFor?.name}
      />
    </div>
  );
}
