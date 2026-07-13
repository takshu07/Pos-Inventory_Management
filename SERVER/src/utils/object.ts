// =============================================================================
// OBJECT UTILITIES
// =============================================================================

/**
 * Removes undefined properties from an object.
 * Necessary for Prisma when exactOptionalPropertyTypes is enabled in tsconfig,
 * as Prisma will throw type errors if undefined is passed to an optional field
 * during an update.
 */
export function stripUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}
