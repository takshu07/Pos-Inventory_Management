// =============================================================================
// SCALAR LIST BRIDGE
//
// SQLite has no array type. The generated local mirror therefore stores the
// schema's two scalar-list fields as JSON text:
//
//     Product.imageUrls   String[]  →  String  (default "[]")
//     Shift.workingDays   Int[]     →  String  (default "[1,2,3,4,5,6]")
//
// This Prisma client extension makes that storage decision INVISIBLE to calling
// code. `product.imageUrls` is a `string[]` whether the query ran against Neon
// or against SQLite, and `create({ data: { imageUrls: [...] } })` works the same
// on both. That matters because the whole premise of this feature is that the
// 40-odd existing services keep working unchanged — if callers had to branch on
// the datasource, the offline layer would have leaked into business logic.
//
// ── Why matching on field NAME is safe here ──────────────────────────────────
// The walker rewrites any property called `imageUrls` or `workingDays`, at any
// depth, rather than tracking which model each nested object belongs to (which
// Prisma's runtime does not hand to an extension). That is only sound while
// those names are globally unique across the schema — so the generator asserts
// exactly that and fails the build if a second model ever introduces a field of
// the same name. See scripts/generate-local-schema.ts.
// =============================================================================

import manifest from "../../../prisma/local/manifest.json" with { type: "json" };

// =============================================================================
// FIELD REGISTRY (derived from the generated manifest, never hand-listed)
// =============================================================================

/** Field name → the element type it decodes to, for defaulting on bad data. */
const SCALAR_LIST_FIELDS: ReadonlyMap<string, string> = new Map(
  Object.entries(manifest.scalarListFields as Record<string, string[]>).flatMap(
    ([modelName, fields]) => {
      const model = manifest.models.find((m) => m.name === modelName);
      return fields.map((field): [string, string] => {
        const column = model?.columns.find((c) => c.name === field);
        return [field, column?.type ?? "String"];
      });
    }
  )
);

/** Models that directly own a scalar-list field — the fast-path filter. */
const MODELS_WITH_SCALAR_LISTS: ReadonlySet<string> = new Set(
  Object.keys(manifest.scalarListFields as Record<string, string[]>)
);

export function scalarListFieldNames(): readonly string[] {
  return [...SCALAR_LIST_FIELDS.keys()];
}

// =============================================================================
// ENCODE (application value → SQLite text)
// =============================================================================

/**
 * Encodes one scalar-list value for storage.
 *
 * Handles the three shapes Prisma accepts for a list field:
 *   `[...]`            plain assignment on create/update
 *   `{ set: [...] }`   explicit set on update
 *   `{ push: ... }`    NOT supported — see below
 */
function encodeListValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  if (value !== null && typeof value === "object") {
    const operation = value as Record<string, unknown>;

    if (Array.isArray(operation["set"])) {
      return JSON.stringify(operation["set"]);
    }

    if ("push" in operation) {
      // `push` is a read-modify-write against a real array column. Emulating it
      // would need the current row, which an argument-level rewrite does not
      // have — and silently dropping it would lose an image. Fail loudly.
      throw new Error(
        "Prisma's list `push` operator is not supported on the local SQLite " +
          "mirror. Read the row, append in application code, and write the " +
          "whole array back."
      );
    }
  }

  // Already a JSON string, or null/undefined — pass through untouched.
  return value;
}

// =============================================================================
// DECODE (SQLite text → application value)
// =============================================================================

function decodeListValue(value: unknown, elementType: string): unknown {
  if (typeof value !== "string") {
    // Already decoded, or null. Nothing to do.
    return value;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    // Int[] survives a JSON round trip as numbers, but a value written by an
    // older build (or by the sync engine from a Postgres payload) could be a
    // numeric string. Coerce rather than hand a string to arithmetic.
    if (elementType === "Int" || elementType === "Float") {
      return parsed.map((entry) => Number(entry));
    }
    return parsed;
  } catch {
    // Corrupt JSON in one column must not fail the whole query — an empty list
    // degrades a product to "no images", which is recoverable, while a thrown
    // error would take the till down mid-sale.
    return [];
  }
}

// =============================================================================
// RECURSIVE WALKERS
// =============================================================================

/** Depth guard — Prisma args/results are shallow; this only stops cycles. */
const MAX_DEPTH = 12;

