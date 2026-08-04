/**
 * Store Settings — /admin/settings.
 *
 * The configuration surface for the whole business: identity, trading rules,
 * regional formatting, UI defaults, security policy, and notification channels.
 *
 * RBAC: OWNER-only. `OwnerRoute` guards the route, and `GET/PATCH /configuration`
 * independently 403 for anyone else (configuration.routes.ts). The server is the
 * boundary — the route guard and the sidebar are affordances, not controls.
 *
 * WHY EVERYTHING IS ON ONE PAGE
 * -----------------------------
 * These settings are read together and cross-reference each other: the discount
 * ladder only makes sense next to the maximum discount, the session timeout only
 * next to the sign-in duration. Splitting them across tabbed routes would hide
 * exactly the relationships the validation enforces. The section nav gives
 * direct access without fragmenting the document.
 *
 * WHAT PROPAGATES WHEN YOU SAVE
 * -----------------------------
 * Every field here feeds server-side business rules through ConfigurationEngine:
 * pricing/tax → sale totals; discount limits → checkout approval; exchange
 * window → return eligibility; inventory → stock rules; store identity →
 * receipts and labels. The engine reloads its cache on write, and
 * `useUpdateSettings` invalidates the client caches derived from configuration,
 * so both sides converge without a reload.
 */

