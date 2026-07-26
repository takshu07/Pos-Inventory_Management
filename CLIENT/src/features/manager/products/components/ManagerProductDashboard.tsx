import { Boxes, CheckCircle2, AlertTriangle, PackageX, Layers } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import type { ProductRow } from "@/shared/product";

/**
 * ManagerProductDashboard — operational summary cards for managers. Deliberately
 * shows ONLY the non-financial metrics the spec permits: total, active, low
 * stock, out of stock, total variants. It NEVER shows profit, margins, inventory
 * value, or revenue — the manager backend does not even return those fields.
 *
 * Because managers have no stats endpoint (that endpoint is owner-only and
 * includes financials), these counts are derived from the currently loaded page
 * of products. They summarize what's on screen rather than the whole catalog,
 * which is the honest thing to show without leaking a catalog-wide financial
 * aggregate through a manager-accessible route.
 */
export function ManagerProductDashboard({
  products,
  loading,
}: {
  products: ProductRow[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="p-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-6 w-12" />
          </Card>
        ))}
      </div>
    );
  }

  const active = products.filter((p) => p.isActive).length;
  const low = products.filter((p) => p.stockStatus === "LOW_STOCK").length;
  const out = products.filter((p) => p.stockStatus === "OUT_OF_STOCK").length;
  const variants = products.reduce((s, p) => s + p.variantCount, 0);

  const cards = [
    { icon: Boxes, label: "Products (page)", value: products.length },
    {
      icon: CheckCircle2,
      label: "Active",
      value: active,
      accent: "text-emerald-600 dark:text-emerald-400",
    },
    {
      icon: AlertTriangle,
      label: "Low Stock",
      value: low,
      accent: "text-amber-600 dark:text-amber-400",
    },
    { icon: PackageX, label: "Out of Stock", value: out, accent: "text-destructive" },
    { icon: Layers, label: "Variants", value: variants },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <Card key={c.label} className="p-3">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            <c.icon className="h-3.5 w-3.5" /> {c.label}
          </div>
          <div className={`mt-1 text-lg font-bold ${c.accent ?? ""}`}>{c.value}</div>
        </Card>
      ))}
    </div>
  );
}
