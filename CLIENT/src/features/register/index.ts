/**
 * Cash Register — public barrel.
 *
 * The router imports pages from here. Components and hooks are exported too so
 * the POS screen can surface the drawer state (a cashier needs to know why
 * checkout is blocked) without reaching into the feature's internals.
 */

export { default as CashRegisterPage } from "./pages/CashRegisterPage";
export { default as RegisterHistoryPage } from "./pages/RegisterHistoryPage";
export { default as ShiftSummaryPage } from "./pages/ShiftSummaryPage";
export { default as DropsPayoutsPage } from "./pages/DropsPayoutsPage";

export {
  useLiveRegister,
  useRegisterHistory,
  useRegisterNumbers,
  useShiftSummary,
  useOpenRegister,
  useCloseRegister,
  useReconcileRegister,
  useCreateCashDrop,
  useCreateCashPayout,
  registerKeys,
} from "./hooks/useRegister";

export { ActivityTimeline } from "./components/ActivityTimeline";
export {
  DenominationCounter,
  totalDenominations,
  compactDenominations,
  DENOMINATIONS,
} from "./components/DenominationCounter";
export {
  OpenRegisterDialog,
  CloseRegisterDialog,
  CashDropDialog,
  CashPayoutDialog,
} from "./components/RegisterDialogs";

export type * from "./types";
