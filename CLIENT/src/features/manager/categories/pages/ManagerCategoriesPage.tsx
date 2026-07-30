import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { LayoutGrid, List, Lock } from "lucide-react";
import { Pagination } from "@/components/ui";
import { ErrorState } from "@/components/ui/StateViews";
import { useAuthStore } from "@/store/auth.store";
import {
  CategoryCard,
  CategoryCardGridSkeleton,
  CategoryDrawer,
  CategoryEmptyState,
  CategoryFilters,
  CategorySearch,
  CategoryTable,
  CategoryTableSkeleton,
  MANAGER_CATEGORY_COLUMNS,
  useCategories,
  useCategorySummary,
  useCategoryFilters,
  type CategoryRow,
} from "@/shared/category";
import { ManagerCategoryOverview } from "../components/ManagerCategoryOverview";
import { ManagerCategoryRowActions } from "../components/ManagerCategoryRowActions";

/**
 * ManagerCategoriesPage — the operational, READ-ONLY category browser.
 *
 * Managers use categories to navigate the catalog and answer customer questions
 * ("what's in Beverages?"), not to restructure it. So there are NO create /
 * edit / archive / delete affordances, no selection or bulk toolbar, no export,
 * and no owner-only drawer tabs (discounts, analytics, activity) — `canManage`
 * is false, which is what filters them out.
 *
 * It reuses the SAME shared search / filters / table / cards / drawer as the
 * owner module; every difference is a prop. The real boundary is the server:
 * hooks resolve to /manager/categories (GET-only) from the caller's role, and
 * the owner router's write endpoints return 403 for a manager regardless of
 * what the UI renders.
 */
export default function ManagerCategoriesPage() {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const navigate = useNavigate();

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
    () => (localStorage.getItem("manager:categories:view") as "table" | "grid") ?? "grid"
  );
  const [detail, setDetail] = useState<CategoryRow | null>(null);

  // Saved view preference — restored on the next visit. Managers browsing the
  // catalog usually want the image grid; the owner's admin screen defaults to
  // the table.
  useEffect(() => {
    localStorage.setItem("manager:categories:view", view);
  }, [view]);

  const { data, isLoading, isError, refetch, isFetching } = useCategories(role, serverParams);
  const { data: summary, isLoading: summaryLoading } = useCategorySummary(role);

  const categories = data?.data ?? [];
  const meta = data?.meta;

  /** Hand off to the manager product catalog, pre-filtered to this category. */
  const openProducts = (c: CategoryRow) =>
    navigate(`/products?categoryId=${encodeURIComponent(c.id)}`);

  // "/" focuses search — the same shortcut as the owner screen, suppressed while
  // a field has focus so typing never steals the keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "/") {
        e.preventDefault();
        document
          .querySelector<HTMLInputElement>('input[aria-label="Search categories"]')
          ?.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const renderActions = (c: CategoryRow) => (
    <ManagerCategoryRowActions category={c} onView={setDetail} onViewProducts={openProducts} />
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Categories</h1>
          <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" /> Read-only
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse how the catalog is organised to help customers find products.
          Creating and editing categories requires Owner access.
        </p>
      </div>

      <ManagerCategoryOverview
        summary={summary}
        isLoading={summaryLoading}
        onFilter={(patch) => setFilters(patch as never)}
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

      {isError ? (
        <ErrorState
          title="Could not load categories"
          message="Something went wrong while fetching the catalog."
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        view === "table" ? (
          <CategoryTableSkeleton rows={8} columns={MANAGER_CATEGORY_COLUMNS.length} />
        ) : (
          <CategoryCardGridSkeleton />
        )
      ) : categories.length === 0 ? (
        // canCreate={false}: the empty state must not offer a "New category"
        // button to someone who cannot create one.
        <CategoryEmptyState
          hasFilters={hasActiveFilters}
          canCreate={false}
          onClearFilters={reset}
        />
      ) : (
        <div className={isFetching ? "opacity-60 transition-opacity" : undefined}>
          {view === "table" ? (
            <div className="rounded-lg border border-border">
              <CategoryTable
                categories={categories}
                columns={MANAGER_CATEGORY_COLUMNS}
                onRowClick={setDetail}
                renderActions={renderActions}
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

      {/* Details drawer — canManage={false} leaves only Overview + Products;
          discounts, analytics and activity are owner-only tabs. */}
      <CategoryDrawer
        category={detail}
        open={!!detail}
        onClose={() => setDetail(null)}
        canManage={false}
      />
    </div>
  );
}
