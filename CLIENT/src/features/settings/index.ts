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
 *
 * ⚠ BINDING CONSTRAINTS (set 2026-08-03, confirmed at review — see
 * docs/STORE_SETTINGS.md §9). These are decisions, not preferences:
 *
 *   • DO NOT DUPLICATE THIS INFRASTRUCTURE. No second dirty-check, no second
 *     patch differ, no locally-defined settings row. That is how three screens
 *     end up with three different unsaved-changes behaviours and only one of
 *     them correct. If a screen needs something this layer lacks, EXTEND THIS
 *     LAYER so every screen gets it.
 *
 *   • OPTIMISTIC CONCURRENCY IS MANDATORY. Every screen sends `expectedVersion`
 *     and handles 409 SETTINGS_VERSION_CONFLICT. `useSettingsForm` does this for
 *     you — you get it by using the hook and lose it by hand-rolling a mutation.
 *     The version covers the WHOLE document, so two owners on two different
 *     settings screens still conflict. That is correct: they are writing the
 *     same row.
 *
 *   • PATCHES MERGE, NEVER REPLACE. Send only changed fields. Replacing a
 *     config block silently reverts every field the patch did not mention to its
 *     Zod default, throwing nothing and logging nothing.
 */

// ── Pages ───────────────────────────────────────────────────────────────────
export { StoreSettingsPage } from "./pages/StoreSettingsPage";
export { ReceiptInvoiceSettingsPage } from "./pages/ReceiptInvoiceSettingsPage";

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

/**
 * Mounted once in AppProvider. Imported there by direct path rather than
 * through this barrel, so the app shell does not pull the Store Settings page
 * into the initial bundle.
 */
export { SettingsSync } from "./components/SettingsSync";

// ── Validation ──────────────────────────────────────────────────────────────
export {
  CRITICAL_FIELDS,
  findCriticalChanges,
  validateStoreSettings,
} from "./validation";
export { validateReceiptSettings } from "./validation/receipt";

// ── Utilities ───────────────────────────────────────────────────────────────
export { countChanges } from "./utils/patch";
export { previewInvoiceNumber } from "./utils/invoicePreview";
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
