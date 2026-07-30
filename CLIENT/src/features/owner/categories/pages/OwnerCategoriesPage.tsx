import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { BarChart3, LayoutGrid, List, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button, Drawer, Pagination, Select } from "@/components/ui";
import { ErrorState } from "@/components/ui/StateViews";
import { useAuthStore } from "@/store/auth.store";
import {
  CategoryBulkToolbar,
  CategoryCard,
  CategoryCardGridSkeleton,
  CategoryDeleteDialog,
  CategoryDrawer,
  CategoryEmptyState,
  CategoryFilters,
  CategoryForm,
  CategorySearch,
  CategoryTable,
  CategoryTableSkeleton,
  OWNER_CATEGORY_COLUMNS,
  downloadCategoryExport,
  useActivateCategory,
  useArchiveCategory,
  useBulkCategoryAction,
  useCategories,
  useCategorySummary,
  useCategoryFilters,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
  type CategoryBulkAction,
  type CategoryFormValues,
  type CategoryRow,
} from "@/shared/category";
import { CategorySummaryCards } from "../components/CategorySummaryCards";
import { CategoryRowActions } from "../components/CategoryRowActions";

/**
 * OwnerCategoriesPage — complete category administration.
 *
 * Mounted behind OwnerRoute, and every write hits an OWNER-gated backend
 * endpoint. It shares its search/filters/table/cards/drawer with the manager
 * module; the difference is expressed purely through props (owner columns,
 * selection, row actions, owner-only drawer tabs).
 *
 * KEYBOARD: "/" focuses search, "n" creates, "Escape" clears the selection.
 * Shortcuts are suppressed while a field has focus so typing "n" in a form
 * never opens a drawer.
 */
