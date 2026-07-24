import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import {
  User,
  Phone,
  ShoppingBag,
  Award,
  Wallet,
  CalendarClock,
  Repeat,
  ArrowLeftRight,
  Printer,
  Plus,
  History,
  ChevronRight,
  Users as UsersIcon,
} from "lucide-react";
import { SearchBox } from "@/components/ui/SearchBox";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useDebounce } from "@/hooks/useDebounce";
import { formatCurrency } from "@/utils/formatters";
import { useCustomers, useCustomer, useExchangeEligibility } from "../hooks/useCustomers";
import { useSalesHistory } from "@/features/sales/hooks/useSales";
import { usePosStore } from "@/features/pos/store/usePosStore";
import type { CustomerModel, ExchangeEligibilityItem } from "../types";

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—";

/**
 * CustomersView — the daily cashier-facing customer lookup.
 *
 * Search by mobile or name → pick a customer → see their details, recent
 * purchases, exchange eligibility, and quick actions. Customer creation lives
 * in the POS checkout flow, not here.
 */
export default function CustomersView() {
  const [searchValue, setSearchValue] = useState("");
  const debouncedSearch = useDebounce(searchValue.trim(), 350);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: results, isFetching } = useCustomers({
    search: debouncedSearch,
    limit: 8,
  });

  // Exclude the permanent walk-in record from the pickable results.
  const matches = useMemo(
    () => (results?.data ?? []).filter((c) => !c.isWalkIn),
    [results]
  );

  // Auto-select when the search resolves to exactly one real customer.
  useEffect(() => {
    if (debouncedSearch.length >= 2 && matches.length === 1) {
      setSelectedId(matches[0].id);
    }
  }, [debouncedSearch, matches]);

  const showResults = debouncedSearch.length >= 2 && !selectedId;

  return (
    <div className="flex flex-col h-full gap-4 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Search by mobile number or name to view a customer.
        </p>
      </div>

      <div className="max-w-xl">
        <SearchBox
          value={searchValue}
          onChange={(v) => {
            setSearchValue(v);
            setSelectedId(null);
          }}
          loading={isFetching}
          placeholder="Search mobile number or name…"
        />
      </div>

      {showResults && (
        <SearchResults
          matches={matches}
          isFetching={isFetching}
          onSelect={setSelectedId}
        />
      )}

      {selectedId && (
        <CustomerDetail
          customerId={selectedId}
          onBack={() => {
            setSelectedId(null);
          }}
        />
      )}

      {!showResults && !selectedId && <IdlePrompt hasQuery={debouncedSearch.length > 0} />}
    </div>
  );
}

function IdlePrompt({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 opacity-70">
      <UsersIcon className="h-12 w-12" />
      <p className="text-sm">
        {hasQuery ? "Keep typing to search…" : "Start typing a mobile number or name."}
      </p>
    </div>
  );
}

function SearchResults({
  matches,
  isFetching,
  onSelect,
}: {
  matches: CustomerModel[];
  isFetching: boolean;
  onSelect: (id: string) => void;
}) {
  if (isFetching && matches.length === 0) {
    return <div className="text-sm text-muted-foreground px-1">Searching…</div>;
  }

  if (matches.length === 0) {
    return (
      <Card className="p-8 flex flex-col items-center justify-center text-center gap-2">
        <UsersIcon className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">No customer found.</p>
        <p className="text-xs text-muted-foreground">
          New customers are added at POS checkout when their mobile number is entered.
        </p>
      </Card>
    );
  }

  return (
    <div className="max-w-xl flex flex-col gap-2">
      {matches.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left hover:bg-accent transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <User className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="font-medium truncate">{c.name}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Phone className="h-3 w-3" /> {c.phone}
              </div>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      ))}
    </div>
  );
}

