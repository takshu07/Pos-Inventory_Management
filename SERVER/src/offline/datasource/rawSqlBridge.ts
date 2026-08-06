// =============================================================================
// RAW SQL BRIDGE
//
// Applies the dialect translation to every `$queryRaw` / `$executeRaw` that
// passes through the LOCAL client, so the repositories keep their single copy
// of each query and nobody has to maintain a Postgres version and a SQLite
// version of the same margin calculation.
//
// ── Both call shapes, because they carry SQL differently ─────────────────────
//
//   $queryRawUnsafe(sql, ...params)     args = [sql, ...params]
//                                       → rewrite args[0]
//
//   $queryRaw`SELECT … ${value} …`      args = { strings, values }
//                                       → join on `?`, rewrite, split back
//
// ── Why the template is joined before translating ────────────────────────────
// A tagged template is cut at PARAMETER boundaries, and Postgres casts land
// exactly on those boundaries:
//
//     $queryRaw`… (${now}::timestamp - "loginAt") …`
//
// arrives as the fragments "… (" and "::timestamp - \"loginAt\") …". Translating
// each fragment on its own, the second one begins with a cast that has no
// operand in front of it — and emits `CAST( AS TEXT)`. That was a real bug
// found by running the finance and workforce queries, not a hypothetical.
//
// Joining the fragments on `?` first hands the translator a complete, valid
// statement where `?::timestamp` is an ordinary cast over a parameter. The
// result is split back on `?`, and the placeholder count is asserted to be
// unchanged — if translation ever moved or dropped one, every bound value after
// it would silently shift by a position, so that case refuses to execute.
//
// The values themselves are NEVER interpolated. Flattening them into the SQL to
// translate it as one string would turn every one of these queries into a SQL
// injection.
// =============================================================================

import { logger } from "../../config/logger";

import { needsTranslation, translateSql } from "./sqlDialect";

// =============================================================================
// SHAPES
// =============================================================================

interface TaggedTemplateArgs {
  readonly strings: string[];
  readonly values: unknown[];
}

function isTaggedTemplate(args: unknown): args is TaggedTemplateArgs {
  return (
    typeof args === "object" &&
    args !== null &&
    Array.isArray((args as TaggedTemplateArgs).strings)
  );
}

/** What a bound parameter is stood in by while the statement is translated. */
const PLACEHOLDER = "?";

/**
 * Splits a translated statement back into template fragments on `?`.
 *
 * Quote-aware: a `?` inside a string literal is data, not a placeholder, and
 * splitting on it would tear the literal in half and shift every subsequent
 * value onto the wrong parameter.
 */
function splitOnPlaceholders(sql: string): string[] {
  const fragments: string[] = [];

  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index] as string;

    if (char === "'" && !inDouble) inSingle = !inSingle;
    else if (char === '"' && !inSingle) inDouble = !inDouble;

    if (char === PLACEHOLDER && !inSingle && !inDouble) {
      fragments.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fragments.push(current);
  return fragments;
}

// =============================================================================
// TRANSLATION
// =============================================================================

/**
 * Translates whichever shape the raw call arrived in.
 *
 * Returns the args unchanged when nothing needs rewriting, so the common case
 * costs one regex test.
 */
function translateArgs(args: unknown, operation: string): unknown {
  // ── Array-wrapped tagged template: [Sql] ───────────────────────────────────
  // What Prisma 7 actually hands a `$executeRaw` / `$queryRaw` query extension:
  // the `Sql` object boxed in a single-element array, NOT bare and NOT
  // `[string, ...params]`. Because it is an Array, the bare-template branch
  // below never matched it (`Array.isArray(args.strings)` is false on the
  // array itself), and because `args[0]` is an object rather than a string the
  // positional branch did not match either — so every tagged-template raw query
  // fell through to the "unrecognized shape" warning and was executed against
  // SQLite as untranslated POSTGRES.
  //
  // The failure was not subtle at the driver but was invisible in practice: the
  // warning is logged at WARN, and the one call site users hit constantly
  // (closeOpenSessions, on every login) is fire-and-forget, so the login still
  // succeeded and only the session row was silently never written.
  //
  // Unwrap, translate with the same logic as the bare shape, and re-box.
  if (Array.isArray(args) && args.length === 1 && isTaggedTemplate(args[0])) {
    const translated = translateTaggedTemplate(args[0]);
    // Preserve the original object when nothing changed, so the untouched path
    // stays allocation-free and `Sql` keeps its prototype.
    if (translated === args[0]) return args;
    return [translated];
  }

  // ── Tagged template: $queryRaw`…` ──────────────────────────────────────────
  if (isTaggedTemplate(args)) {
    return translateTaggedTemplate(args);
  }

  // ── Positional: $queryRawUnsafe(sql, ...params) ────────────────────────────
  if (Array.isArray(args) && typeof args[0] === "string") {
    const sql = args[0];

    if (!needsTranslation(sql)) return args;

    return [translateSql(sql), ...args.slice(1)];
  }

  logger.warn(
    { operation },
    "offline: raw query arrived in an unrecognized shape and was passed through untranslated"
  );

  return args;
}