/**
 * True for values that are objects but must be passed to Prisma BY REFERENCE,
 * never walked into and rebuilt.
 *
 * `Prisma.Decimal` is the one that bites. A Decimal carries its digits in own
 * enumerable properties — `Object.keys(new Decimal(5000))` is
 * `["constructor","s","e","d"]` — so the generic `{ ...source }` copy below
 * produces a PLAIN object with a `constructor` key and no Decimal prototype.
 * Prisma then rejects the write with:
 *
 *     Invalid value for argument `constructor`: We could not serialize
 *     [object Function] value.
 *
 * That fired on any write carrying a Decimal anywhere in its args — opening a
 * cash register, which blocks every sale on the till. It is matched by shape
 * rather than by `instanceof` so a Decimal from either generated client (or a
 * future decimal.js copy) is covered without importing a client here.
 */
function isOpaqueValue(node: object): boolean {
  if (node instanceof Date) return true;
  if (ArrayBuffer.isView(node) || node instanceof ArrayBuffer) return true;

  // Matched by SHAPE, deliberately. The obvious check — `constructor.name ===
  // "Decimal"` — silently fails: the bundled client minifies the class to
  // `Decimal2`, so a name test lets the value through and the bug returns.
  // decimal.js instances always carry sign/exponent/digits as `s`/`e`/`d` and
  // expose `toFixed`, and nothing in a Prisma args tree looks like that by
  // accident.
  const candidate = node as { s?: unknown; e?: unknown; d?: unknown; toFixed?: unknown };
  return (
    typeof candidate.toFixed === "function" &&
    typeof candidate.s === "number" &&
    typeof candidate.e === "number"
  );
}

function encodeArgs(node: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || node === null || typeof node !== "object") {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map((entry) => encodeArgs(entry, depth + 1));
  }

  if (isOpaqueValue(node)) return node;

  const source = node as Record<string, unknown>;
  let result: Record<string, unknown> | undefined;

  for (const key of Object.keys(source)) {
    const value = source[key];
    const rewritten = SCALAR_LIST_FIELDS.has(key)
      ? encodeListValue(value)
      : encodeArgs(value, depth + 1);

    if (rewritten !== value) {
      // Copy on first change only — an untouched args object is passed through
      // by reference, which keeps the common case allocation-free.
      result ??= { ...source };
      result[key] = rewritten;
    }
  }

  return result ?? node;
}

function decodeResult(node: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || node === null || typeof node !== "object") {
    return node;
  }

  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      node[index] = decodeResult(node[index], depth + 1);
    }
    return node;
  }

  // Same reasoning as encodeArgs: a Decimal read back from SQLite must not be
  // walked into. Here the damage would be subtler — the object survives, but
  // recursing over `s`/`e`/`d` is pure waste on every priced row read.
  if (isOpaqueValue(node)) return node;

  const record = node as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    const elementType = SCALAR_LIST_FIELDS.get(key);
    record[key] =
      elementType === undefined
        ? decodeResult(record[key], depth + 1)
        : decodeListValue(record[key], elementType);
  }

  // Mutating in place is safe: this object was just materialized by Prisma for
  // this call and has no other owner. Cloning every row would double the
  // allocation cost of every read on the hot POS path.
  return record;
}

// =============================================================================
// THE EXTENSION
// =============================================================================

/**
 * Decides whether a call can possibly touch a scalar-list field.
 *
 * Queries on models that own no list field and pull in no relations skip the
 * walk entirely — which is most POS reads.
 */
function mayContainScalarList(model: string | undefined, args: unknown): boolean {
  if (model !== undefined && MODELS_WITH_SCALAR_LISTS.has(model)) return true;

  if (args !== null && typeof args === "object") {
    const shape = args as Record<string, unknown>;
    if (shape["include"] !== undefined || shape["select"] !== undefined) {
      return true;
    }
  }

  // Raw queries and $transaction have no model; let them through unwalked —
  // raw SQL sees the stored JSON text, which is the correct behavior for it.
  return false;
}

/**
 * The `$extends` argument that installs the bridge.
 *
 * Applied ONLY to the local SQLite client. The cloud client has real Postgres
 * arrays and must not be touched.
 */
export const scalarListBridgeExtension = {
  name: "offline-scalar-list-bridge",
  query: {
    $allModels: {
      async $allOperations({
        model,
        args,
        query,
      }: {
        model: string;
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
      }): Promise<unknown> {
        if (!mayContainScalarList(model, args)) {
          return query(args);
        }

        const result = await query(encodeArgs(args));
        return decodeResult(result);
      },
    },
  },
} as const;

// Exported for direct unit testing of the codec without a database.
export const __testing = { encodeArgs, decodeResult, encodeListValue, decodeListValue };