function CustomerDetail({
  customerId,
  onBack,
}: {
  customerId: string;
  onBack: () => void;
}) {
  const { data: customer, isLoading, error } = useCustomer(customerId);

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading customer…</div>;
  }

  if (error || !customer) {
    return (
      <Card className="p-6 flex flex-col items-start gap-3">
        <p className="text-sm text-destructive">Failed to load customer.</p>
        <Button variant="outline" size="sm" onClick={onBack}>
          Back to search
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={onBack}
        className="text-sm text-muted-foreground hover:text-foreground self-start"
      >
        ← Back to search
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(320px,1fr)_1.4fr] gap-4 items-start">
        <div className="flex flex-col gap-4">
          <DetailsCard customer={customer} />
          <QuickActions customer={customer} />
        </div>

        <div className="flex flex-col gap-4">
          <ExchangeEligibilityPanel customerId={customer.id} />
          <RecentPurchases customerId={customer.id} />
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3 bg-muted/20">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={`font-semibold mt-1 ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

function DetailsCard({ customer }: { customer: CustomerModel }) {
  const stats = customer.statistics;

  return (
    <Card className="p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <User className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold truncate">{customer.name}</h2>
            {!customer.isActive && <Badge variant="secondary">Inactive</Badge>}
          </div>
          <div className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5" /> {customer.phone}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{customer.customerCode}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Stat
          icon={Award}
          label="Reward Points"
          value={customer.rewardPoints}
          accent="text-amber-600 dark:text-amber-400"
        />
        <Stat
          icon={Wallet}
          label="Store Credit"
          value={formatCurrency(Number(customer.storeCredit) || 0)}
          accent="text-emerald-600 dark:text-emerald-400"
        />
        <Stat
          icon={ShoppingBag}
          label="Total Purchases"
          value={formatCurrency(stats?.lifetimeSpend ?? 0)}
        />
        <Stat icon={Repeat} label="Visits" value={stats?.totalOrders ?? 0} />
        <Stat icon={CalendarClock} label="Last Visit" value={fmtDate(stats?.lastVisit)} />
        <Stat icon={User} label="Customer Since" value={fmtDate(customer.createdAt)} />
      </div>

      {customer.notes && (
        <div className="rounded-lg border border-border p-3 bg-amber-50/50 dark:bg-amber-900/10 text-sm">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Notes</div>
          {customer.notes}
        </div>
      )}
    </Card>
  );
}

function ExchangeEligibilityPanel({ customerId }: { customerId: string }) {
  const { data, isLoading } = useExchangeEligibility(customerId);
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <Card className="p-5">
        <div className="text-sm text-muted-foreground">Checking exchange eligibility…</div>
      </Card>
    );
  }

  const items = data?.items ?? [];
  const eligible = items.filter((i) => i.eligible);

  return (
    <Card className="p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4" /> Exchange Eligibility
        </h3>
        {data && (
          <span className="text-xs text-muted-foreground">{data.windowDays}-day window</span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No completed purchases to exchange.</p>
      ) : eligible.length === 0 ? (
        <div className="rounded-lg border border-border p-3 bg-muted/30 text-sm text-muted-foreground">
          No purchases are within the exchange window.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {eligible.map((item) => (
            <EligibilityRow key={item.saleId} item={item} onExchange={() => navigate("/pos")} />
          ))}
        </div>
      )}
    </Card>
  );
}

function EligibilityRow({
  item,
  onExchange,
}: {
  item: ExchangeEligibilityItem;
  onExchange: () => void;
}) {
  const urgent = item.daysRemaining <= 1;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10 px-3 py-2.5">
      <div className="min-w-0">
        <div className="font-medium text-sm">{item.saleNumber}</div>
        <div className="text-xs text-muted-foreground">
          {fmtDate(item.saleDate)} · {formatCurrency(item.grandTotal)}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant={urgent ? "warning" : "success"}>
          {item.daysRemaining === 0
            ? "Last day"
            : `${item.daysRemaining} day${item.daysRemaining === 1 ? "" : "s"} left`}
        </Badge>
        <Button size="sm" variant="outline" onClick={onExchange}>
          Exchange
        </Button>
      </div>
    </div>
  );
}

function RecentPurchases({ customerId }: { customerId: string }) {
  const navigate = useNavigate();
  const { data, isLoading } = useSalesHistory({ customerId, limit: 8 });
  const bills = data?.data ?? [];

  return (
    <Card className="p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <History className="h-4 w-4" /> Recent Purchases
        </h3>
        {bills.length > 0 && (
          <button
            className="text-xs text-primary hover:underline"
            onClick={() => navigate(`/sales?customerId=${customerId}`)}
          >
            View all
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : bills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-2 opacity-70">
          <ShoppingBag className="h-8 w-8" />
          <p className="text-sm">No purchases yet.</p>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {bills.map((b) => (
            <button
              key={b.id}
              onClick={() => navigate(`/sales/${b.id}`)}
              className="flex items-center justify-between gap-3 py-2.5 text-left hover:bg-accent/50 -mx-2 px-2 rounded transition-colors"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm text-primary">{b.invoiceNumber}</div>
                <div className="text-xs text-muted-foreground">
                  {fmtDate(b.date)}
                  {b.exchanges.length > 0 && (
                    <span className="ml-2 inline-flex items-center gap-0.5 text-purple-600 dark:text-purple-400">
                      <ArrowLeftRight className="h-3 w-3" /> Exchanged
                    </span>
                  )}
                </div>
              </div>
              <span className="font-semibold text-sm shrink-0">{formatCurrency(b.totalAmount)}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function QuickActions({ customer }: { customer: CustomerModel }) {
  const navigate = useNavigate();
  const startSession = usePosStore((s) => s.startSession);

  const newSale = () => {
    // Pre-load the POS session with this customer, then jump to checkout.
    startSession({ id: customer.id, phone: customer.phone, name: customer.name });
    navigate("/pos");
  };

  return (
    <Card className="p-4 grid grid-cols-2 gap-2">
      <Button onClick={newSale} className="w-full">
        <Plus className="h-4 w-4 mr-1" /> New Sale
      </Button>
      <Button variant="outline" onClick={() => navigate("/pos")} className="w-full">
        <ArrowLeftRight className="h-4 w-4 mr-1" /> Exchange
      </Button>
      <Button
        variant="outline"
        onClick={() => navigate(`/sales?customerId=${customer.id}`)}
        className="w-full"
      >
        <History className="h-4 w-4 mr-1" /> Purchases
      </Button>
      <Button
        variant="ghost"
        onClick={() => navigate(`/sales?customerId=${customer.id}`)}
        className="w-full"
      >
        <Printer className="h-4 w-4 mr-1" /> Invoices
      </Button>
    </Card>
  );
}
