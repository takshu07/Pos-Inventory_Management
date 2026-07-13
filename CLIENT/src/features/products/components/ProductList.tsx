import { useProducts } from "../hooks/useProducts";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

interface ProductListProps {
  searchQuery?: string;
  categoryId?: string;
}

/**
 * Component: ProductList
 * Responsibility: Presentational container that consumes the useProducts hook.
 * Strictly tied to the Products domain.
 */
export function ProductList({ searchQuery, categoryId }: ProductListProps) {
  const { data, isLoading, isError, error } = useProducts({ 
    search: searchQuery, 
    categoryId 
  });

  if (isLoading) {
    return <div className="py-8"><LoadingSpinner /></div>;
  }

  if (isError) {
    return <div className="text-destructive p-4 border border-destructive rounded-md">Error loading products: {error?.message}</div>;
  }

  if (!data?.data.length) {
    return <div className="text-muted-foreground p-8 text-center">No products found.</div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {data.data.map((product) => (
        <div key={product.id} className="p-4 border bg-card rounded-lg shadow-sm">
          <h3 className="font-medium text-lg truncate">{product.name}</h3>
          <p className="text-sm text-muted-foreground mt-1">HSN: {product.hsnCode}</p>
          <div className="mt-4 flex justify-between items-center">
            <span className="font-bold">₹{Number(product.finalPrice).toFixed(2)}</span>
            <span className={`text-xs px-2 py-1 rounded-full ${product.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {product.isActive ? "Active" : "Inactive"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
