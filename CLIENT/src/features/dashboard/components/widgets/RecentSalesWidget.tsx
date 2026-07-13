/**
 * @file features/dashboard/components/widgets/RecentSalesWidget.tsx
 *
 * Purpose: Displays the most recent POS transactions.
 */

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { RecentSale, WidgetProps } from "../../types";
import { formatCurrency, formatTimeAgo } from "@/utils/formatters";
import { cn } from "@/utils/cn";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

interface RecentSalesWidgetProps extends WidgetProps {
  sales: RecentSale[] | undefined;
}

export function RecentSalesWidget({ sales, isLoading, className }: RecentSalesWidgetProps) {
  return (
    <Card className={cn("h-full flex flex-col", className)}>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium">Recent Transactions</CardTitle>
        <Link 
          to="/sales" 
          className="text-xs font-medium text-primary hover:underline inline-flex items-center"
        >
          View all
          <ArrowUpRight className="ml-1 h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Receipt</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              // Loading State
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : sales && sales.length > 0 ? (
              // Data State
              sales.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell className="font-medium text-xs">{sale.receiptNumber}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatTimeAgo(new Date(sale.timestamp))}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        sale.status === "COMPLETED" ? "success" : 
                        sale.status === "REFUNDED" ? "destructive" : "warning"
                      }
                      className="text-[10px] px-1.5 py-0"
                    >
                      {sale.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium text-sm">
                    {formatCurrency(sale.totalAmount)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              // Empty State
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground text-sm">
                  No recent transactions found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
