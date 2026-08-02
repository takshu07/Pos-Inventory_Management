/**
 * Finance — public barrel.
 * The router imports pages from here; hooks are exported for cross-module use
 * (the Reports profit screen reuses the same P&L definitions).
 */

export { default as FinanceDashboardPage } from "./pages/FinanceDashboardPage";
export { default as ProfitLossPage } from "./pages/ProfitLossPage";
export { default as CashFlowPage } from "./pages/CashFlowPage";
export { default as RevenuePage } from "./pages/RevenuePage";
export { default as ExpensesPage } from "./pages/ExpensesPage";
export { default as PayablesPage } from "./pages/PayablesPage";
export { default as SalariesPage } from "./pages/SalariesPage";
export { default as PaymentAnalyticsPage } from "./pages/PaymentAnalyticsPage";

export {
  useFinanceDashboard,
  useRevenue,
  useProfitLoss,
  useCashFlow,
  usePaymentAnalytics,
  useExpenses,
  useExpenseCategories,
  usePayables,
  useSalaries,
  financeKeys,
} from "./hooks/useFinance";

export type * from "./types";
