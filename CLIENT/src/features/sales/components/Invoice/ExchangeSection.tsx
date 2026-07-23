import { ArrowLeftRight, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ExchangeLineModel, ExchangeSummaryModel } from "../../types";

const inr = (n: number) => `₹${n.toFixed(2)}`;

/** Signed price-difference label. Positive = customer paid extra, negative = refunded. */
export function priceDifferenceLabel(diff: number): { text: string; tone: "info" | "warning" | "secondary" } {
  if (diff > 0) return { text: `Customer paid +${inr(diff)}`, tone: "info" };
  if (diff < 0) return { text: `Refunded ${inr(Math.abs(diff))}`, tone: "warning" };
  return { text: "Even exchange", tone: "secondary" };
}

function ItemRow({ line }: { line: ExchangeLineModel }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <div className="min-w-0">
        <div className="font-medium truncate">{line.productName}</div>
        <div className="text-xs text-muted-foreground">
          {[line.sizeName, line.colorName].filter(Boolean).join(" • ")}
          {line.sku && <span className="font-mono ml-2">{line.sku}</span>}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-muted-foreground text-xs">×{line.quantity}</div>
        <div className="font-medium">{inr(line.totalValue)}</div>
      </div>
    </div>
  );
}

/** Full returned + issued breakdown for a single exchange (used on the invoice detail page). */
function ExchangeCard({ exchange }: { exchange: ExchangeSummaryModel }) {
  const diff = priceDifferenceLabel(exchange.priceDifference);
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/30 px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{exchange.exchangeNumber || "Exchange"}</span>
          <Badge variant="secondary">{exchange.status}</Badge>
          {exchange.date && (
            <span className="text-xs text-muted-foreground">
              {new Date(exchange.date).toLocaleString()}
            </span>
          )}
        </div>
        <Badge variant={diff.tone}>{diff.text}</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
        <div className="p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-2">
            <ArrowDownLeft className="w-3.5 h-3.5" /> Returned ({inr(exchange.returnedValue)})
          </div>
          {exchange.returnedItems.length === 0 ? (
            <div className="text-xs text-muted-foreground">No returned items.</div>
          ) : (
            <div className="divide-y divide-border">
              {exchange.returnedItems.map((l) => <ItemRow key={l.id} line={l} />)}
            </div>
          )}
        </div>

        <div className="p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2">
            <ArrowUpRight className="w-3.5 h-3.5" /> Issued ({inr(exchange.issuedValue)})
          </div>
          {exchange.issuedItems.length === 0 ? (
            <div className="text-xs text-muted-foreground">No issued items.</div>
          ) : (
            <div className="divide-y divide-border">
              {exchange.issuedItems.map((l) => <ItemRow key={l.id} line={l} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Section rendered on the invoice detail page listing every exchange against the sale. */
export function ExchangeSection({ exchanges }: { exchanges: ExchangeSummaryModel[] }) {
  if (!exchanges || exchanges.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
        <ArrowLeftRight className="w-4 h-4" /> Exchanges ({exchanges.length})
      </h3>
      {exchanges.map((ex) => <ExchangeCard key={ex.id} exchange={ex} />)}
    </div>
  );
}

/**
 * Compact one-line-per-exchange summary for list/card contexts
 * (Sales History expandable row, POS previous-purchases cards).
 */
export function ExchangeSummaryLine({ exchange }: { exchange: ExchangeSummaryModel }) {
  const diff = priceDifferenceLabel(exchange.priceDifference);
  const returned = exchange.returnedItems.map((l) => l.productName).join(", ");
  const issued = exchange.issuedItems.map((l) => l.productName).join(", ");

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold flex items-center gap-1.5">
          <ArrowLeftRight className="w-3 h-3" />
          {exchange.exchangeNumber || "Exchange"}
        </span>
        <Badge variant={diff.tone}>{diff.text}</Badge>
      </div>
      {returned && (
        <div className="text-muted-foreground">
          <span className="text-amber-600 dark:text-amber-400 font-medium">↩ Returned:</span> {returned}
        </div>
      )}
      {issued && (
        <div className="text-muted-foreground">
          <span className="text-emerald-600 dark:text-emerald-400 font-medium">➡ Issued:</span> {issued}
        </div>
      )}
    </div>
  );
}
