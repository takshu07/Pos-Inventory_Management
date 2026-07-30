import {
  Percent,
  CheckCircle2,
  CalendarClock,
  History,
  PauseCircle,
  AlarmClock,
  Package,
  Tag,
} from "lucide-react";
import { Card, Skeleton } from "@/components/ui";
import { useDiscountDashboard } from "../hooks/useDiscounts";
import type { DiscountDashboard as DashboardData } from "../api/discountApi";

/**
 * DiscountDashboard — the summary strip above the rules table.
 *
 * Mirrors OwnerProductDashboard's card grammar so the two owner modules read as
 * one system. "Ending soon" is the card that actually earns its place: a sale
 * lapsing unnoticed is the failure mode owners care about.
 */
export function DiscountDashboard({ onSelectStatus }: { onSelectStatus?: (status: string) => void }) {
  const { data, isLoading, isError } = useDiscountDashboard();

  if (isError) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
      {isLoading || !data
        ? Array.from({ length: 8 }).map((_, i) => <StatSkeleton key={i} />)
        : cards(data).map((c) => (
            <StatCard key={c.label} {...c} onClick={c.status && onSelectStatus ? () => onSelectStatus(c.status!) : undefined} />
          ))}
    </div>
  );
}

function cards(d: DashboardData) {
  const c = d.counts;
  return [
    { icon: Percent, label: "Total Rules", value: String(c.total), status: "" },
    {
      icon: CheckCircle2,
      label: "Active",
      value: String(c.active),
      accent: "text-emerald-600 dark:text-emerald-400",
      status: "ACTIVE",
    },
    { icon: CalendarClock, label: "Scheduled", value: String(c.scheduled), accent: "text-blue-600 dark:text-blue-400", status: "SCHEDULED" },
    {
      icon: AlarmClock,
      label: "Ending Soon",
      value: String(c.endingSoon),
      accent: "text-amber-600 dark:text-amber-400",
      status: "ACTIVE",
    },
    { icon: History, label: "Expired", value: String(c.expired), status: "EXPIRED" },
    { icon: PauseCircle, label: "Disabled", value: String(c.disabled), status: "DISABLED" },
    { icon: Package, label: "Product-scoped", value: String(c.productScoped), status: "" },
    { icon: Tag, label: "Category-scoped", value: String(c.categoryScoped), status: "" },
  ];
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: string;
  status?: string;
  onClick?: (() => void) | undefined;
}) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Card className="p-3">
      <Wrapper
        {...(onClick ? { onClick, type: "button" as const } : {})}
        className={`w-full text-left ${onClick ? "cursor-pointer" : ""}`}
      >
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {label}
        </div>
        <div className={`mt-1 text-lg font-bold ${accent ?? ""}`}>{value}</div>
      </Wrapper>
    </Card>
  );
}

function StatSkeleton() {
  return (
    <Card className="p-3">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-2 h-6 w-16" />
    </Card>
  );
}
