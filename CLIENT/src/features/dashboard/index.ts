/**
 * @file features/dashboard/index.ts
 *
 * Purpose: Public API for the Dashboard feature module.
 *
 * Exposes only what is needed by the rest of the application (e.g., the router).
 * Internal details (like widgets, specific hooks, admin vs employee) remain hidden.
 */

// We don't export the View directly here to enable lazy loading in the router.
// Wait, the router imports using `lazy()`, so we don't strictly need to export it here,
// but we can export it as default if needed by other non-lazy imports.

export { default as DashboardView } from "./views/DashboardView";
