import {
  Boxes,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  PackageX,
  Layers,
  Tag,
  Award,
  Wallet,
  Percent,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCurrency } from "@/utils/formatters";
import { formatMargin, type CatalogStats } from "@/shared/product";
import { useOwnerProductStats } from "../hooks/useOwnerProducts";

/**
 * OwnerProductDashboard — the owner-only summary cards (all 10 metrics from the
 * spec, including the financial ones: inventory value and average margin). Only
 * the owner module renders this; the manager dashboard is a separate, financial-
 * free component.
 */
export function OwnerProductDashboard() {
  const { data, isLoading, isError } = useOwnerProductStats();

  if (isError) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {isLoading || !data
        ? Array.from({ length: 10 }).map((_, i) => <StatSkeleton key={i} />)
        : cards(data).map((c) => <StatCard key={c.label} {...c} />)}
    </div>
  );
}

function cards(s: CatalogStats) {
  return [
    { icon: Boxes, label: "Total Products", value: String(s.totalProducts) },
    {
      icon: CheckCircle2,
      label: "Active",
      value: String(s.activeProducts),
      accent: "text-emerald-600 dark:text-emerald-400",
    },
    { icon: XCircle, label: "Inactive", value: String(s.inactiveProducts) },
    {
      icon: AlertTriangle,
      label: "Low Stock",
      value: String(s.lowStockProducts),
      accent: "text-amber-600 dark:text-amber-400",
    },
    {
      icon: PackageX,
      label: "Out of Stock",
      value: String(s.outOfStockProducts),
      accent: "text-destructive",
    },
    { icon: Layers, label: "Total Variants", value: String(s.totalVariants) },
    { icon: Tag, label: "Categories", value: String(s.totalCategories) },
    { icon: Award, label: "Brands", value: String(s.totalBrands) },
    {
      icon: Wallet,
      label: "Inventory Value",
      value: s.inventoryValue != null ? formatCurrency(s.inventoryValue) : "—",
    },
    { icon: Percent, label: "Avg. Margin", value: formatMargin(s.averageMargin) },
  ];
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={`mt-1 text-lg font-bold ${accent ?? ""}`}>{value}</div>
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