import { useMemo, useState } from "react";
import {
  Building2,
  Globe,
  Percent,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

import { Input, Select } from "@/components/ui";
import { CriticalChangeDialog } from "../components/CriticalChangeDialog";
import {
  SettingsRow,
  SettingsSaveBar,
  SettingsSection,
  SettingsToggle,
} from "../components/SettingsPrimitives";
import { SettingsErrorState, SettingsSkeleton } from "../components/SettingsStates";
import { useSettingsForm } from "../hooks/useSettingsForm";
import { findCriticalChanges, validateStoreSettings } from "../validation";
import {
  CURRENCY_OPTIONS,
  DASHBOARD_PERIOD_OPTIONS,
  DATE_FORMAT_OPTIONS,
  HOUR_OPTIONS,
  LANDING_PAGE_OPTIONS,
  LOCALE_OPTIONS,
  ROUNDING_OPTIONS,
  STORE_STATUS_OPTIONS,
  TABLE_DENSITY_OPTIONS,
  TIME_FORMAT_OPTIONS,
  TIMEZONE_OPTIONS,
} from "../utils/options";
import { countChanges } from "../utils/patch";

/** The blocks this screen owns. Receipt/Barcode screens will pass their own. */
const OWNED_BLOCKS = [
  "storeConfig",
  "pricingConfig",
  "exchangeConfig",
  "inventoryConfig",
  "reportingConfig",
  "securityConfig",
  "systemConfig",
  "integrationConfig",
] as const;

const SECTIONS = [
  { id: "store-information", label: "Store Information" },
  { id: "business-configuration", label: "Business" },
  { id: "regional-preferences", label: "Regional" },
  { id: "system-preferences", label: "System" },
  { id: "security", label: "Security" },
  { id: "integrations", label: "Integrations" },
] as const;

export function StoreSettingsPage() {
  const form = useSettingsForm({
    blocks: OWNED_BLOCKS,
    includeScalars: true,
    validate: validateStoreSettings,
  });

  const {
    draft,
    isLoading,
    isError,
    error,
    refetch,
    isSaving,
    isDirty,
    isFieldDirty,
    patch,
    errorFor,
    setField,
    setScalar,
    save,
    reset,
  } = form;

  const [confirming, setConfirming] = useState(false);

  /** Which pending changes warrant an explicit confirmation. */
  const criticalPaths = useMemo(
    () => findCriticalChanges(patch as Record<string, unknown>),
    [patch]
  );

  const changeCount = useMemo(() => countChanges(patch), [patch]);

  /** Routes through the dialog only when something critical is pending. */
  function handleSave() {
    if (criticalPaths.length > 0) {
      setConfirming(true);
      return;
    }
    void save();
  }

  async function handleConfirmedSave() {
    const ok = await save();
    // Keep the dialog up on failure so the server's reason stays next to the
    // action that caused it; closing would leave only a toast.
    if (ok) setConfirming(false);
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5 p-4 sm:p-6">
        <PageHeader />
        <SettingsSkeleton />
      </div>
    );
  }

  if (isError || !draft) {
    return (
      <div className="flex flex-col gap-5 p-4 sm:p-6">
        <PageHeader />
        <SettingsErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  const store = draft.storeConfig;
  const pricing = draft.pricingConfig;
  const exchange = draft.exchangeConfig;
  const inventory = draft.inventoryConfig;
  const reporting = draft.reportingConfig;
  const security = draft.securityConfig;
  const system = draft.systemConfig;
  const integrations = draft.integrationConfig;

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader version={draft.version} />

      {/* Section nav — horizontal and scrollable on phones, where a sidebar
          would cost more width than the form itself. */}
      <nav
        aria-label="Settings sections"
        className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      >
        <ul className="flex w-max gap-1 sm:w-auto sm:flex-wrap">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="inline-flex h-8 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-4">
        {/* ══ STORE INFORMATION ══════════════════════════════════════════ */}
        <SettingsSection
          id="store-information"
          title="Store Information"
          description="Identity and contact details. These appear on receipts, invoices and printed labels."
          icon={<Building2 className="h-5 w-5" />}
        >
          <SettingsRow
            label="Store name"
            description="Printed at the top of every receipt and label."
            dirty={draft.storeName !== form.server?.storeName}
            error={errorFor("storeName")}
          >
            <Input
              value={draft.storeName}
              onChange={(e) => setScalar("storeName", e.target.value)}
              placeholder="e.g. CEX Fashion Store"
              maxLength={120}
            />
          </SettingsRow>

          <SettingsRow
            label="Store status"
            description="Closed and Maintenance signal that the store is not trading."
            dirty={isFieldDirty("storeConfig", "storeStatus")}
            error={errorFor("storeConfig.storeStatus")}
          >
            <Select
              value={store.storeStatus}
              options={STORE_STATUS_OPTIONS}
              onChange={(e) =>
                setField("storeConfig", "storeStatus", e.target.value as typeof store.storeStatus)
              }
            />
          </SettingsRow>

          <SettingsRow
            label="GST number"
            description="Tax registration number shown on invoices."
            dirty={isFieldDirty("storeConfig", "gstNumber")}
            error={errorFor("storeConfig.gstNumber")}
          >
            <Input
              value={store.gstNumber ?? ""}
              onChange={(e) => setField("storeConfig", "gstNumber", e.target.value)}
              placeholder="e.g. 29ABCDE1234F1Z5"
            />
          </SettingsRow>

          <SettingsRow
            label="Address"
            description="Full postal address, as it should appear on documents."
            dirty={isFieldDirty("storeConfig", "address")}
            error={errorFor("storeConfig.address")}
          >
            <textarea
              value={store.address ?? ""}
              onChange={(e) => setField("storeConfig", "address", e.target.value)}
              rows={3}
              placeholder="Street, city, state, PIN"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </SettingsRow>

          <SettingsRow
            label="Phone"
            dirty={isFieldDirty("storeConfig", "phone")}
            error={errorFor("storeConfig.phone")}
          >
            <Input
              type="tel"
              value={store.phone ?? ""}
              onChange={(e) => setField("storeConfig", "phone", e.target.value)}
              placeholder="e.g. +91 98765 43210"
            />
          </SettingsRow>

          <SettingsRow
            label="Email"
            dirty={isFieldDirty("storeConfig", "email")}
            error={errorFor("storeConfig.email")}
          >
            <Input
              type="email"
              value={store.email ?? ""}
              onChange={(e) => setField("storeConfig", "email", e.target.value)}
              placeholder="store@example.com"
            />
          </SettingsRow>

          <SettingsRow
            label="Website"
            dirty={isFieldDirty("storeConfig", "website")}
            error={errorFor("storeConfig.website")}
          >
            <Input
              type="url"
              value={store.website ?? ""}
              onChange={(e) => setField("storeConfig", "website", e.target.value)}
              placeholder="https://example.com"
            />
          </SettingsRow>

          <SettingsRow
            label="Logo URL"
            description="Used on receipts and labels. Leave empty to print the store name as text."
            dirty={isFieldDirty("storeConfig", "logoUrl")}
            error={errorFor("storeConfig.logoUrl")}
          >
            <Input
              type="url"
              value={store.logoUrl ?? ""}
              onChange={(e) => setField("storeConfig", "logoUrl", e.target.value)}
              placeholder="https://example.com/logo.png"
            />
          </SettingsRow>

          <SettingsRow
            label="Business hours"
            description="Free text, shown on receipts. Trading rules are not enforced from this."
            dirty={isFieldDirty("storeConfig", "businessHours")}
            error={errorFor("storeConfig.businessHours")}
          >
            <Input
              value={store.businessHours ?? ""}
              onChange={(e) => setField("storeConfig", "businessHours", e.target.value)}
              placeholder="e.g. Mon–Sat, 10:00–21:00"
            />
          </SettingsRow>
        </SettingsSection>

        {/* ══ BUSINESS CONFIGURATION ═════════════════════════════════════ */}
        <SettingsSection
          id="business-configuration"
          title="Business Configuration"
          description="Pricing, tax, discounts, exchanges and stock rules. These are applied to every transaction."
          icon={<Percent className="h-5 w-5" />}
        >
          <SettingsRow
            label="Prices include tax"
            description="On: catalog prices are tax-inclusive and tax is derived from them. Off: tax is added at checkout."
            dirty={isFieldDirty("pricingConfig", "taxInclusive")}
          >
            <SettingsToggle
              label="Prices include tax"
              checked={pricing.taxInclusive}
              onChange={(v) => setField("pricingConfig", "taxInclusive", v)}
            />
          </SettingsRow>

          <SettingsRow
            label="Default tax rate (%)"
            description="Applied to products without their own tax rate."
            dirty={isFieldDirty("pricingConfig", "defaultTaxRate")}
            error={errorFor("pricingConfig.defaultTaxRate")}
          >
            <Input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={pricing.defaultTaxRate}
              onChange={(e) =>
                setField("pricingConfig", "defaultTaxRate", numberFrom(e.target.value))
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Rounding strategy"
            description="How the final payable amount is rounded to whole currency units."
            dirty={isFieldDirty("pricingConfig", "roundingStrategy")}
          >
            <Select
              value={pricing.roundingStrategy}
              options={ROUNDING_OPTIONS}
              onChange={(e) =>
                setField(
                  "pricingConfig",
                  "roundingStrategy",
                  e.target.value as typeof pricing.roundingStrategy
                )
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Decimal precision"
            description="Digits kept in intermediate price calculations."
            dirty={isFieldDirty("pricingConfig", "decimalPrecision")}
            error={errorFor("pricingConfig.decimalPrecision")}
          >
            <Input
              type="number"
              min={0}
              max={4}
              value={pricing.decimalPrecision}
              onChange={(e) =>
                setField("pricingConfig", "decimalPrecision", numberFrom(e.target.value))
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Maximum discount (%)"
            description="The store-wide ceiling. No role may discount beyond this, whatever their own limit says."
            dirty={isFieldDirty("pricingConfig", "maximumDiscountPercent")}
            error={errorFor("pricingConfig.maximumDiscountPercent")}
          >
            <Input
              type="number"
              min={0}
              max={100}
              value={pricing.maximumDiscountPercent}
              onChange={(e) =>
                setField("pricingConfig", "maximumDiscountPercent", numberFrom(e.target.value))
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Cashier discount limit (%)"
            description="The most a cashier can discount without approval."
            dirty={isFieldDirty("pricingConfig", "cashierDiscountLimit")}
            error={errorFor("pricingConfig.cashierDiscountLimit")}
          >
            <Input
              type="number"
              min={0}
              max={100}
              value={pricing.cashierDiscountLimit}
              onChange={(e) =>
                setField("pricingConfig", "cashierDiscountLimit", numberFrom(e.target.value))
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Manager discount limit (%)"
            description="Must be at least the cashier limit and no more than the owner limit."
            dirty={isFieldDirty("pricingConfig", "managerDiscountLimit")}
            error={errorFor("pricingConfig.managerDiscountLimit")}
          >
            <Input
              type="number"
              min={0}
              max={100}
              value={pricing.managerDiscountLimit}
              onChange={(e) =>
                setField("pricingConfig", "managerDiscountLimit", numberFrom(e.target.value))
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Owner discount limit (%)"
            dirty={isFieldDirty("pricingConfig", "ownerDiscountLimit")}
            error={errorFor("pricingConfig.ownerDiscountLimit")}
          >
            <Input
              type="number"
              min={0}
              max={100}
              value={pricing.ownerDiscountLimit}
              onChange={(e) =>
                setField("pricingConfig", "ownerDiscountLimit", numberFrom(e.target.value))
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Exchange window (days)"
            description="How long after a sale an exchange stays eligible. 0 disables exchanges."
            dirty={isFieldDirty("exchangeConfig", "exchangeWindowDays")}
            error={errorFor("exchangeConfig.exchangeWindowDays")}
          >
            <Input
              type="number"
              min={0}
              value={exchange.exchangeWindowDays}
              onChange={(e) =>
                setField("exchangeConfig", "exchangeWindowDays", numberFrom(e.target.value))
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Require original bill for exchange"
            dirty={isFieldDirty("exchangeConfig", "billRequired")}
          >
            <SettingsToggle
              label="Require original bill for exchange"
              checked={exchange.billRequired}
              onChange={(v) => setField("exchangeConfig", "billRequired", v)}
            />
          </SettingsRow>

          <SettingsRow
            label="Require tags intact for exchange"
            dirty={isFieldDirty("exchangeConfig", "tagsRequired")}
          >
            <SettingsToggle
              label="Require tags intact for exchange"
              checked={exchange.tagsRequired}
              onChange={(v) => setField("exchangeConfig", "tagsRequired", v)}
            />
          </SettingsRow>

          <SettingsRow
            label="Manager approval for exchanges"
            description="Requires a manager to authorise every exchange."
            dirty={isFieldDirty("exchangeConfig", "managerOverrideRequired")}
          >
            <SettingsToggle
              label="Manager approval for exchanges"
              checked={exchange.managerOverrideRequired}
              onChange={(v) => setField("exchangeConfig", "managerOverrideRequired", v)}
            />
          </SettingsRow>

          <SettingsRow
            label="Allow negative stock"
            description="Lets the POS sell items the system shows as out of stock. Stock counts will disagree with the ledger."
            dirty={isFieldDirty("inventoryConfig", "allowNegativeStock")}
          >
            <SettingsToggle
              label="Allow negative stock"
              checked={inventory.allowNegativeStock}
              onChange={(v) => setField("inventoryConfig", "allowNegativeStock", v)}
            />
          </SettingsRow>

          <SettingsRow
            label="Low stock threshold"
            description="Units at or below this count are flagged for replenishment."
            dirty={isFieldDirty("inventoryConfig", "lowStockThreshold")}
            error={errorFor("inventoryConfig.lowStockThreshold")}
          >
            <Input
              type="number"
              min={0}
              value={inventory.lowStockThreshold}
              onChange={(e) =>
                setField("inventoryConfig", "lowStockThreshold", numberFrom(e.target.value))
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Automatic SKU generation"
            description="Generates a SKU when a product is created without one."
            dirty={isFieldDirty("inventoryConfig", "autoSkuGeneration")}
          >
            <SettingsToggle
              label="Automatic SKU generation"
              checked={inventory.autoSkuGeneration}
              onChange={(v) => setField("inventoryConfig", "autoSkuGeneration", v)}
            />
          </SettingsRow>

          <SettingsRow
            label="Cart reservation (minutes)"
            description="How long stock stays held for an open cart before it is released."
            dirty={isFieldDirty("inventoryConfig", "inventoryReservationMins")}
            error={errorFor("inventoryConfig.inventoryReservationMins")}
          >
            <Input
              type="number"
              min={0}
              value={inventory.inventoryReservationMins}
              onChange={(e) =>
                setField("inventoryConfig", "inventoryReservationMins", numberFrom(e.target.value))
              }
            />
          </SettingsRow>
        </SettingsSection>

        {/* ══ REGIONAL PREFERENCES ═══════════════════════════════════════ */}
        <SettingsSection
          id="regional-preferences"
          title="Regional Preferences"
          description="Currency, time zone and the financial year. These decide how amounts and dates are interpreted across the system."
          icon={<Globe className="h-5 w-5" />}
        >
          <SettingsRow
            label="Currency"
            description="Existing prices and past sales are not converted — only the symbol changes."
            dirty={draft.currency !== form.server?.currency}
            error={errorFor("currency")}
          >
            <Select
              value={draft.currency}
              options={CURRENCY_OPTIONS}
              onChange={(e) => setScalar("currency", e.target.value)}
            />
          </SettingsRow>

          <SettingsRow
            label="Time zone"
            description="Anchors business days, shifts, reports and the exchange window."
            dirty={draft.timeZone !== form.server?.timeZone}
            error={errorFor("timeZone")}
          >
            <Select
              value={draft.timeZone}
              options={TIMEZONE_OPTIONS}
              onChange={(e) => setScalar("timeZone", e.target.value)}
            />
          </SettingsRow>

          <SettingsRow
            label="Financial year starts"
            description="MM-DD. Drives financial-year reporting and invoice number resets."
            dirty={isFieldDirty("storeConfig", "financialYearStart")}
            error={errorFor("storeConfig.financialYearStart")}
          >
            <Input
              value={store.financialYearStart}
              onChange={(e) => setField("storeConfig", "financialYearStart", e.target.value)}
              placeholder="04-01"
            />
          </SettingsRow>

          <SettingsRow
            label="Business day starts"
            description="Sales before this hour are reported against the previous business day."
            dirty={isFieldDirty("reportingConfig", "businessDayStartHour")}
            error={errorFor("reportingConfig.businessDayStartHour")}
          >
            <Select
              value={String(reporting.businessDayStartHour)}
              options={HOUR_OPTIONS}
              onChange={(e) =>
                setField("reportingConfig", "businessDayStartHour", Number(e.target.value))
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Business day ends"
            dirty={isFieldDirty("reportingConfig", "businessDayEndHour")}
            error={errorFor("reportingConfig.businessDayEndHour")}
          >
            <Select
              value={String(reporting.businessDayEndHour)}
              options={HOUR_OPTIONS}
              onChange={(e) =>
                setField("reportingConfig", "businessDayEndHour", Number(e.target.value))
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Default dashboard period"
            dirty={isFieldDirty("reportingConfig", "defaultDashboardPeriod")}
          >
            <Select
              value={reporting.defaultDashboardPeriod}
              options={DASHBOARD_PERIOD_OPTIONS}
              onChange={(e) =>
                setField(
                  "reportingConfig",
                  "defaultDashboardPeriod",
                  e.target.value as typeof reporting.defaultDashboardPeriod
                )
              }
            />
          </SettingsRow>
        </SettingsSection>

        {/* ══ SYSTEM PREFERENCES ═════════════════════════════════════════ */}
        <SettingsSection
          id="system-preferences"
          title="System Preferences"
          description="How information is displayed in the admin app. These affect presentation only — no business rule reads them."
          icon={<SlidersHorizontal className="h-5 w-5" />}
        >
          <SettingsRow
            label="Date format"
            dirty={isFieldDirty("systemConfig", "dateFormat")}
          >
            <Select
              value={system.dateFormat}
              options={DATE_FORMAT_OPTIONS}
              onChange={(e) =>
                setField("systemConfig", "dateFormat", e.target.value as typeof system.dateFormat)
              }
            />
          </SettingsRow>

          <SettingsRow label="Time format" dirty={isFieldDirty("systemConfig", "timeFormat")}>
            <Select
              value={system.timeFormat}
              options={TIME_FORMAT_OPTIONS}
              onChange={(e) =>
                setField("systemConfig", "timeFormat", e.target.value as typeof system.timeFormat)
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Number format"
            description="Decides digit grouping — 1,00,000 (Indian) vs 100,000 (Western)."
            dirty={isFieldDirty("systemConfig", "numberLocale")}
          >
            <Select
              value={system.numberLocale}
              options={LOCALE_OPTIONS}
              onChange={(e) => setField("systemConfig", "numberLocale", e.target.value)}
            />
          </SettingsRow>

          <SettingsRow
            label="Default landing page"
            description="Where the app opens after signing in."
            dirty={isFieldDirty("systemConfig", "defaultLandingPage")}
          >
            <Select
              value={system.defaultLandingPage}
              options={LANDING_PAGE_OPTIONS}
              onChange={(e) =>
                setField(
                  "systemConfig",
                  "defaultLandingPage",
                  e.target.value as typeof system.defaultLandingPage
                )
              }
            />
          </SettingsRow>

          <SettingsRow label="Table density" dirty={isFieldDirty("systemConfig", "tableDensity")}>
            <Select
              value={system.tableDensity}
              options={TABLE_DENSITY_OPTIONS}
              onChange={(e) =>
                setField(
                  "systemConfig",
                  "tableDensity",
                  e.target.value as typeof system.tableDensity
                )
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Rows per page"
            description="Default page size for lists across the admin app."
            dirty={isFieldDirty("systemConfig", "itemsPerPage")}
            error={errorFor("systemConfig.itemsPerPage")}
          >
            <Input
              type="number"
              min={10}
              max={100}
              step={5}
              value={system.itemsPerPage}
              onChange={(e) =>
                setField("systemConfig", "itemsPerPage", numberFrom(e.target.value))
              }
            />
          </SettingsRow>
        </SettingsSection>

        {/* ══ SECURITY ═══════════════════════════════════════════════════ */}
        <SettingsSection
          id="security"
          title="Security"
          description="Session and account-protection policy. Changes apply to everyone, including you."
          icon={<ShieldCheck className="h-5 w-5" />}
        >
          <SettingsRow
            label="Session timeout (minutes)"
            description="Idle time before a session ends. Cannot exceed the sign-in duration."
            dirty={isFieldDirty("securityConfig", "sessionTimeoutMins")}
            error={errorFor("securityConfig.sessionTimeoutMins")}
          >
            <Input
              type="number"
              min={5}
              value={security.sessionTimeoutMins}
              onChange={(e) =>
                setField("securityConfig", "sessionTimeoutMins", numberFrom(e.target.value))
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Sign-in duration (hours)"
            description="How long a sign-in stays valid before credentials are required again."
            dirty={isFieldDirty("securityConfig", "jwtExpirationHours")}
            error={errorFor("securityConfig.jwtExpirationHours")}
          >
            <Input
              type="number"
              min={1}
              value={security.jwtExpirationHours}
              onChange={(e) =>
                setField("securityConfig", "jwtExpirationHours", numberFrom(e.target.value))
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Maximum login attempts"
            description="Failed attempts before the account is locked."
            dirty={isFieldDirty("securityConfig", "maxLoginAttempts")}
            error={errorFor("securityConfig.maxLoginAttempts")}
          >
            <Input
              type="number"
              min={3}
              value={security.maxLoginAttempts}
              onChange={(e) =>
                setField("securityConfig", "maxLoginAttempts", numberFrom(e.target.value))
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Account lock duration (minutes)"
            dirty={isFieldDirty("securityConfig", "accountLockDurationMins")}
            error={errorFor("securityConfig.accountLockDurationMins")}
          >
            <Input
              type="number"
              min={1}
              value={security.accountLockDurationMins}
              onChange={(e) =>
                setField("securityConfig", "accountLockDurationMins", numberFrom(e.target.value))
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Audit log retention (days)"
            description="How long the audit trail is kept. Minimum 30 days."
            dirty={isFieldDirty("securityConfig", "auditLogRetentionDays")}
            error={errorFor("securityConfig.auditLogRetentionDays")}
          >
            <Input
              type="number"
              min={30}
              value={security.auditLogRetentionDays}
              onChange={(e) =>
                setField("securityConfig", "auditLogRetentionDays", numberFrom(e.target.value))
              }
            />
          </SettingsRow>
        </SettingsSection>

        {/* ══ INTEGRATIONS ═══════════════════════════════════════════════ */}
        <SettingsSection
          id="integrations"
          title="Integrations"
          description="Outbound notification channels. Credentials are configured on the server, never here."
          icon={<Plug className="h-5 w-5" />}
        >
          <SettingsRow
            label="Email notifications"
            dirty={isFieldDirty("integrationConfig", "emailEnabled")}
          >
            <SettingsToggle
              label="Email notifications"
              checked={integrations.emailEnabled}
              onChange={(v) => setField("integrationConfig", "emailEnabled", v)}
            />
          </SettingsRow>

          <SettingsRow
            label="Sender email"
            description="The address notifications are sent from."
            dirty={isFieldDirty("integrationConfig", "senderEmail")}
            error={errorFor("integrationConfig.senderEmail")}
          >
            <Input
              type="email"
              value={integrations.senderEmail ?? ""}
              onChange={(e) => setField("integrationConfig", "senderEmail", e.target.value)}
              placeholder="noreply@example.com"
            />
          </SettingsRow>

          <SettingsRow label="SMS notifications" dirty={isFieldDirty("integrationConfig", "smsEnabled")}>
            <SettingsToggle
              label="SMS notifications"
              checked={integrations.smsEnabled}
              onChange={(v) => setField("integrationConfig", "smsEnabled", v)}
            />
          </SettingsRow>

          <SettingsRow
            label="WhatsApp notifications"
            dirty={isFieldDirty("integrationConfig", "whatsappEnabled")}
          >
            <SettingsToggle
              label="WhatsApp notifications"
              checked={integrations.whatsappEnabled}
              onChange={(v) => setField("integrationConfig", "whatsappEnabled", v)}
            />
          </SettingsRow>

          <SettingsRow
            label="Support phone"
            description="Shown to customers on receipts and notifications."
            dirty={isFieldDirty("integrationConfig", "supportPhone")}
            error={errorFor("integrationConfig.supportPhone")}
          >
            <Input
              type="tel"
              value={integrations.supportPhone ?? ""}
              onChange={(e) => setField("integrationConfig", "supportPhone", e.target.value)}
              placeholder="+91 98765 43210"
            />
          </SettingsRow>

          <SettingsRow
            label="Low stock alerts"
            description="Notifies when a product crosses the low stock threshold."
            dirty={isFieldDirty("integrationConfig", "lowStockAlertsEnabled")}
          >
            <SettingsToggle
              label="Low stock alerts"
              checked={integrations.lowStockAlertsEnabled}
              onChange={(v) => setField("integrationConfig", "lowStockAlertsEnabled", v)}
            />
          </SettingsRow>

          <SettingsRow
            label="Daily summary"
            description="Sends a sales summary at the end of each business day."
            dirty={isFieldDirty("integrationConfig", "dailySummaryEnabled")}
          >
            <SettingsToggle
              label="Daily summary"
              checked={integrations.dailySummaryEnabled}
              onChange={(v) => setField("integrationConfig", "dailySummaryEnabled", v)}
            />
          </SettingsRow>
        </SettingsSection>
      </div>

      <SettingsSaveBar
        visible={isDirty}
        saving={isSaving}
        changeCount={changeCount}
        onSave={handleSave}
        onDiscard={reset}
      />

      <CriticalChangeDialog
        open={confirming}
        paths={criticalPaths}
        saving={isSaving}
        onConfirm={() => void handleConfirmedSave()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

function PageHeader({ version }: { version?: number }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Store Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configuration for the whole business. Changes apply to future
          transactions and are recorded in the audit log.
        </p>
      </div>
      {version !== undefined && (
        <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
          Revision {version}
        </span>
      )}
    </div>
  );
}

/**
 * Parses a number input's value.
 *
 * An empty input yields NaN, which React renders as a blank and then submits as
 * `null` — so it is coerced to 0 and left for validation to reject if the field
 * has a minimum. Returning NaN would put the input into an uncontrolled state
 * mid-edit.
 */
function numberFrom(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
