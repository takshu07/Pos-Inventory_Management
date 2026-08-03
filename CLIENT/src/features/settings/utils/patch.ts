/**
 * Settings — patch inspection helpers.
 *
 * Small, pure, and unit-tested, because the save bar's "N unsaved changes"
 * count is the only thing telling the user how much they are about to commit.
 */

import type { SettingsPatch } from "../types";

/**
 * Counts individual changed FIELDS in a patch, not blocks.
 *
 * A patch of `{ pricingConfig: { a, b }, storeName }` is three changes, not two:
 * the user changed three things and the save bar has to say so. `expectedVersion`
 * is concurrency metadata rather than a change, so it is never counted.
 */
export function countChanges(patch: SettingsPatch): number {
  let count = 0;

  for (const [key, value] of Object.entries(patch)) {
    if (key === "expectedVersion") continue;
    if (value === undefined) continue;

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      count += Object.keys(value as Record<string, unknown>).length;
    } else {
      count += 1;
    }
  }

  return count;
}
