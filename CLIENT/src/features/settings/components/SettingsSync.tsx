/**
 * SettingsSync — pushes store configuration into the global formatters.
 *
 * WHY THIS COMPONENT EXISTS
 * -------------------------
 * `formatCurrency` in utils/formatters.ts is called from roughly 650 places,
 * many of which are not React components at all — chart tick formatters, table
 * column definitions, CSV export builders. Those cannot consume a hook. Rather
 * than refactor every call site (large, risky, and impossible for the non-React
 * ones), this component subscribes to the settings query once and pushes the
 * currency and number locale into the formatter module. Every existing call site
 * then renders the store's configured currency without being modified.
 *
 * Renders nothing. Mounted once, inside the query provider.
 *
 * ⚠ RBAC: `GET /configuration` is OWNER-only, so for a MANAGER or CASHIER this query
 * would 403. It is therefore gated on the signed-in role, and for everyone else
 * the formatters keep their defaults — which is why every default here mirrors
 * the server's Zod defaults exactly. A cashier seeing the default currency
 * symbol is a cosmetic gap, never an incorrect amount: all money is computed
 * server-side and arrives already correct.
 *
 * ⚠ If the store's currency is ever configured to something other than the
 * default, cashier-facing screens will render the default symbol until the
 * currency is exposed on a non-owner endpoint. Deliberately not done here:
 * widening who can read the settings document is a security decision, not a
 * formatting one.
 *
 * TODO(settings): once `GET /configuration/public` exists (spec in
 * docs/STORE_SETTINGS.md §8), drop the `isOwner` gate below and read that
 * endpoint instead. The fallbacks in useStoreConfig.ts stay either way — they
 * are still the pre-load path.
 */

import { useEffect } from "react";

import { selectRole, useAuthStore } from "@/store/auth.store";
import { configureCurrencyFormatting } from "@/utils/formatters";
import { useSettings } from "../hooks/useSettings";

export function SettingsSync() {
  const role = useAuthStore(selectRole);
  const isOwner = role === "OWNER";

  // Gated on the role: the endpoint 403s for anyone else, and an unconditional
  // query here would fire a guaranteed failure on every non-owner session.
  // Shares its key with the Store Settings page, so this does not cause a second
  // request — that page reads the cache this fills.
  const { data } = useSettings({ enabled: isOwner });

  useEffect(() => {
    if (!isOwner || !data) return;
    configureCurrencyFormatting(data.currency, data.systemConfig.numberLocale);
  }, [isOwner, data]);

  return null;
}
