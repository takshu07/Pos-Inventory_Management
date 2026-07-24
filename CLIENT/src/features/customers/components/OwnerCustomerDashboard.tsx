import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import {
  Users,
  UserPlus,
  Activity,
  Repeat,
  IndianRupee,
  Crown,
  ArrowUp,
  ArrowDown,
  Wallet,
  Award,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { SearchBox } from "@/components/ui/SearchBox";
import { DataTable, ColumnDef } from "@/components/shared/DataTable/DataTable";
import { useDebounce } from "@/hooks/useDebounce";
import { formatCurrency } from "@/utils/formatters";
import { useCustomerTable, useCustomerAnalytics } from "../hooks/useCustomers";
import type {
  CustomerAnalytics,
  CustomerTableRow,
  CustomerTableSortField,
} from "../types";

const PAGE_SIZE = 20;
const NEW_CUSTOMER_WINDOW_DAYS = 30;

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—";

/** A saved "quick filter" preset that maps to server-side query params. */
type QuickFilter =
  | "all"
  | "active"
  | "inactive"
  | "topSpend"
  | "mostVisits"
  | "new"
  | "hasStoreCredit"
  | "hasRewardPoints";

const QUICK_FILTER_OPTIONS: { value: QuickFilter; label: string }[] = [
  { value: "all", label: "All customers" },
  { value: "active", label: "Active (last 90 days)" },
  { value: "inactive", label: "Inactive" },
  { value: "topSpend", label: "Highest spend" },
  { value: "mostVisits", label: "Most visits" },
  { value: "new", label: "New (last 30 days)" },
  { value: "hasStoreCredit", label: "Has store credit" },
  { value: "hasRewardPoints", label: "Has reward points" },
];

const SORT_OPTIONS: { value: CustomerTableSortField; label: string }[] = [
  { value: "lastVisit", label: "Last visit" },
  { value: "totalSpend", label: "Total spend" },
  { value: "totalPurchases", label: "Total purchases" },
  { value: "name", label: "Name" },
  { value: "createdAt", label: "Customer since" },
];

/**
 * OwnerCustomerDashboard — the owner/manager-only customer-management section.
 *
 * Analytics cards + a fully server-side paginated / filtered / sorted customer
 * table. The browser only ever holds one page of rows. Quick filters map onto
 * the same backend query params so no client-side list processing happens.
 */
export default function OwnerCustomerDashboard() {
  const analytics = useCustomerAnalytics();

  return (
    <div className="flex flex-col gap-6">
      <AnalyticsCards data={analytics.data} isLoading={analytics.isLoading} />
      <CustomerTable />
    </div>
  );
}

// ─── Analytics cards ─────────────────────────────────────────────────────────

function AnalyticsCards({
  data,
  isLoading,
}: {
  data?: CustomerAnalytics;
  isLoading: boolean;
}) {
  const cards = [
    {
      icon: Users,
      label: "Total Customers",
      value: data ? data.totalCustomers.toLocaleString("en-IN") : "—",
      accent: "text-foreground",
    },
    {
      icon: UserPlus,
      label: "New Customers",
      value: data ? data.newThisMonth.toLocaleString("en-IN") : "—",
      hint: data ? `${data.newToday} today` : undefined,
      accent: "text-blue-600 dark:text-blue-400",
    },
    {
      icon: Activity,
      label: "Active Customers",
      value: data ? data.activeCustomers.toLocaleString("en-IN") : "—",
      hint: data ? `last ${data.activeWindowDays} days` : undefined,
      accent: "text-emerald-600 dark:text-emerald-400",
    },
    {
      icon: Repeat,
      label: "Repeat Customers",
      value: data ? data.repeatCustomers.toLocaleString("en-IN") : "—",
      hint: "2+ purchases",
      accent: "text-purple-600 dark:text-purple-400",
    },
    {
      icon: IndianRupee,
      label: "Avg. Customer Spend",
      value: data ? formatCurrency(data.averageCustomerSpend) : "—",
      hint: "per purchasing customer",
      accent: "text-foreground",
    },
    {
      icon: Crown,
      label: "Top Customer",
      value: data?.topCustomer ? formatCurrency(data.topCustomer.totalSpend) : "—",
      hint: data?.topCustomer?.name,
      accent: "text-amber-600 dark:text-amber-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {cards.map((c) => (
        <Card key={c.label} className="p-4 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            <c.icon className="h-3.5 w-3.5" /> {c.label}
          </div>
          {isLoading ? (
            <div className="h-6 w-16 rounded bg-muted animate-pulse" />
          ) : (
            <div className={`text-xl font-bold ${c.accent}`}>{c.value}</div>
          )}
          {c.hint && !isLoading && (
            <div className="text-xs text-muted-foreground truncate" title={c.hint}>
              {c.hint}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ─── Customer table ──────────────────────────────────────────────────────────

/** Maps a quick-filter preset to the server query params it implies. */
function paramsForQuickFilter(qf: QuickFilter): {
  active?: "true" | "false";
  hasStoreCredit?: boolean;
  hasRewardPoints?: boolean;
  newWithinDays?: number;
  forcedSort?: { sortBy: CustomerTableSortField; sortOrder: "asc" | "desc" };
} {
  switch (qf) {
    case "active":
      return { active: "true" };
    case "inactive":
      return { active: "false" };
    case "hasStoreCredit":
      return { hasStoreCredit: true };
    case "hasRewardPoints":
      return { hasRewardPoints: true };
    case "new":
      return {
        newWithinDays: NEW_CUSTOMER_WINDOW_DAYS,
        forcedSort: { sortBy: "createdAt", sortOrder: "desc" },
      };
    case "topSpend":
      return { forcedSort: { sortBy: "totalSpend", sortOrder: "desc" } };
    case "mostVisits":
      return { forcedSort: { sortBy: "totalPurchases", sortOrder: "desc" } };
    case "all":
    default:
      return {};
  }
}

function CustomerTable() {
  const navigate = useNavigate();

  const [searchValue, setSearchValue] = useState("");
  const debouncedSearch = useDebounce(searchValue.trim(), 400);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [sortBy, setSortBy] = useState<CustomerTableSortField>("lastVisit");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const preset = paramsForQuickFilter(quickFilter);
  // A quick filter like "Highest spend" dictates the sort; otherwise the user's
  // explicit sort choice wins.
  const effectiveSortBy = preset.forcedSort?.sortBy ?? sortBy;
  const effectiveSortOrder = preset.forcedSort?.sortOrder ?? sortOrder;

  const filters = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      sortBy: effectiveSortBy,
      sortOrder: effectiveSortOrder,
      active: preset.active,
      hasStoreCredit: preset.hasStoreCredit,
      hasRewardPoints: preset.hasRewardPoints,
      newWithinDays: preset.newWithinDays,
    }),
    [
      page,
      debouncedSearch,
      effectiveSortBy,
      effectiveSortOrder,
      preset.active,
      preset.hasStoreCredit,
      preset.hasRewardPoints,
      preset.newWithinDays,
    ]
  );

  const { data, isLoading, isFetching } = useCustomerTable(filters);

  // Any filter/sort/search change resets to page 1.
  const resetAnd = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const sortLocked = !!preset.forcedSort;

  const columns: ColumnDef<CustomerTableRow>[] = [
    {
      key: "name",
      header: "Name",
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.name}</span>
          <span className="text-xs text-muted-foreground">{row.customerCode}</span>
        </div>
      ),
    },
    { key: "phone", header: "Phone", cell: (row) => row.phone },
    {
      key: "totalPurchases",
      header: "Purchases",
      className: "text-right",
      cell: (row) => <span className="tabular-nums">{row.totalPurchases}</span>,
    },
    {
      key: "totalSpend",
      header: "Total Spend",
      className: "text-right",
      cell: (row) => (
        <span className="font-semibold tabular-nums">{formatCurrency(row.totalSpend)}</span>
      ),
    },
    { key: "lastVisit", header: "Last Visit", cell: (row) => fmtDate(row.lastVisit) },
    {
      key: "rewardPoints",
      header: "Points",
      className: "text-right",
      cell: (row) =>
        row.rewardPoints > 0 ? (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 tabular-nums">
            <Award className="h-3.5 w-3.5" /> {row.rewardPoints}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "storeCredit",
      header: "Store Credit",
      className: "text-right",
      cell: (row) =>
        row.storeCredit > 0 ? (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 tabular-nums">
            <Wallet className="h-3.5 w-3.5" /> {formatCurrency(row.storeCredit)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: "createdAt", header: "Since", cell: (row) => fmtDate(row.createdAt) },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <Badge variant={row.active ? "success" : "secondary"}>
          {row.active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
  ];

  return (
    <Card className="p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">All Customers</h2>
        <span className="text-xs text-muted-foreground">
          {data ? `${data.total.toLocaleString("en-IN")} total` : ""}
        </span>
      </div>

      {/* Filter toolbar — every control maps to a server-side query param. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <SearchBox
            value={searchValue}
            onChange={resetAnd(setSearchValue)}
            loading={isFetching}
            placeholder="Search name, phone, email, or code…"
          />
        </div>

        <div className="w-52">
          <Select
            label="Filter"
            value={quickFilter}
            onChange={(e) => {
              setQuickFilter(e.target.value as QuickFilter);
              setPage(1);
            }}
            options={QUICK_FILTER_OPTIONS}
          />
        </div>

        <div className="w-48">
          <Select
            label="Sort by"
            value={effectiveSortBy}
            disabled={sortLocked}
            onChange={resetAnd((e: React.ChangeEvent<HTMLSelectElement>) =>
              setSortBy(e.target.value as CustomerTableSortField)
            )}
            options={SORT_OPTIONS}
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={sortLocked}
          onClick={() => {
            setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
            setPage(1);
          }}
          title={effectiveSortOrder === "asc" ? "Ascending" : "Descending"}
        >
          {effectiveSortOrder === "asc" ? (
            <ArrowUp className="h-4 w-4" />
          ) : (
            <ArrowDown className="h-4 w-4" />
          )}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        totalItems={data?.total ?? 0}
        itemsPerPage={PAGE_SIZE}
        currentPage={page}
        onPageChange={setPage}
        onRowClick={(row) => navigate(`/sales?customerId=${row.id}`)}
        emptyMessage="No customers match these filters."
      />
    </Card>
  );
}
