/**
 * Settings — public surface.
 *
 * The centralized settings architecture. Store Settings is the first screen
 * built on it; Receipt & Invoice Settings and Barcode Settings are expected to
 * reuse everything here except their own page component and section list.
 *
 * TO BUILD ANOTHER SETTINGS SCREEN:
 *   1. `useSettingsForm({ blocks: ["invoiceConfig"], validate })` — loading,
 *      dirty tracking, minimal-patch diffing, version conflict handling and the
 *      unsaved-changes guard all come with it.
 *   2. Lay the fields out with `SettingsSection` / `SettingsRow` /
 *      `SettingsToggle` so it matches the other screens by construction.
 *   3. `SettingsSaveBar` for the commit affordance, `CriticalChangeDialog` if
 *      any field belongs in `CRITICAL_FIELDS`.
 *   4. Reuse `SettingsSkeleton` / `SettingsErrorState` for the non-happy paths.
 *
 * Nothing new is needed in the API or hook layer — `GET/PATCH /settings` already
 * carries every block.
 */

// ── Pages ───────────────────────────────────────────────────────────────────
export { StoreSettingsPage } from "./pages/StoreSettingsPage";

// ── Data layer ──────────────────────────────────────────────────────────────
export { settingsKeys, useSettings, useUpdateSettings, applyPatch } from "./hooks/useSettings";
export { useSettingsForm } from "./hooks/useSettingsForm";
export type { FieldErrors, SettingsValidator } from "./hooks/useSettingsForm";

/**
 * Consumption hooks — how screens OUTSIDE this feature read configuration.
 * Each returns a usable value even before settings load, and for roles that
 * cannot read the settings endpoint at all. See useStoreConfig.ts.
 */
export {
  useConfiguration,
  useCurrencyFormatter,
  useDateFormatter,
  useDefaultPageSize,
  useLowStockThreshold,
  useStoreIdentity,
} from "./hooks/useStoreConfig";

// ── Form infrastructure ─────────────────────────────────────────────────────
export {
  SettingsRow,
  SettingsSaveBar,
  SettingsSection,
  SettingsToggle,
} from "./components/SettingsPrimitives";
export { SettingsErrorState, SettingsSkeleton } from "./components/SettingsStates";
export { CriticalChangeDialog } from "./components/CriticalChangeDialog";

// ── Validation ──────────────────────────────────────────────────────────────
export {
  CRITICAL_FIELDS,
  findCriticalChanges,
  validateStoreSettings,
} from "./validation";

// ── Utilities ───────────────────────────────────────────────────────────────
export { countChanges } from "./utils/patch";
export * from "./utils/options";

// ── Types ───────────────────────────────────────────────────────────────────
export type {
  ConfigBlockName,
  ExchangeConfig,
  FullConfiguration,
  IntegrationConfig,
  InventoryConfig,
  InvoiceConfig,
  PricingConfig,
  ReportingConfig,
  SecurityConfig,
  SettingsPatch,
  StoreConfig,
  StoreStatus,
  SystemConfig,
} from "./types";
