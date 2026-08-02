/**
 * The report table.
 *
 * Column visibility, resizable columns, sticky header, responsive overflow,
 * server-side sorting and pagination — the enterprise table behaviours every
 * report screen needs, implemented once.
 *
 * TWO CHOICES WORTH EXPLAINING
 * ----------------------------
 * 1. SORTING AND PAGING ARE SERVER-SIDE. The component reports intent
 *    (`onSortChange`, `onPageChange`) and renders whatever it is given. A
 *    client-side sort over one page of a 40,000-row report sorts the wrong
 *    rows — it reorders the page, not the data.
 *
 * 2. COLUMN WIDTHS PERSIST PER TABLE, in localStorage keyed by `storageKey`.
 *    A resize that resets on navigation is worse than no resize at all: the
 *    user does the work twice and learns not to bother.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Check } from "lucide-react";

import { Button, Pagination, Skeleton } from "@/components/ui";
import { cn } from "@/utils/cn";

// =============================================================================
// TYPES
// =============================================================================

export interface ReportColumn<T> {
  key: string;
  header: string;
  /** Server sort key. Omit to make the column unsortable. */
  sortKey?: string;
  align?: "left" | "right" | "center";
  width?: number;
  /** Hidden by default; the user can enable it from the column menu. */
  defaultHidden?: boolean;
  /** Never hideable — the column that identifies the row. */
  locked?: boolean;
  render: (row: T, index: number) => React.ReactNode;
  /** Rendered in a totals row beneath the body. */
  footer?: React.ReactNode;
}

export interface ReportTableProps<T> {
  columns: Array<ReportColumn<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  isLoading?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;

  sortBy?: string;
  sortOrder?: "asc" | "desc";
  onSortChange?: (sortBy: string, sortOrder: "asc" | "desc") => void;

  page?: number;
  totalPages?: number;
  total?: number;
  onPageChange?: (page: number) => void;

  onRowClick?: (row: T) => void;

  /** localStorage key for column widths and visibility. Omit to disable both. */
  storageKey?: string;
  /** Adds a totals row when any column defines `footer`. */
  showFooter?: boolean;
  className?: string;
}

// =============================================================================
// PERSISTENCE
// =============================================================================

interface TablePrefs {
  widths: Record<string, number>;
  hidden: string[];
}

function loadPrefs(key: string | undefined): TablePrefs {
  if (!key || typeof window === "undefined") return { widths: {}, hidden: [] };
  try {
    const raw = window.localStorage.getItem(`bi-table:${key}`);
    if (!raw) return { widths: {}, hidden: [] };
    const parsed = JSON.parse(raw) as Partial<TablePrefs>;
    return { widths: parsed.widths ?? {}, hidden: parsed.hidden ?? [] };
  } catch {
    // Corrupt or unavailable storage must never stop a table rendering.
    return { widths: {}, hidden: [] };
  }
}

function savePrefs(key: string | undefined, prefs: TablePrefs): void {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`bi-table:${key}`, JSON.stringify(prefs));
  } catch {
    /* Quota or private mode — preferences are a convenience, not a requirement. */
  }
}

// =============================================================================
// COLUMN VISIBILITY MENU
// =============================================================================

