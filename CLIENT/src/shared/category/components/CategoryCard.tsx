import { ImageOff, Package } from "lucide-react";
import { cn } from "@/utils/cn";
import type { CategoryRow } from "../types";
import { CategoryStatusBadge } from "./CategoryStatusBadge";

/**
 * CategoryCard — the grid presentation of a category.
 *
 * Same data as a table row, optimised for scanning and for narrow viewports
 * where a nine-column table is unusable. Selection and actions are opt-in via
 * props, exactly as in CategoryTable, so the card is equally safe in both the
 * owner and manager modules.
 */
export function CategoryCard({
  category: c,
  onClick,
  renderActions,
  selected,
  onToggleSelect,
}: {
  category: CategoryRow;
  onClick?: (category: CategoryRow) => void;
  renderActions?: (category: CategoryRow) => React.ReactNode;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-lg border bg-card transition-all",
        "hover:border-primary/40 hover:shadow-sm",
        selected ? "border-primary ring-1 ring-primary/30" : "border-border",
        c.status === "ARCHIVED" && "opacity-70",
        onClick && "cursor-pointer"
      )}
      onClick={onClick ? () => onClick(c) : undefined}
    >
      {onToggleSelect && (
        <div
          className="absolute left-3 top-3 z-10"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            aria-label={`Select ${c.name}`}
            checked={!!selected}
            onChange={() => onToggleSelect(c.id)}
            className="h-4 w-4 cursor-pointer rounded border-border accent-primary"
          />
        </div>
      )}

      <div className="flex h-28 items-center justify-center overflow-hidden rounded-t-lg border-b border-border bg-muted/20">
        {c.imageUrl ? (
          <img
            src={c.imageUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <ImageOff className="h-7 w-7 text-muted-foreground" />
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-1 flex items-start justify-between gap-2">
          <h3 className="truncate font-medium leading-tight">{c.name}</h3>
          <CategoryStatusBadge status={c.status} />
        </div>

        <p className="mb-3 line-clamp-2 min-h-[2rem] text-xs text-muted-foreground">
          {c.description || "No description"}
        </p>

        <div className="mt-auto flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-sm">
            <Package className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium tabular-nums">{c.productCount}</span>
            <span className="text-muted-foreground">
              {c.productCount === 1 ? "Product" : "Products"}
            </span>
          </span>

          {renderActions && (
            <div onClick={(e) => e.stopPropagation()}>{renderActions(c)}</div>
          )}
        </div>
      </div>
    </div>
  );
}
