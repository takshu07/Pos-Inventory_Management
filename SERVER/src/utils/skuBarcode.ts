// =============================================================================
// SKU & BARCODE GENERATION
//
// Deterministic, human-readable SKU generation and EAN-13-style barcode
// generation for the product creation wizard. These produce *candidate* codes;
// uniqueness is still enforced at the database (unique constraints) and checked
// in the service before insert. The wizard also lets the owner override any code
// manually, so these are conveniences, not the only path.
// =============================================================================

/** Uppercases, strips non-alphanumerics, and takes the first `len` chars. */
function code(input: string, len: number): string {
  const cleaned = (input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.slice(0, len) || "X".repeat(len);
}

export interface SkuParts {
  brand?: string | null;
  category?: string | null;
  productName: string;
  color: string;
  size: string;
  sequence: number;
}

/**
 * Builds an SKU like `BG-TSH-BLK-L-0001`:
 *   <brand(2)>-<category(3)>-<color(3)>-<size>-<seq(4)>
 * Brand is omitted if not provided. The sequence is zero-padded to 4 digits.
 */
export function generateSku(parts: SkuParts): string {
  const segments: string[] = [];
  if (parts.brand) segments.push(code(parts.brand, 2));
  segments.push(code(parts.category ?? parts.productName, 3));
  segments.push(code(parts.color, 3));
  segments.push(code(parts.size, 3));
  segments.push(String(parts.sequence).padStart(4, "0"));
  return segments.join("-");
}

/**
 * Computes the EAN-13 check digit for the first 12 digits.
 */
function ean13CheckDigit(twelve: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = twelve.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Generates a valid EAN-13 barcode. Uses a `200`-prefix (the GS1 range reserved
 * for in-store / internal use, so we never collide with real manufacturer GTINs)
 * followed by 9 digits derived from the seed + a random tail, then the check
 * digit. Callers must still verify uniqueness against the DB.
 */
export function generateBarcode(seed?: string | number): string {
  const prefix = "200";
  const seedNum = Math.abs(
    hashString(String(seed ?? Date.now())) % 1_000_000
  )
    .toString()
    .padStart(6, "0");
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  const twelve = (prefix + seedNum + rand).slice(0, 12);
  return twelve + String(ean13CheckDigit(twelve));
}

/** Validates an EAN-13 barcode's check digit (used for scanner verification). */
export function isValidEan13(barcode: string): boolean {
  if (!/^\d{13}$/.test(barcode)) return false;
  return ean13CheckDigit(barcode.slice(0, 12)) === barcode.charCodeAt(12) - 48;
}

/** Small deterministic string hash (FNV-1a-ish) for barcode seeding. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
