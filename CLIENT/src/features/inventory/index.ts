/**
 * Inventory Management feature — public API.
 *
 * The router lazy-imports the pages; nothing else should reach into this
 * feature's internals. Types and the drawer are exported because other modules
 * legitimately need them — the POS may want to show stock, and a product screen
 * may want to open the inventory drawer for a variant — but the api layer and
 * the rest of the components stay private so this module owns how stock data is
 * fetched and rendered.
 */

export { default as InventoryDashboardPage } from "./pages/InventoryDashboardPage";
export { default as StockOverviewPage } from "./pages/StockOverviewPage";
export { default as MovementsPage } from "./pages/MovementsPage";
export { default as AdjustmentsPage } from "./pages/AdjustmentsPage";
export { default as CycleCountsPage } from "./pages/CycleCountsPage";
export { default as CycleCountSessionPage } from "./pages/CycleCountSessionPage";
export { default as ValuationPage } from "./pages/ValuationPage";
export { default as DamagedStockPage } from "./pages/DamagedStockPage";
export { default as LowStockPage } from "./pages/LowStockPage";
export { default as OutOfStockPage } from "./pages/OutOfStockPage";
export { default as ReorderPage } from "./pages/ReorderPage";
export { default as DeadStockPage } from "./pages/DeadStockPage";
export { default as FastMovingPage } from "./pages/FastMovingPage";
export { default as SlowMovingPage } from "./pages/SlowMovingPage";

/** Owner-only stock adjustment / damage dialog, reusable from any stock row. */
export { AdjustStockDialog } from "./components/AdjustStockDialog";

/** Reusable everywhere an employee can click through to stock detail. */
export { InventoryDrawer } from "./components/InventoryDrawer";

export {
  useStock,
  useInventoryDetail,
  useScan,
  inventoryKeys,
} from "./hooks/useInventory";

export type {
  StockRow,
  InventoryDetail,
  MovementRow,
  MovementType,
  StockStatus,
  StockVelocity,
} from "./types";
