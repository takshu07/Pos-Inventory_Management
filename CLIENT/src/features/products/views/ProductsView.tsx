import { useState } from "react";
import { ProductList } from "../components/ProductList";

/**
 * View: ProductsView
 * Responsibility: Acts as the top-level Page for the Products feature.
 * Coordinates local state (search, filters) and passes them to dumb components.
 */
export function ProductsView() {
  const [search, setSearch] = useState("");

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground mt-1">Manage your catalog, pricing, and tax rules.</p>
        </div>
        
        {/* Placeholder for future shared Button component */}
        <button className="bg-primary text-primary-foreground px-4 py-2 rounded-md shadow hover:bg-primary/90">
          Add Product
        </button>
      </div>

      <div className="flex gap-4 mb-4">
        <input 
          type="text" 
          placeholder="Search products..." 
          className="border border-input bg-background rounded-md px-3 py-2 w-full max-w-md focus:outline-none focus:ring-2 focus:ring-ring"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <ProductList searchQuery={search} />
    </div>
  );
}
