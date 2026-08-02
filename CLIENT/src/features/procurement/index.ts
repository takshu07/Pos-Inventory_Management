/**
 * Procurement feature — public API.
 *
 * The router lazy-imports the pages; nothing else should reach into this
 * feature's internals. The payment dialog and the supplier picker hook are
 * exported because Finance legitimately needs them — settling a bill is a
 * finance action performed against procurement data — but the api layer stays
 * private so this module owns how purchases, suppliers and brands are fetched.
 */

export { default as PurchasesPage } from "./pages/PurchasesPage";
export { default as PurchaseDetailPage } from "./pages/PurchaseDetailPage";
export { default as SuppliersPage } from "./pages/SuppliersPage";
export { default as SupplierProfilePage } from "./pages/SupplierProfilePage";
export { default as BrandsPage } from "./pages/BrandsPage";

/** Reusable wherever a supplier payment can be recorded. */
export { RecordPaymentDialog } from "./components/RecordPaymentDialog";

/** Shared status vocabulary — keeps procurement chips identical everywhere. */
export {
  PurchaseStatusBadge,
  SettlementBadge,
  ReceiptProgressBar,
} from "./components/ProcurementAtoms";

export {
  procurementKeys,
  useSupplierOptions,
  useRecordPayment,
} from "./hooks/useProcurement";

export type {
  Brand,
  PurchaseDetail,
  PurchaseRow,
  PurchaseStatus,
  SettlementStatus,
  Supplier,
  SupplierDetail,
} from "./types";
