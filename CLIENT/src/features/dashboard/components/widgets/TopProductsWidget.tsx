/**
 * @file features/dashboard/components/widgets/TopProductsWidget.tsx
 *
 * Purpose: Displays the best-selling products.
 */

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { TopProduct, WidgetProps } from "../../types";
import { formatCurrency } from "@/utils/formatters";
import { cn } from "@/utils/cn";
import { PackageOpen } from "lucide-react";

interface TopProductsWidgetProps extends WidgetProps {
  products: TopProduct[] | undefined;
}

export function TopProductsWidget({ products, isLoading, className }: TopProductsWidgetProps) {
  return (
    <Card className={cn("h-full flex flex-col", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Top Selling Products</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto">
        <div className="space-y-4">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-md" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))
          ) : products && products.length > 0 ? (
            products.map((product) => (
              <div key={product.id} className="flex items-center gap-3">
                <div className="h-10 w-10 shrink-0 flex items-center justify-center bg-accent rounded-md border border-border">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover rounded-md" />
                  ) : (
                    <PackageOpen className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{product.name}</p>
                  <p className="text-xs text-muted-foreground">{product.sku} • {product.soldQuantity} sold</p>
                </div>
                <div className="text-right font-medium text-sm shrink-0">
                  {formatCurrency(product.revenue)}
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
              <PackageOpen className="h-8 w-8 mb-2 opacity-20" />
              <p className="text-sm">No sales data available.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
