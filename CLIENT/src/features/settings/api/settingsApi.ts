/**
 * Settings — transport layer.
 *
 * ONE endpoint family backs every settings screen: `GET /configuration` returns
 * the whole document, `PATCH /configuration` accepts any subset of it. Store
 * Settings and Receipt & Invoice are two views over the same document, not two
 * resources — which is why this file has two functions and no per-screen
 * variants. (Barcode Settings is NOT one of them: it belongs to the Label
 * Engine and uses `/owner/labels/settings` — see docs/CONFIGURATION_OWNERSHIP.md.)
 *
 * RBAC: both verbs are OWNER-only server-side (configuration.routes.ts). The
 * route guard on the client is a UX affordance; the 403 is the boundary.
 *
 * PATCH SEMANTICS — the part that matters:
 * The server merges each config block over the stored value key-by-key, so a
 * payload naming one field changes exactly that field. Callers should send ONLY
 * what changed. Sending a full block still works, but re-audits fields nobody
 * touched, which makes the audit trail useless for answering "who changed the
 * tax rate".
 */

import { apiClient } from "@/lib/api";
import type { FullConfiguration, SettingsPatch } from "../types";

/**
 * The server mounts this document at `/configuration` (`app.ts` →
 * `configuration.routes.ts`), NOT at `/settings`.
 *
 * ⚠ This was `/settings` until 2026-08-03, which resolved to `/api/v1/settings`
 * — a path the server has never mounted. Every Store Settings and Receipt &
 * Invoice Settings read and write returned 404. Nothing caught it because the
 * settings tests only exercised pure functions and never asserted a URL; the
 * routing is now pinned in `__tests__/settingsApi.test.ts`.
 *
 * The module is named "settings" and the endpoint is named "configuration".
 * That mismatch is the whole reason the bug was easy to write, so do not
 * "align" this constant to the folder name.
 */
const BASE = "/configuration";

/**
 * Reads the full configuration.
 *
 * Served from the server's in-memory ConfigurationEngine cache, so this is a
 * memory lookup rather than a database read — cheap enough that the app can hold
 * it as a long-lived query rather than threading it through props.
 */
export async function fetchSettings(): Promise<FullConfiguration> {
  const res = await apiClient.get<any>(BASE);
  return res.data;
}

/**
 * Applies a partial update and returns the full post-merge configuration.
 *
 * The response is the server's authoritative state after the write, including
 * the incremented `version` — so callers should seed their cache from the
 * RESPONSE rather than from what they optimistically assumed.
 *
 * Two failures are expected here and are handled by name upstream:
 *   • 409 `SETTINGS_VERSION_CONFLICT`    — someone else saved while editing.
 *   • 400 `SETTINGS_CONSTRAINT_VIOLATION` — cross-field rule broken (e.g. the
 *     discount ladder inverted). `details.conflicts` carries every problem, not
 *     just the first.
 */
export async function updateSettings(patch: SettingsPatch): Promise<FullConfiguration> {
  const res = await apiClient.patch<any>(BASE, patch);
  return res.data;
}

/** Machine-readable reasons the server attaches to a rejected save. */
export type SettingsErrorReason =
  | "SETTINGS_VERSION_CONFLICT"
  | "SETTINGS_CONSTRAINT_VIOLATION";

/**
 * Reads the server's structured failure reason off a rejected request.
 *
 * The axios interceptor copies the response body's `details` onto the Error, so
 * this stays a plain `instanceof Error` check for every other caller.
 */
export function settingsErrorReason(error: unknown): SettingsErrorReason | undefined {
  const details = (error as { details?: { reason?: string } } | undefined)?.details;
  const reason = details?.reason;
  return reason === "SETTINGS_VERSION_CONFLICT" || reason === "SETTINGS_CONSTRAINT_VIOLATION"
    ? reason
    : undefined;
}

/** Every cross-field problem the server found, when it rejected for that reason. */
export function settingsConflicts(error: unknown): string[] {
  const details = (error as { details?: { conflicts?: unknown } } | undefined)?.details;
  return Array.isArray(details?.conflicts) ? (details.conflicts as string[]) : [];
}
