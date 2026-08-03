/**
 * Settings — React Query hooks. The shared data layer for every settings screen.
 *
 * ONE cache entry holds the whole configuration. Store Settings, Receipt &
 * Invoice and Barcode Settings all read `settingsKeys.all` and all write through
 * `useUpdateSettings`, so a change made on one screen is visible on the others
 * without any cross-screen invalidation logic.
 *
 * WHY THE UPDATE IS OPTIMISTIC — AND WHERE IT ISN'T
 * ------------------------------------------------
 * Toggling a switch should feel instant, so the cache is patched before the
 * round-trip and rolled back on failure. That is safe for these fields because
 * the server's response replaces the cache wholesale on success, so an
 * optimistic guess never survives longer than one request.
 *
 * It is NOT safe to let an optimistic write imply the change took effect
 * elsewhere. Settings feed live business rules — pricing, exchange windows,
 * inventory — so anything that reads those must be invalidated only AFTER the
 * server confirms. That is why `onSettled` invalidates rather than `onMutate`.
 *
 * STALENESS: settings change rarely and are read constantly. A long staleTime
 * avoids refetching a document that is almost never different, and the mutation
 * seeds the cache directly from the write response, so the UI is current
 * without a follow-up GET.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import * as api from "../api/settingsApi";
import type { FullConfiguration, SettingsPatch } from "../types";

// =============================================================================
// QUERY KEYS
// A single factory so an invalidation can never miss a key by mistyping it.
// =============================================================================

export const settingsKeys = {
  all: ["settings"] as const,
  configuration: () => [...settingsKeys.all, "configuration"] as const,
};

/**
 * Settings are edited by one person, rarely, and every write refreshes this
 * cache from the server's response. Ten minutes avoids pointless refetches
 * without ever showing a value the app itself changed.
 */
const SETTINGS_STALE_MS = 10 * 60_000;

// =============================================================================
// QUERY
// =============================================================================

/**
 * The full configuration.
 *
 * Consumers that only need one value should use the derived hooks in
 * `useStoreConfig.ts` rather than destructuring this everywhere — that keeps the
 * number of components re-rendering on an unrelated settings change small.
 */
export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.configuration(),
    queryFn: api.fetchSettings,
    staleTime: SETTINGS_STALE_MS,
    // A 403 means this user is not an OWNER; retrying cannot change that and
    // just delays the error state behind three failed round-trips.
    retry: (failureCount, error) => {
      const status = (error as { status?: number }).status;
      if (status === 403 || status === 401) return false;
      return failureCount < 2;
    },
  });
}

// =============================================================================
// MUTATION
// =============================================================================

/** Surfaces the server's own message; it is more specific than anything generic. */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Applies a partial settings update.
 *
 * `patch` should carry ONLY changed fields. The caller may include
 * `expectedVersion` to opt into conflict detection; `useSettingsForm` does this
 * automatically, so a second owner saving over your edit is refused rather than
 * silently winning.
 */
export function useUpdateSettings() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.updateSettings(patch),

    // ── Optimistic patch ────────────────────────────────────────────────────
    onMutate: async (patch) => {
      // Stop any in-flight GET from landing after our optimistic write and
      // overwriting it with pre-change data.
      await qc.cancelQueries({ queryKey: settingsKeys.configuration() });

      const previous = qc.getQueryData<FullConfiguration>(settingsKeys.configuration());
      if (previous) {
        qc.setQueryData<FullConfiguration>(
          settingsKeys.configuration(),
          applyPatch(previous, patch)
        );
      }
      return { previous };
    },

    onError: (error, _patch, context) => {
      // Put the pre-mutation snapshot back, so the form is not left showing a
      // value the server rejected.
      if (context?.previous) {
        qc.setQueryData(settingsKeys.configuration(), context.previous);
      }

      const reason = api.settingsErrorReason(error);
      if (reason === "SETTINGS_VERSION_CONFLICT") {
        // Not a validation failure — the user's input was fine, someone else
        // just got there first. Say that, rather than blaming their input.
        toast.error(
          "Someone else changed these settings while you were editing. Reload to see the current values."
        );
        return;
      }

      if (reason === "SETTINGS_CONSTRAINT_VIOLATION") {
        // Report every broken rule, not just the first, or fixing one reveals
        // the next on the following save attempt.
        const conflicts = api.settingsConflicts(error);
        toast.error(conflicts[0] ?? errorMessage(error, "These settings conflict."), {
          description: conflicts.length > 1 ? conflicts.slice(1).join(" ") : undefined,
        });
        return;
      }

      toast.error(errorMessage(error, "Could not save the settings."));
    },

    onSuccess: (fresh) => {
      // Seed from the SERVER's post-merge state, not from the optimistic guess:
      // it carries the new `version` and any normalisation the server applied
      // (uppercased currency, trimmed text, cleared optional fields).
      qc.setQueryData(settingsKeys.configuration(), fresh);
    },

    onSettled: () => {
      // Settings feed live business rules — pricing limits, exchange windows,
      // low-stock thresholds, invoice numbering. Anything already cached from
      // before the change is now potentially stale, so drop it and let the
      // screens that need it refetch. Deliberately AFTER the server confirms.
      invalidateConfigDependentCaches(qc);
    },
  });
}

/**
 * Caches whose contents are derived from configuration.
 *
 * Kept as one list so a future settings-dependent feature is registered in a
 * single place rather than discovered later as a stale-data bug. These are
 * top-level key prefixes, matching the `*Keys.all` factories each feature
 * exports.
 */
const CONFIG_DEPENDENT_KEYS = [
  "products",   // sellingPrice reflects pricing/tax config
  "sales",      // totals, rounding, invoice numbering
  "exchange",   // eligibility window
  "inventory",  // low-stock threshold, negative-stock rule
  "dashboard",  // default period, business-day boundaries
  "reports",    // business-day boundaries
  "labels",     // store name/address/logo on printed labels
] as const;

function invalidateConfigDependentCaches(qc: ReturnType<typeof useQueryClient>) {
  for (const key of CONFIG_DEPENDENT_KEYS) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

/**
 * Merges a patch into a cached configuration for the optimistic update.
 *
 * Mirrors the server's merge rule exactly — block-level shallow assign, skipping
 * `undefined` — so the optimistic state matches what the server will compute.
 * If these two ever disagree the UI flickers on save, which is the visible
 * symptom to look for. `expectedVersion` is stripped: it is concurrency
 * metadata, not configuration, and must never land in the cached document.
 */
export function applyPatch(
  current: FullConfiguration,
  patch: SettingsPatch
): FullConfiguration {
  const { expectedVersion: _ignored, ...rest } = patch;
  const next: FullConfiguration = { ...current };

  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      // A config block: merge over the existing block.
      next[key as keyof FullConfiguration] = {
        ...(current[key as keyof FullConfiguration] as object),
        ...(value as object),
      } as never;
    } else {
      // A scalar: storeName / currency / timeZone.
      next[key as keyof FullConfiguration] = value as never;
    }
  }

  return next;
}
