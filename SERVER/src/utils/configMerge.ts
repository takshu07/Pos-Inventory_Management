/**
 * Pure merge helper for the settings singleton's JSON config blocks.
 *
 * Extracted from configuration.service.ts so the rule can be tested without a
 * database. The service holds the orchestration (read → merge → validate →
 * write → reload); this file holds the one decision that actually loses data
 * when it is wrong.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * Each `*Config` column is a single JSON document. Prisma writes whatever object
 * it is given to the whole column, so assigning a partial patch silently deletes
 * every key the patch did not mention. Because the engine re-parses each block
 * through a Zod schema whose fields all have `.default()`, the deleted keys come
 * back as stock defaults instead of throwing — a store that had a 5% cashier
 * discount cap reverts to the shipped default and nothing anywhere reports an
 * error. Merging before the write is what prevents that.
 */

/**
 * Shallow key-by-key merge of `patch` over `stored`.
 *
 * SHALLOW IS DELIBERATE. Every field across all nine config blocks is a scalar
 * or an array (`defaultExchangeReasons`). A deep/recursive merge would make
 * arrays impossible to shorten — dropping an exchange reason would merge
 * index-wise and leave the old tail in place — so arrays must replace
 * wholesale, which is exactly what assignment does.
 *
 * `undefined` values are skipped, so a key the caller omitted (or one the
 * validation layer normalised away, which is how an emptied optional field is
 * encoded) never overwrites a stored value with nothing.
 *
 * A stored value that is missing, null, or not a plain object is treated as an
 * empty document rather than inherited — a corrupt column should not make the
 * next save fail, and Zod will re-apply defaults for whatever is absent.
 */
export function mergeConfigBlock(
  stored: unknown,
  patch: Record<string, unknown> | undefined
): Record<string, unknown> {
  const base: Record<string, unknown> =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? { ...(stored as Record<string, unknown>) }
      : {};

  if (!patch) return base;

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) base[key] = value;
  }
  return base;
}
