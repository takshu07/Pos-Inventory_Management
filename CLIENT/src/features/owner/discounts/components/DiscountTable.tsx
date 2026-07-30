import { Package, Tag } from "lucide-react";
import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { formatCurrency } from "@/utils/formatters";
import { DiscountStatusBadge } from "./DiscountStatusBadge";
import type { DiscountRule } from "../api/discountApi";

/**
 * The rules table. Selection drives the bulk action bar; clicking anywhere else
 * on a row opens the editor. The checkbox column stops propagation so ticking a
 * row never also opens it.
 */
export function DiscountTable({
  rules,
  selected,
  onToggle,
  onToggleAll,
  onRowClick,
  renderActions,
}: {
  rules: DiscountRule[];
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  onRowClick: (rule: DiscountRule) => void;
  renderActions: (rule: DiscountRule) => React.ReactNode;
}) {
  const allSelected = rules.length > 0 && rules.every((r) => selected.includes(r.id));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => onToggleAll(rules.map((r) => r.id))}
              aria-label="Select all discounts on this page"
              className="h-4 w-4 rounded border-input accent-primary"
            />
          </TableHead>
          <TableHead>Rule</TableHead>
          <TableHead>Applies to</TableHead>
          <TableHead>Discount</TableHead>
          <TableHead>Window</TableHead>
          <TableHead className="text-right">Priority</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rules.map((rule) => (
          <TableRow
            key={rule.id}
            onClick={() => onRowClick(rule)}
            className="cursor-pointer hover:bg-muted/50"
          >
            <TableCell onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={selected.includes(rule.id)}
                onChange={() => onToggle(rule.id)}
                aria-label={`Select ${rule.name}`}
                className="h-4 w-4 rounded border-input accent-primary"
              />
            </TableCell>

            <TableCell>
              <div className="font-medium">{rule.name}</div>
              {rule.description && (
                <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                  {rule.description}
                </div>
              )}
            </TableCell>

            <TableCell>
              <div className="flex items-center gap-1.5 text-sm">
                {rule.scope === "PRODUCT" ? (
                  <Package className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span>{rule.target?.name ?? "—"}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {rule.scope === "PRODUCT" ? "Product" : "Category"}
              </div>
            </TableCell>

            <TableCell>
              <Badge variant={rule.type === "PERCENTAGE" ? "info" : "secondary"}>
                {rule.type === "PERCENTAGE" ? `${rule.value}%` : formatCurrency(rule.value)}
              </Badge>
            </TableCell>

            <TableCell className="text-xs text-muted-foreground">
              {formatWindow(rule.startDate, rule.endDate)}
            </TableCell>

            <TableCell className="text-right tabular-nums">{rule.priority}</TableCell>

            <TableCell>
              <DiscountStatusBadge status={rule.status} />
            </TableCell>

            <TableCell onClick={(e) => e.stopPropagation()}>{renderActions(rule)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Both dates absent means "always on" — the rule runs until disabled. */
function formatWindow(start: string | null, end: string | null): string {
  if (!start && !end) return "Always";
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
  if (start && end) return `${fmt(start)} → ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  return `Until ${fmt(end as string)}`;
}
