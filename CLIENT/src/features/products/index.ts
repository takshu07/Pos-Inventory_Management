/**
 * Public API for the Products Feature
 * 
 * Strict Architectural Rule:
 * Other domains (e.g., Sales, Inventory) may ONLY import from this index.ts file.
 * They are FORBIDDEN from importing deep into /components or /api.
 */

// Export Types needed by other modules (e.g., when building a cart, Sales needs to know what a Product is)
export type { Product } from "./types";

// Export Top-Level Views (consumed by the React Router in src/app/router/index.tsx)
export { ProductsView } from "./views/ProductsView";

// Export Shared Components (e.g., if Sales needs a mini-product selector)
// export { ProductSelector } from "./components/ProductSelector";

// Export shared hooks if necessary
// export { useProducts } from "./hooks/useProducts";