function ColumnMenu<T>({
  columns,
  hidden,
  onToggle,
}: {
  columns: Array<ReportColumn<T>>;
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const hideable = columns.filter((c) => !c.locked);
  if (hideable.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Columns3 className="mr-1.5 h-3.5 w-3.5" />
        Columns
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1.5 max-h-72 w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {hideable.map((col) => {
            const visible = !hidden.has(col.key);
            return (
              <button
                key={col.key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={visible}
                onClick={() => onToggle(col.key)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    visible ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  )}
                >
                  {visible && <Check className="h-3 w-3" aria-hidden />}
                </span>
                <span className="truncate">{col.header}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// TABLE
// =============================================================================

export function ReportTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  emptyTitle = "No results",
  emptyMessage = "Nothing matched the selected filters. Try widening the date range or clearing a filter.",
  sortBy,
  sortOrder = "desc",
  onSortChange,
  page = 1,
  totalPages = 1,
  total,
  onPageChange,
  onRowClick,
  storageKey,
  showFooter = false,
  className,
}: ReportTableProps<T>) {
  const [prefs, setPrefs] = useState<TablePrefs>(() => {
    const stored = loadPrefs(storageKey);
    // Columns marked defaultHidden start hidden, unless the user has already
    // expressed a preference for this table.
    if (stored.hidden.length === 0 && !window.localStorage?.getItem(`bi-table:${storageKey}`)) {
      return { ...stored, hidden: columns.filter((c) => c.defaultHidden).map((c) => c.key) };
    }
    return stored;
  });

  const hidden = useMemo(() => new Set(prefs.hidden), [prefs.hidden]);
  const visibleColumns = useMemo(
    () => columns.filter((c) => c.locked || !hidden.has(c.key)),
    [columns, hidden]
  );

  const update = useCallback(
    (next: TablePrefs) => {
      setPrefs(next);
      savePrefs(storageKey, next);
    },
    [storageKey]
  );

  const toggleColumn = (key: string) => {
    const nextHidden = hidden.has(key)
      ? prefs.hidden.filter((k) => k !== key)
      : [...prefs.hidden, key];
    update({ ...prefs, hidden: nextHidden });
  };

  // ── Column resizing ───────────────────────────────────────────────────────
  const resizeRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const state = resizeRef.current;
      if (!state) return;
      // 72px floor — narrower than this and the header text is unreadable, at
      // which point the column may as well be hidden.
      const width = Math.max(72, state.startWidth + (e.clientX - state.startX));
      setPrefs((p) => ({ ...p, widths: { ...p.widths, [state.key]: width } }));
    };

    const onUp = () => {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Persist once on release rather than on every mousemove — writing to
      // localStorage per frame is a measurable jank source.
      setPrefs((p) => {
        savePrefs(storageKey, p);
        return p;
      });
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [storageKey]);

  const startResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const current = prefs.widths[key] ?? (e.currentTarget.parentElement as HTMLElement)?.offsetWidth ?? 140;
    resizeRef.current = { key, startX: e.clientX, startWidth: current };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // ── Sorting ───────────────────────────────────────────────────────────────
  const handleSort = (col: ReportColumn<T>) => {
    if (!col.sortKey || !onSortChange) return;
    // Clicking the active column flips direction; a new column starts at desc,
    // which is what a reader wants first on almost every financial metric.
    const nextOrder = sortBy === col.sortKey && sortOrder === "desc" ? "asc" : "desc";
    onSortChange(col.sortKey, nextOrder);
  };

  const alignClass = (align?: ReportColumn<T>["align"]) =>
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

  const hasFooter = showFooter && columns.some((c) => c.footer !== undefined);

  return (
    <div className={cn("space-y-3", className)}>
      {storageKey && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {total !== undefined
              ? `${total.toLocaleString("en-IN")} row${total === 1 ? "" : "s"}`
              : `${rows.length} row${rows.length === 1 ? "" : "s"}`}
          </p>
          <ColumnMenu columns={columns} hidden={hidden} onToggle={toggleColumn} />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        {/* The ONLY horizontal scroller. Wide financial tables must scroll
            inside their own container — the page body never scrolls sideways. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
              <tr>
                {visibleColumns.map((col) => {
                  const isSorted = col.sortKey && sortBy === col.sortKey;
                  const SortIcon = !col.sortKey
                    ? null
                    : isSorted
                      ? sortOrder === "asc"
                        ? ArrowUp
                        : ArrowDown
                      : ArrowUpDown;

                  return (
                    <th
                      key={col.key}
                      scope="col"
                      style={{ width: prefs.widths[col.key] ?? col.width }}
                      className={cn(
                        "relative border-b border-border px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                        alignClass(col.align)
                      )}
                      aria-sort={
                        isSorted ? (sortOrder === "asc" ? "ascending" : "descending") : undefined
                      }
                    >
                      <button
                        type="button"
                        disabled={!col.sortKey}
                        onClick={() => handleSort(col)}
                        className={cn(
                          "inline-flex max-w-full items-center gap-1",
                          col.align === "right" && "flex-row-reverse",
                          col.sortKey
                            ? "cursor-pointer transition-colors hover:text-foreground"
                            : "cursor-default"
                        )}
                      >
                        <span className="truncate">{col.header}</span>
                        {SortIcon && (
                          <SortIcon
                            className={cn(
                              "h-3 w-3 shrink-0",
                              isSorted ? "text-foreground" : "opacity-40"
                            )}
                            aria-hidden
                          />
                        )}
                      </button>

                      {/* Resize handle. 8px wide so it is grabbable without
                          overlapping the neighbouring header's click target. */}
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        onMouseDown={(e) => startResize(col.key, e)}
                        className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none hover:bg-primary/30"
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {visibleColumns.map((col) => (
                      <td key={col.key} className="px-3 py-2.5">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-4 py-14">
                    <div className="flex flex-col items-center gap-1.5 text-center">
                      <p className="text-sm font-medium">{emptyTitle}</p>
                      <p className="max-w-sm text-xs text-muted-foreground">{emptyMessage}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr
                    key={rowKey(row, index)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      "border-b border-border transition-colors last:border-0",
                      "odd:bg-transparent even:bg-muted/25",
                      onRowClick && "cursor-pointer hover:bg-muted/60"
                    )}
                  >
                    {visibleColumns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          "px-3 py-2.5",
                          alignClass(col.align),
                          col.align === "right" && "tabular-nums"
                        )}
                      >
                        {col.render(row, index)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>

            {hasFooter && !isLoading && rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                  {visibleColumns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-3 py-2.5",
                        alignClass(col.align),
                        col.align === "right" && "tabular-nums"
                      )}
                    >
                      {col.footer ?? null}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {onPageChange && totalPages > 1 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={onPageChange} />
      )}
    </div>
  );
}
