import { useState } from "react";
import { Lock } from "lucide-react";
import { Pagination } from "@/components/ui/Pagination";
import { ErrorState } from "@/components/ui/StateViews";
import {
  ProductSearch,
  ProductFilters,
  ProductTable,
  ProductDetailsDrawer,
  EffectivePricePanel,
  ProductTableSkeleton,
  ProductEmptyState,
  MANAGER_COLUMNS,
  useProductFilters,
} from "@/shared/product";
import {
  useManagerProducts,
  useManagerProduct,
  useManagerCategories,
  useManagerBrands,
} from "../hooks/useManagerProducts";
import { ManagerProductDashboard } from "../components/ManagerProductDashboard";
import { ManagerProductRowActions } from "../components/ManagerProductRowActions";

/**
 * ManagerProductsPage — the operational, READ-ONLY catalog for managers.
 *
 * Managers assist customers: fast search, filters, and read-only product detail.
 * There are NO create/edit/delete affordances, no financial columns, no cost or
 * margin — and the manager backend enforces all of that independently (financial
 * fields are stripped server-side; write endpoints don't exist on the manager
 * router). It reuses the SAME shared search/filters/table/drawer as the owner
 * module; the difference is entirely in the props (manager columns, no financials,
 * read-only banner, copy/print row actions).
 */
export default function ManagerProductsPage() {
  const { filters, setFilters, page, limit, setPage, reset, hasActiveFilters, serverParams } =
    useProductFilters(20);

  const [detailId, setDetailId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useManagerProducts(serverParams);
  const { data: detail, isLoading: detailLoading } = useManagerProduct(detailId ?? undefined);
  const { data: categories = [] } = useManagerCategories();
  const { data: brands = [] } = useManagerBrands();

  const products = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Product Catalog</h1>
          <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" /> Read-only
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Search and browse the catalog to assist customers. Pricing and inventory changes require
          Owner access.
        </p>
      </div>

      <ManagerProductDashboard products={products} loading={isLoading} />

      <div className="flex flex-col gap-4">
        <ProductSearch
          value={filters.search}
          onDebouncedChange={(v) => setFilters({ search: v })}
          loading={isFetching}
        />
        <ProductFilters
          filters={filters}
          onChange={setFilters}
          onReset={reset}
          categories={categories}
          brands={brands}
          hasActiveFilters={hasActiveFilters}
        />
      </div>

      {isError ? (
        <ErrorState message="Failed to load products." onRetry={() => refetch()} />
      ) : isLoading ? (
        <ProductTableSkeleton columns={MANAGER_COLUMNS.length} />
      ) : products.length === 0 ? (
        <ProductEmptyState
          filtered={hasActiveFilters}
          {...(hasActiveFilters ? { action: { label: "Clear filters", onClick: reset } } : {})}
        />
      ) : (
        <ProductTable
          products={products}
          columns={MANAGER_COLUMNS}
          onRowClick={(p) => setDetailId(p.id)}
          renderActions={(p) => (
            <ManagerProductRowActions product={p} onView={(row) => setDetailId(row.id)} />
          )}
        />
      )}

      {total > 0 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}

      <ProductDetailsDrawer
        open={!!detailId}
        onClose={() => setDetailId(null)}
        product={detail}
        loading={detailLoading}
        showFinancials={false}
        readOnlyBanner
        // Managers may see WHY a price is what it is; the server strips cost,
        // margin and profit from the response, so no financials leak here.
        renderPricingDetail={(productId) => <EffectivePricePanel productId={productId} />}
      />
    </div>
  );
}
