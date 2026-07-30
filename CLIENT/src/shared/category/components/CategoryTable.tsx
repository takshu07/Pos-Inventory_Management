import { ImageOff } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { cn } from "@/utils/cn";
import type { CategoryColumn, CategoryRow } from "../types";
import { CategoryStatusBadge } from "./CategoryStatusBadge";

/**
 * CategoryTable — the shared category data grid.
 *
 * Columns are selected via `columns`, and the selection column only renders
 * when the caller passes selection handlers — the Owner module opts in for bulk
 * actions, the Manager module never does. An optional `renderActions` slot lets
 * each module inject its own row actions without this component knowing
 * anything about permissions. That separation is what makes one table safe to
 * share across two differently-authorized modules.
 */

const HEADERS: Record<CategoryColumn, { label: string; align?: "right" }> = {
  select: { label: "" },
  image: { label: "" },
  name: { label: "Category" },
  description: { label: "Description" },
  products: { label: "Products", align: "right" },
  status: { label: "Status" },
  createdBy: { label: "Created By" },
  createdAt: { label: "Created" },
  updatedAt: { label: "Updated" },
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" });

export function CategoryTable({
  categories,
  columns,
  onRowClick,
  renderActions,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}: {
  categories: CategoryRow[];
  columns: CategoryColumn[];
  onRowClick?: (category: CategoryRow) => void;
  renderActions?: (category: CategoryRow) => React.ReactNode;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: (ids: string[]) => void;
}) {
  const selectable = !!selectedIds && !!onToggleSelect;
  // The select column is declared in the column set but only honoured when the
  // caller actually wired selection up — otherwise a checkbox would render with
  // nothing behind it.
  const visible = columns.filter((c) => c !== "select" || selectable);

  const pageIds = categories.map((c) => c.id);
  const allSelected = selectable && pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const someSelected = selectable && pageIds.some((id) => selectedIds.has(id)) && !allSelected;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {visible.map((col) =>
            col === "select" ? (
              <TableHead key={col} className="w-10">
                <input
                  type="checkbox"
                  aria-label={allSelected ? "Deselect all on this page" : "Select all on this page"}
                  checked={allSelected}
                  ref={(el) => {
                    // Indeterminate is a DOM property, not an attribute — it
                    // cannot be expressed in JSX and must be set via a ref.
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={() => onToggleSelectAll?.(pageIds)}
                  className="h-4 w-4 cursor-pointer rounded border-border accent-primary"
                />
              </TableHead>
            ) : (
              <TableHead
                key={col}
                className={HEADERS[col].align === "right" ? "text-right" : undefined}
              >
                {HEADERS[col].label}
              </TableHead>
            )
          )}
          {renderActions && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {categories.map((c) => {
          const isSelected = selectable && selectedIds.has(c.id);
          return (
            <TableRow
              key={c.id}
              data-state={isSelected ? "selected" : undefined}
              className={cn(
                onRowClick && "cursor-pointer",
                isSelected && "bg-primary/5",
                c.status === "ARCHIVED" && "opacity-60"
              )}
              onClick={onRowClick ? () => onRowClick(c) : undefined}
            >
              {visible.map((col) =>
                col === "select" ? (
                  <TableCell key={col} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${c.name}`}
                      checked={isSelected}
                      onChange={() => onToggleSelect?.(c.id)}
                      className="h-4 w-4 cursor-pointer rounded border-border accent-primary"
                    />
                  </TableCell>
                ) : (
                  <TableCell
                    key={col}
                    className={cn(HEADERS[col].align === "right" && "text-right")}
                  >
                    <Cell col={col} category={c} />
                  </TableCell>
                )
              )}
              {renderActions && (
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  {renderActions(c)}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Cell({ col, category: c }: { col: CategoryColumn; category: CategoryRow }) {
  switch (col) {
    case "image":
      return (
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/20">
          {c.imageUrl ? (
            <img src={c.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <ImageOff className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      );
    case "name":
      return (
        <div className="min-w-0">
          <div className="max-w-[220px] truncate font-medium">{c.name}</div>
          {c.searchKeywords && (
            <div className="max-w-[220px] truncate text-xs text-muted-foreground">
              {c.searchKeywords}
            </div>
          )}
        </div>
      );
    case "description":
      return (
        <span className="block max-w-[280px] truncate text-sm text-muted-foreground">
          {c.description || "—"}
        </span>
      );
    case "products":
      // Reads as a sentence in the drawer//cards too — "42 Products".
      return (
        <span className={cn("tabular-nums", c.productCount === 0 && "text-muted-foreground")}>
          {c.productCount}
        </span>
      );
    case "status":
      return <CategoryStatusBadge status={c.status} />;
    case "createdBy":
      return <span className="text-sm">{c.createdBy?.name ?? "—"}</span>;
    case "createdAt":
      return <span className="text-xs text-muted-foreground">{fmtDate(c.createdAt)}</span>;
    case "updatedAt":
      return <span className="text-xs text-muted-foreground">{fmtDate(c.updatedAt)}</span>;
    default:
      return null;
  }
}
