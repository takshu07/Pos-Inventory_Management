import { useState } from "react";
import {
  Archive,
  CheckCircle2,
  History,
  Image as ImageIcon,
  PauseCircle,
  Pencil,
  Plus,
  Tag,
  Trash2,
  Type,
} from "lucide-react";
import { Pagination } from "@/components/ui";
import { formatTimeAgo } from "@/utils/formatters";
import { cn } from "@/utils/cn";
import { useCategoryActivity } from "../../useCategories";
import { CategoryDetailSkeleton } from "../CategorySkeleton";

/**
 * CategoryActivityTab — the category's history (Phase 2).
 *
 * Reads the SHARED audit log rather than a parallel category-history table.
 * Every mutation in category.service already writes an audit row, so this
 * timeline is complete by construction and stays complete for any future
 * action without extra bookkeeping.
 */

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  CREATED: Plus,
  UPDATE: Pencil,
  UPDATED: Pencil,
  DELETED: Trash2,
  ARCHIVED: Archive,
  ACTIVATED: CheckCircle2,
  DEACTIVATED: PauseCircle,
  IMAGE_CHANGED: ImageIcon,
  RENAMED: Type,
  DISCOUNT: Tag,
};

const TONE: Record<string, string> = {
  CREATED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  ACTIVATED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  DELETED: "bg-destructive/10 text-destructive",
  ARCHIVED: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  DEACTIVATED: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

export function CategoryActivityTab({ categoryId }: { categoryId: string }) {
  const [page, setPage] = useState(1);
  const { data, isPending, isError, error } = useCategoryActivity(categoryId, page);

  if (isPending) return <CategoryDetailSkeleton />;

  if (isError) {
    return (
      <p className="py-8 text-center text-sm text-destructive">
        {error instanceof Error ? error.message : "Could not load activity."}
      </p>
    );
  }

  const events = data?.data ?? [];
  const meta = data?.meta;

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center py-10 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <History className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">No activity recorded yet</p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          Changes to this category will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="relative space-y-0">
        {events.map((e, i) => {
          const Icon = ICONS[e.type] ?? Pencil;
          const isLast = i === events.length - 1;

          return (
            <li key={e.id} className="relative flex gap-3 pb-5">
              {/* Connector line, omitted on the final entry. */}
              {!isLast && (
                <span
                  className="absolute left-[15px] top-8 h-full w-px bg-border"
                  aria-hidden
                />
              )}

              <div
                className={cn(
                  "z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  TONE[e.type] ?? "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
              </div>

              <div className="min-w-0 flex-1 pt-1">
                <p className="text-sm">{e.summary}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {e.actor ? `${e.actor.name} · ${e.actor.role}` : "System"} ·{" "}
                  {formatTimeAgo(new Date(e.createdAt))}
                </p>

                {e.changedFields.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {e.changedFields.slice(0, 6).map((f) => (
                      <span
                        key={f}
                        className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {meta && meta.totalPages > 1 && (
        <Pagination
          currentPage={meta.page}
          totalPages={meta.totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