export default function OwnerCategoriesPage() {
  const role = useAuthStore((s) => s.user?.role ?? null);

  const {
    filters,
    setFilters,
    searchInput,
    setSearchInput,
    setPage,
    reset,
    hasActiveFilters,
    serverParams,
  } = useCategoryFilters(20);

  const [view, setView] = useState<"table" | "grid">(
    () => (localStorage.getItem("owner:categories:view") as "table" | "grid") ?? "table"
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<CategoryRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Saved table preference — restored on the next visit.
  useEffect(() => {
    localStorage.setItem("owner:categories:view", view);
  }, [view]);

  const { data, isLoading, isError, refetch, isFetching } = useCategories(role, serverParams);
  const { data: summary, isLoading: summaryLoading } = useCategorySummary(role);

  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();
  const deleteMutation = useDeleteCategory();
  const archiveMutation = useArchiveCategory();
  const activateMutation = useActivateCategory();
  const bulkMutation = useBulkCategoryAction();

  const categories = data?.data ?? [];
  const meta = data?.meta;

  // Instant duplicate-name feedback in the form. Server-side uniqueness is still
  // authoritative — this only avoids a pointless round-trip.
  const existingNames = useMemo(() => categories.map((c) => c.name), [categories]);

  // ── Selection ──────────────────────────────────────────────────────────────

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const openCreate = useCallback(() => {
    setEditing(null);
    setFormError(null);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((c: CategoryRow) => {
    setEditing(c);
    setFormError(null);
    setFormOpen(true);
  }, []);

  const submitForm = (values: CategoryFormValues) => {
    setFormError(null);

    const input = {
      name: values.name,
      description: values.description || null,
      searchKeywords: values.searchKeywords || null,
      imageUrl: values.imageUrl || null,
      status: values.status,
    };

    const onError = (err: unknown) =>
      setFormError(err instanceof Error ? err.message : "Could not save the category.");

    if (editing) {
      updateMutation.mutate(
        { id: editing.id, input },
        {
          onSuccess: (updated) => {
            toast.success(`“${updated.name}” updated.`);
            setFormOpen(false);
            // Keep an open drawer in sync with the edit just made.
            setDetail((d) => (d && d.id === updated.id ? updated : d));
          },
          onError,
        }
      );
    } else {
      createMutation.mutate(input, {
        onSuccess: (created) => {
          toast.success(`“${created.name}” created.`);
          setFormOpen(false);
        },
        onError,
      });
    }
  };

  const archive = (c: CategoryRow) =>
    archiveMutation.mutate(c.id, {
      onSuccess: () =>
        toast.success(`“${c.name}” archived.`, {
          // Archiving is reversible, so offer the reversal rather than a
          // confirmation dialog before the fact.
          action: { label: "Undo", onClick: () => activateMutation.mutate(c.id) },
        }),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Could not archive the category."),
    });

  const activate = (c: CategoryRow) =>
    activateMutation.mutate(c.id, {
      onSuccess: () => toast.success(`“${c.name}” is active again.`),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Could not activate the category."),
    });

  const confirmDelete = (reassignToId?: string) => {
    if (!deleting) return;
    setDeleteError(null);

    deleteMutation.mutate(
      { id: deleting.id, ...(reassignToId ? { reassignToId } : {}) },
      {
        onSuccess: (result) => {
          toast.success(
            result.movedProducts > 0
              ? `“${result.name}” deleted — ${result.movedProducts} product${result.movedProducts === 1 ? "" : "s"} moved to ${result.movedTo?.name}.`
              : `“${result.name}” deleted.`
          );
          setDeleting(null);
          setDetail((d) => (d && d.id === result.id ? null : d));
        },
        onError: (err) =>
          setDeleteError(
            err instanceof Error ? err.message : "Could not delete the category."
          ),
      }
    );
  };

  const runBulk = (action: CategoryBulkAction) => {
    const ids = [...selected];
    if (ids.length === 0) return;

    if (action === "EXPORT") {
      void handleExport("csv");
      return;
    }
    if (action === "DISCOUNT") {
      // Assigning one discount to many categories needs per-category terms, so
      // it routes through the drawer's discount tab rather than guessing.
      toast.info("Open a category and use its Discounts tab to assign a discount.");
      return;
    }
    if (action === "DELETE" && !window.confirm(
      `Delete ${ids.length} categor${ids.length === 1 ? "y" : "ies"}? Categories that still contain products will be skipped.`
    )) {
      return;
    }

    bulkMutation.mutate(
      { ids, action },
      {
        onSuccess: (result) => {
          if (result.processed > 0) {
            toast.success(
              `${result.processed} categor${result.processed === 1 ? "y" : "ies"} updated.`
            );
          }
          // Partial success is normal for bulk delete — report what was skipped
          // and why, rather than silently doing less than asked.
          if (result.skipped.length > 0) {
            toast.warning(
              `${result.skipped.length} skipped: ${result.skipped
                .slice(0, 3)
                .map((s) => `${s.name} (${s.reason})`)
                .join(", ")}${result.skipped.length > 3 ? "…" : ""}`
            );
          }
          clearSelection();
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Bulk action failed."),
      }
    );
  };

  const handleExport = async (format: "csv" | "excel" | "pdf") => {
    setExporting(true);
    try {
      // Export honours the CURRENT filters but NOT pagination — dropping page
      // and limit means you get every matching category, not just the rows on
      // screen. Exporting "page 2 of 7" is never what someone wants.
      const { page: _page, limit: _limit, ...exportParams } = serverParams;
      await downloadCategoryExport(exportParams, format);
      toast.success(format === "pdf" ? "Opening print view…" : "Export downloaded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (e.key === "Escape" && selected.size > 0) {
        clearSelection();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "/") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[aria-label="Search categories"]')?.focus();
      } else if (e.key === "n") {
        e.preventDefault();
        openCreate();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size, clearSelection, openCreate]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const renderActions = (c: CategoryRow) => (
    <CategoryRowActions
      category={c}
      onEdit={openEdit}
      onArchive={archive}
      onActivate={activate}
      onDelete={(cat) => {
        setDeleteError(null);
        setDeleting(cat);
      }}
      onAssignDiscount={(cat) => setDetail(cat)}
    />
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Categories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Master catalog structure — organises products and powers pricing,
            reporting and inventory insights.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Export format"
            value=""
            onChange={(e) => {
              const format = e.target.value as "csv" | "excel" | "pdf";
              if (format) void handleExport(format);
              e.target.value = "";
            }}
            disabled={exporting}
            options={[
              { value: "", label: exporting ? "Exporting…" : "Export…" },
              { value: "csv", label: "CSV" },
              { value: "excel", label: "Excel" },
              { value: "pdf", label: "PDF (print)" },
            ]}
            className="w-36"
          />
          <Link
            to="/admin/categories/analytics"
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent"
          >
            <BarChart3 className="mr-1.5 h-4 w-4" />
            Analytics
          </Link>
          <Button onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            New Category
          </Button>
        </div>
      </div>

      <CategorySummaryCards
        summary={summary}
        isLoading={summaryLoading}
        activeFilter={filters.status || (hasActiveFilters ? undefined : "all")}
        onFilter={(patch) =>
          setFilters({
            status: "",
            hasProducts: "",
            includeArchived: "",
            ...patch,
          } as never)
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <CategorySearch value={searchInput} onChange={setSearchInput} />

          <div className="flex overflow-hidden rounded-md border border-border">
            <button
              type="button"
              aria-label="Table view"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
              className={`px-2.5 py-2 ${view === "table" ? "bg-accent" : "hover:bg-accent/50"}`}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Grid view"
              aria-pressed={view === "grid"}
              onClick={() => setView("grid")}
              className={`px-2.5 py-2 ${view === "grid" ? "bg-accent" : "hover:bg-accent/50"}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>

        <CategoryFilters
          filters={filters}
          onChange={setFilters}
          onReset={reset}
          hasActiveFilters={hasActiveFilters}
        />
      </div>

      <CategoryBulkToolbar
        selectedCount={selected.size}
        onAction={runBulk}
        onClear={clearSelection}
        busy={bulkMutation.isPending}
      />

      {isError ? (
        <ErrorState
          title="Could not load categories"
          message="Something went wrong while fetching the catalog."
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        view === "table" ? (
          <CategoryTableSkeleton rows={8} columns={8} />
        ) : (
          <CategoryCardGridSkeleton />
        )
      ) : categories.length === 0 ? (
        <CategoryEmptyState
          hasFilters={hasActiveFilters}
          canCreate
          onCreate={openCreate}
          onClearFilters={reset}
        />
      ) : (
        <div className={isFetching ? "opacity-60 transition-opacity" : undefined}>
          {view === "table" ? (
            <div className="rounded-lg border border-border">
              <CategoryTable
                categories={categories}
                columns={OWNER_CATEGORY_COLUMNS}
                onRowClick={setDetail}
                renderActions={renderActions}
                selectedIds={selected}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {categories.map((c) => (
                <CategoryCard
                  key={c.id}
                  category={c}
                  onClick={setDetail}
                  renderActions={renderActions}
                  selected={selected.has(c.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          )}

          {meta && meta.totalPages > 1 && (
            <Pagination
              className="mt-4"
              currentPage={meta.page}
              totalPages={meta.totalPages}
              onPageChange={setPage}
            />
          )}
        </div>
      )}

      {/* Details drawer — owner sees all five tabs. */}
      <CategoryDrawer
        category={detail}
        open={!!detail}
        onClose={() => setDetail(null)}
        canManage
        onEdit={openEdit}
      />

      {/* Create / edit */}
      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit category" : "New category"}
        description={
          editing
            ? "Update this category's details."
            : "Categories organise products and power pricing rules."
        }
      >
        <CategoryForm
          initial={editing}
          existingNames={existingNames}
          submitting={createMutation.isPending || updateMutation.isPending}
          serverError={formError}
          onSubmit={submitForm}
          onCancel={() => setFormOpen(false)}
        />
      </Drawer>

      {/* Safe delete */}
      <CategoryDeleteDialog
        category={deleting}
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        submitting={deleteMutation.isPending}
        error={deleteError}
      />
    </div>
  );
}
