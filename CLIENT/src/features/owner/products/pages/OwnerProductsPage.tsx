import { useState } from "react";
import { Plus, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { ErrorState } from "@/components/ui/StateViews";
import {
  ProductSearch,
  ProductFilters,
  ProductTable,
  ProductCard,
  ProductDetailsDrawer,
  ProductTableSkeleton,
  ProductCardGridSkeleton,
  ProductEmptyState,
  OWNER_COLUMNS,
  useProductFilters,
  type ProductRow,
} from "@/shared/product";
import {
  useOwnerProducts,
  useOwnerProduct,
  useCategoryOptions,
  useBrandOptions,
} from "../hooks/useOwnerProducts";
import { OwnerProductDashboard } from "../components/OwnerProductDashboard";
import { OwnerProductFormDrawer } from "../components/OwnerProductFormDrawer";
import { OwnerProductRowActions } from "../components/OwnerProductRowActions";
import { ProductWizard } from "../wizard/ProductWizard";
import type { ProductDetail } from "@/shared/product";

/**
 * OwnerProductsPage — complete catalog administration surface.
 * Summary dashboard + full-featured table (with financial columns) + create/edit
 * + per-row actions + read/write details drawer. This is the OWNER module; it is
 * mounted behind OwnerRoute on the frontend and every write hits an OWNER-gated
 * backend endpoint. It shares its search/filters/table/drawer with the manager
 * module — the difference is expressed purely through props (owner columns,
 * financial fields, row actions).
 */
export default function OwnerProductsPage() {
  const { filters, setFilters, page, limit, setPage, reset, hasActiveFilters, serverParams } =
    useProductFilters(20);

  const [view, setView] = useState<"table" | "grid">("table");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductDetail | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useOwnerProducts(serverParams);
  const { data: detail, isLoading: detailLoading } = useOwnerProduct(detailId ?? undefined);
  const { data: categories = [] } = useCategoryOptions();
  const { data: brands = [] } = useBrandOptions();

  const products = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // "New Product" launches the full guided creation wizard (transactional).
  const openCreate = () => setWizardOpen(true);

  // Editing an existing product uses the lighter product-level form drawer;
  // variants/pricing/stock of an existing product are managed via their modules.
  const openEdit = (row: ProductRow) => setDetailId(row.id);

  const editFromDetail = () => {
    if (detail) {
      setEditing(detail);
      setFormOpen(true);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete catalog administration — pricing, inventory, and everything else.
          </p>
        </div>
        <Button onClick={openCreate} leftIcon={<Plus className="h-4 w-4" />}>
          New Product
        </Button>
      </div>

      <OwnerProductDashboard />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ProductSearch
            value={filters.search}
            onDebouncedChange={(v) => setFilters({ search: v })}
            loading={isFetching}
          />
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            <Button
              variant={view === "table" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setView("table")}
              aria-label="Table view"
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={view === "grid" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setView("grid")}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <ProductFilters
          filters={filters}
          onChange={setFilters}
          onReset={reset}
          categories={categories}
          brands={brands}
          showStatusFilter
          hasActiveFilters={hasActiveFilters}
        />
      </div>

      {isError ? (
        <ErrorState message="Failed to load products." onRetry={() => refetch()} />
      ) : isLoading ? (
        view === "table" ? (
          <ProductTableSkeleton columns={OWNER_COLUMNS.length} />
        ) : (
          <ProductCardGridSkeleton />
        )
      ) : products.length === 0 ? (
        <ProductEmptyState
          filtered={hasActiveFilters}
          action={hasActiveFilters ? { label: "Clear filters", onClick: reset } : { label: "New product", onClick: openCreate }}
        />
      ) : view === "table" ? (
        <ProductTable
          products={products}
          columns={OWNER_COLUMNS}
          onRowClick={(p) => setDetailId(p.id)}
          renderActions={(p) => (
            <OwnerProductRowActions product={p} onView={(row) => setDetailId(row.id)} onEdit={openEdit} />
          )}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} onClick={(row) => setDetailId(row.id)} />
          ))}
        </div>
      )}

      {total > 0 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}

      <ProductDetailsDrawer
        open={!!detailId}
        onClose={() => setDetailId(null)}
        product={detail}
        loading={detailLoading}
        showFinancials
        headerActions={
          <Button size="sm" variant="outline" onClick={editFromDetail} disabled={!detail}>
            Edit product
          </Button>
        }
      />

      <OwnerProductFormDrawer open={formOpen} onClose={() => setFormOpen(false)} editing={editing} />

      <ProductWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={(productId) => {
          setWizardOpen(false);
          refetch();
          setDetailId(productId); // open the newly created product's details
        }}
      />
    </div>
  );
}