/**
 * Translates one tagged-template statement, preserving the `Sql` object's own
 * prototype and any fields beyond `strings`/`values` — Prisma's `Sql` carries
 * internals the driver reads, so this must never rebuild it as a plain object.
 *
 * Returns the input unchanged when no translation is needed.
 */
function translateTaggedTemplate<T extends TaggedTemplateArgs>(args: T): T {
  const joined = args.strings.join(PLACEHOLDER);

  if (!needsTranslation(joined)) return args;

  // ── Translate the WHOLE statement, then split it back ──────────────────────
  // Translating each fragment on its own is WRONG, and quietly so. A tagged
  // template is cut at parameter boundaries, and a cast lands exactly on one:
  //
  //     $queryRaw`… (${now}::timestamp - "loginAt") …`
  //
  // splits into "… (" and "::timestamp - \"loginAt\") …". The second fragment
  // starts with `::timestamp` and has NO operand in front of it, so a
  // fragment-local rewrite emits `CAST( AS TEXT)` — a syntax error if you are
  // lucky, and a mangled expression if you are not.
  //
  // Joining on `?` first gives the translator a complete, valid statement in
  // which `?::timestamp` is an ordinary cast over a parameter. Splitting on
  // `?` afterwards restores the fragments, and the interleaving still lines
  // up because translation preserves the number and order of placeholders —
  // `?::timestamp` becomes `CAST(? AS TEXT)`, still exactly one `?`.
  const translated = translateSql(joined);
  const fragments = splitOnPlaceholders(translated);

  // If translation somehow changed the placeholder count, the fragments no
  // longer line up with the values and binding would silently shift every
  // parameter by one. Refuse rather than run it.
  if (fragments.length !== args.strings.length) {
    throw new Error(
      `SQLite translation changed the parameter count of a raw query ` +
        `(${args.strings.length - 1} → ${fragments.length - 1}). Refusing to ` +
        `execute it: mismatched placeholders would bind the wrong values.\n` +
        `  Query: ${joined.replace(/\s+/g, " ").slice(0, 300)}`
    );
  }

  // Rebuilt through Object.create so the result keeps the ORIGINAL prototype.
  // Prisma's `Sql` is a class instance the driver type-checks and reads
  // internals from; returning a plain `{ ...args }` object loses that
  // prototype, and the adapter then rejects it exactly like a bare string —
  // which is the same class of failure this branch exists to fix.
  const rebuilt: T = Object.create(
    Object.getPrototypeOf(args) as object,
    Object.getOwnPropertyDescriptors(args)
  ) as T;
  Object.defineProperty(rebuilt, "strings", {
    ...Object.getOwnPropertyDescriptor(args, "strings"),
    value: fragments,
  });

  return rebuilt;
}

// =============================================================================
// THE EXTENSION
// =============================================================================

type RawHandler = (params: {
  args: unknown;
  operation: string;
  query: (args: unknown) => Promise<unknown>;
}) => Promise<unknown>;

const handler: RawHandler = async ({ args, operation, query }) => {
  try {
    return await query(translateArgs(args, operation));
  } catch (error) {
    // A translation failure carries a message naming the exact construct and
    // the fix. Losing it inside a generic Prisma error would leave whoever hits
    // it staring at "near ON: syntax error" with 63 raw queries to search.
    if (error instanceof Error && error.message.includes("no safe SQLite translation")) {
      logger.error({ operation }, error.message);
    }
    throw error;
  }
};

/**
 * `$extends` argument that installs the bridge. Applied ONLY to the local
 * SQLite client — the cloud client runs the original Postgres SQL untouched.
 */
export const rawSqlBridgeExtension = {
  name: "offline-raw-sql-bridge",
  query: {
    $queryRaw: handler,
    $queryRawUnsafe: handler,
    $executeRaw: handler,
    $executeRawUnsafe: handler,
  },
} as const;

/** Exported for unit testing without a database. */
export const __testing = { translateArgs };
