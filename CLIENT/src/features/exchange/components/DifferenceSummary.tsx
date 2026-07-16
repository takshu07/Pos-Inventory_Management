import React from "react";
import { formatCurrency } from "@/features/pos/utils/pos.utils";

interface DifferenceSummaryProps {
  returnedTotal: number;
  issuedTotal: number;
  difference: number;
}

export function DifferenceSummary({ returnedTotal, issuedTotal, difference }: DifferenceSummaryProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-center text-sm">
        <span className="text-muted-foreground">Returned Value</span>
        <span className="font-medium text-emerald-500">-{formatCurrency(returnedTotal)}</span>
      </div>
      <div className="flex justify-between items-center text-sm">
        <span className="text-muted-foreground">Issued Value</span>
        <span className="font-medium">{formatCurrency(issuedTotal)}</span>
      </div>
      
      <div className="border-t border-dashed my-2"></div>

      <div className="flex justify-between items-center text-xl font-bold">
        <span>Balance {difference > 0 ? "Due" : (difference < 0 ? "Credit" : "Settled")}</span>
        <span className={difference > 0 ? "text-primary" : (difference < 0 ? "text-emerald-500" : "text-muted-foreground")}>
          {formatCurrency(Math.abs(difference))}
        </span>
      </div>
    </div>
  );
}
