// =============================================================================
// SQL DIALECT TRANSLATION  (Postgres source → SQLite)
//
// Ten files in this codebase drop to raw SQL for the analytics, reports,
// finance and workforce aggregates that Prisma cannot express. That SQL is
// written for Postgres. On an edge node it has to run on SQLite.
//
// ── The rule this module is built around ─────────────────────────────────────
// These queries compute REVENUE, MARGINS, STOCK VALUATION and PAYROLL. A
// translation that silently produces a slightly different number is far worse
// than one that refuses to run: an error gets fixed, a wrong total gets banked.
//
// So the translator has an explicit ALLOWLIST of constructs it understands, and
// `assertTranslatable` throws on anything else it recognizes as
// Postgres-specific. It never guesses.
//
// ── What actually needed doing, after checking rather than assuming ──────────
// Modern SQLite (3.53 here) already supports far more than its reputation
// suggests. Verified against the bundled engine, NOT taken on faith:
//
//     FILTER (WHERE …) on aggregates    supported   → no rewrite
//     window functions, OVER (…)        supported   → no rewrite
//     NULLS LAST                        supported   → no rewrite
//     CAST(x AS …)                      supported   → no rewrite
//     LIKE                              case-insensitive for ASCII by default
//
// That left only four genuine gaps, handled here:
//
//     x::type          → CAST(x AS type)      Postgres-only cast syntax
//     GREATEST/LEAST   → max()/min()          SQLite's scalar forms
//     ILIKE            → LIKE                 already case-insensitive
//     DATE_TRUNC(u, x) → strftime(...)        no SQLite equivalent
//
// and two that are NOT translated here because a text rewrite cannot do them
// safely — they are converted at the source into forms that run on both
// databases instead:
//
//     DISTINCT ON (…)  → ROW_NUMBER() OVER (PARTITION BY …)
//     = ANY(${array})  → IN (${Prisma.join(array)})
// =============================================================================

// =============================================================================
// UNSUPPORTED CONSTRUCTS
// =============================================================================

interface UnsupportedConstruct {
  readonly pattern: RegExp;
  readonly name: string;
  readonly fix: string;
}

const UNSUPPORTED: readonly UnsupportedConstruct[] = [
  {
    pattern: /\bDISTINCT\s+ON\b/i,
    name: "DISTINCT ON",
    fix:
      "rewrite as ROW_NUMBER() OVER (PARTITION BY … ORDER BY …) with an outer " +
      "WHERE rn = 1 — that form runs on Postgres AND SQLite, so there is one " +
      "query to maintain rather than two",
  },
  {
    // SQLite has no LATERAL. Without this entry the query reached the engine
    // untranslated and failed with `near "SELECT": syntax error` — a 500 that
    // named neither the construct nor the file, which is the exact outcome this
    // allowlist exists to prevent. customer.repository.ts hit this first (the
    // customers list 500'd on every edge node); reports.repository.ts still has
    // six occurrences, so the Product Report is the next one to surface.
    pattern: /\bLATERAL\b/i,
    name: "LATERAL join",
    fix:
      "pre-aggregate the correlated subquery into a GROUP BY over the join key " +
      "and LEFT JOIN on it (see customer.repository.ts customerTable) — the " +
      "GROUP BY keeps it one row per key, so the join cannot fan out, and the " +
      "same query then runs on Postgres AND SQLite. COALESCE the aggregates in " +
      "the OUTER select: a key with no matching rows has no row to join to, so " +
      "the columns come back NULL regardless of the subquery's own COALESCE",
  },
  {
    pattern: /=\s*ANY\s*\(/i,
    name: "= ANY(array)",
    fix:
      "rewrite as IN (${Prisma.join(values)}) — SQLite cannot bind an array " +
      "parameter, and Prisma.join expands to placeholders that work on both",
  },
  {
    pattern: /\bgenerate_series\s*\(/i,
    name: "generate_series()",
    fix: "build the series in TypeScript and pass it in, or join against a real table",
  },
  {
    // Only the EPOCH form is translated (see translateEpochDifference). Any
    // other field — YEAR, DOW, QUARTER — is refused rather than guessed at.
    pattern: /\bEXTRACT\s*\(\s*(?!EPOCH\b)\w+/i,
    name: "EXTRACT(<field> FROM …)",
    fix:
      "only EXTRACT(EPOCH FROM (a - b)) is translated; for other fields use " +
      "strftime() via a dialect-neutral expression, or compute in TypeScript",
  },
  {
    pattern: /\bsimilarity\s*\(|%\s*>|<->/,
    name: "pg_trgm operators",
    fix:
      "trigram similarity has no SQLite equivalent; fall back to LIKE for the " +
      "local search path",
  },
  {
    pattern: /::\s*(?:text|varchar|int|integer|bigint|numeric|decimal|float|real|boolean|bool|timestamp|timestamptz|date|uuid|jsonb?)\s*\[\s*\]/i,
    name: "array cast (::text[])",
    fix: "arrays cannot be bound in SQLite; use IN (${Prisma.join(values)})",
  },
];

/**
 * Throws if `sql` contains a construct this translator cannot safely convert.
 *
 * Deliberately called on every raw query on an edge node. The alternative —
 * letting SQLite reject it with "near ON: syntax error" — is a 500 with no
 * indication of which of 63 raw queries broke or what to do about it.
 */
export function assertTranslatable(sql: string): void {
  for (const construct of UNSUPPORTED) {
    if (construct.pattern.test(sql)) {
      throw new Error(
        `This raw SQL uses ${construct.name}, which has no safe SQLite ` +
          `translation, and this node is running on the local database.\n\n` +
          `  Fix: ${construct.fix}\n\n` +
          `  Query: ${sql.replace(/\s+/g, " ").trim().slice(0, 300)}`
      );
    }
  }
}

// =============================================================================
// CAST TRANSLATION
// =============================================================================

const CAST_TYPES: ReadonlyMap<string, string> = new Map([
  ["text", "TEXT"],
  ["varchar", "TEXT"],
  ["uuid", "TEXT"],
  ["int", "INTEGER"],
  ["int4", "INTEGER"],
  ["integer", "INTEGER"],
  ["int8", "INTEGER"],
  ["bigint", "INTEGER"],
  ["smallint", "INTEGER"],
  ["numeric", "REAL"],
  ["decimal", "REAL"],
  ["float", "REAL"],
  ["float8", "REAL"],
  ["double precision", "REAL"],
  ["real", "REAL"],
  ["boolean", "INTEGER"],
  ["bool", "INTEGER"],
  ["timestamp", "TEXT"],
  ["timestamptz", "TEXT"],
  ["date", "TEXT"],
]);

/**
 * Finds where the expression ending at `end` begins.
 *
 * `SUM(x)::bigint` casts the whole SUM(...) call, not the closing paren, so the
 * scan walks backwards over balanced parentheses and then over any identifier
 * (including a quoted one, and a `table."column"` pair) immediately before it.
 * Getting this wrong would move a cast onto the wrong sub-expression and change
 * the arithmetic — which is why it is a scan rather than a regex.
 */
function findExpressionStart(sql: string, end: number): number {
  const start = scanExpressionStart(sql, end);

  // ── Absorb a `::cast` suffix ─────────────────────────────────────────────
  // `'2026-08-05'::timestamp - INTERVAL '30 days'` must treat the WHOLE
  // `'…'::timestamp` as the operand. Without this the scan stops at the bare
  // identifier `timestamp` and the rewrite produces
  // `'2026-08-05'::datetime(timestamp, '-30 days')` — which parses as garbage
  // and, worse, reads like it was intentional.
  if (start >= 2 && sql.slice(start - 2, start) === "::") {
    return findExpressionStart(sql, start - 2);
  }

  return start;
}

function scanExpressionStart(sql: string, end: number): number {
  let index = end - 1;

  // Skip whitespace between the expression and `::`.
  while (index >= 0 && /\s/.test(sql[index] as string)) index -= 1;

  if (index < 0) return end;

  // A parenthesized group, or a function call's argument list.
  if (sql[index] === ")") {
    let depth = 0;

    while (index >= 0) {
      const char = sql[index] as string;
      if (char === ")") depth += 1;
      else if (char === "(") {
        depth -= 1;
        if (depth === 0) break;
      }
      index -= 1;
    }

    // Absorb a function name sitting in front of the parenthesis.
    let start = index;
    let scan = index - 1;
    while (scan >= 0 && /[\w$]/.test(sql[scan] as string)) {
      start = scan;
      scan -= 1;
    }

    // ── Absorb an aggregate's FILTER clause ────────────────────────────────
    // `COUNT(*) FILTER (WHERE …)::bigint` casts the whole aggregate, but the
    // scan above stops at the FILTER parens because they look like an ordinary
    // parenthesized group. Casting that alone emits
    // `COUNT(*) FILTER CAST((WHERE …) AS INTEGER)` — the CAST lands after
    // FILTER, and SQLite reports "near CAST: syntax error" while the real
    // problem is that half the expression was left outside the cast.
    //
    // A FILTER clause is a SUFFIX, never an operand, so when the word in front
    // of the parens is FILTER the scan must continue past it to the aggregate
    // call it modifies.
    // Postgres allows whitespace before the parens (`FILTER (WHERE …)`), so the
    // identifier scan above stops at the paren without absorbing the keyword —
    // the word has to be read from the text preceding it.
    const before = sql.slice(0, start);
    const filter = /(?:^|[^\w$])FILTER\s*$/i.exec(before);
    if (filter?.index !== undefined) {
      // Continue the scan from where FILTER starts, so the operand becomes the
      // aggregate call in front of it rather than the filter parens.
      return scanExpressionStart(sql, before.toUpperCase().lastIndexOf("FILTER"));
    }

    return start;
  }

  // A string literal: '2026-08-05'::timestamp
  // Without this the backward scan stops at the closing quote and produces an
  // EMPTY expression — `CAST( AS TEXT)` — which SQLite rejects with a message
  // pointing at CAST rather than at the literal that actually confused it.
  if (sql[index] === "'") {
    index -= 1;
    while (index >= 0 && sql[index] !== "'") index -= 1;
    return index;
  }

  // A quoted identifier, possibly qualified: m."variantId"
  if (sql[index] === '"') {
    index -= 1;
    while (index >= 0 && sql[index] !== '"') index -= 1;

    let start = index;
    // Walk back over an optional `alias.` prefix.
    if (index > 0 && sql[index - 1] === ".") {
      let scan = index - 2;
      while (scan >= 0 && /[\w$"]/.test(sql[scan] as string)) {
        start = scan;
        scan -= 1;
      }
    }

    return start;
  }

  // A bare identifier, number, or bound parameter placeholder.
  let start = index;
  while (start >= 0 && /[\w$.?]/.test(sql[start] as string)) start -= 1;

  return start + 1;
}

/**
 * Rewrites `expr::type` as `CAST(expr AS TYPE)`.
 *
 * Applied right-to-left so that earlier offsets stay valid as the string grows,
 * and so a chained `x::numeric::text` unwinds correctly from the outside in.
 */
export function translateCasts(sql: string): string {
  // The type must NOT be allowed to contain spaces, or `)::bigint AS total`
  // captures "bigint AS total" and the cast is silently skipped — which is how
  // a rewrite that looks like it worked leaves `::` in the statement for SQLite
  // to choke on. "double precision" is the one two-word type, spelled out.
  const castPattern = /::\s*(double\s+precision|[A-Za-z][A-Za-z0-9_]*)/i;

  let result = sql;

  // ── Leftmost-first, repeatedly ───────────────────────────────────────────
  // Rewriting right-to-left breaks a chained cast: for `COUNT(*)::bigint::text`
  // the outer `::text` would take "bigint" as its expression and produce
  // `CAST(bigint AS TEXT)`. Converting the LEFTMOST cast first means the next
  // one sees a finished `CAST(...)` call, which the expression scanner handles
  // as an ordinary function call.
  //
  // Bounded so a type this map does not know cannot spin forever — the loop
  // exits by advancing past unmapped casts rather than by rewriting them.
  let searchFrom = 0;

  for (let guard = 0; guard < 200; guard += 1) {
    const match = castPattern.exec(result.slice(searchFrom));
    if (match?.index === undefined) break;

    const at = searchFrom + match.index;
    const rawType = (match[1] ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const mapped = CAST_TYPES.get(rawType);

    if (mapped === undefined) {
      // Unknown type: leave it alone and keep looking. It will be caught later
      // when SQLite rejects the statement, which is the correct outcome — this
      // module never guesses at a cast it does not understand.
      searchFrom = at + match[0].length;
      continue;
    }

    const start = findExpressionStart(result, at);
    const expression = result.slice(start, at);
    const after = result.slice(at + match[0].length);
    const replacement = `CAST(${expression} AS ${mapped})`;

    result = `${result.slice(0, start)}${replacement}${after}`;
    searchFrom = start + replacement.length;
  }

  return result;
}

// =============================================================================
// DATE_TRUNC TRANSLATION
// =============================================================================

/**
 * `DATE_TRUNC('day', x)` → `strftime('%Y-%m-%d 00:00:00', x)`.
 *
 * The output stays a full timestamp string rather than a bare date so that
 * ordering and equality behave the same as the Postgres original — a caller
 * grouping by day and then sorting must not suddenly be sorting shorter
 * strings against longer ones.
 */
const DATE_TRUNC_FORMATS: ReadonlyMap<string, string> = new Map([
  ["year", "%Y-01-01 00:00:00"],
  ["month", "%Y-%m-01 00:00:00"],
  ["day", "%Y-%m-%d 00:00:00"],
  ["hour", "%Y-%m-%d %H:00:00"],
  ["minute", "%Y-%m-%d %H:%M:00"],
]);

export function translateDateTrunc(sql: string): string {
  return sql.replace(
    /\bDATE_TRUNC\s*\(\s*'(\w+)'\s*,\s*/gi,
    (whole, unit: string) => {
      const format = DATE_TRUNC_FORMATS.get(unit.toLowerCase());

      if (format === undefined) {
        throw new Error(
          `DATE_TRUNC('${unit}', …) has no SQLite translation. Supported units: ` +
            `${[...DATE_TRUNC_FORMATS.keys()].join(", ")}. ` +
            `('week' and 'quarter' need explicit arithmetic — compute the ` +
            `boundary in TypeScript instead.)`
        );
      }

      // The argument and closing paren are left in place, so
      //   DATE_TRUNC('day', m."createdAt")  →  strftime('%Y-…', m."createdAt")
      return `${whole.replace(/DATE_TRUNC\s*\(\s*'\w+'\s*,\s*/i, "")}strftime('${format}', `;
    }
  );
}

// =============================================================================
// TIME ARITHMETIC
// =============================================================================

/**
 * Reads a balanced parenthesized group starting at `open`, returning the index
 * just past its closing paren.
 */
function matchParen(sql: string, open: number): number {
  let depth = 0;

  for (let index = open; index < sql.length; index += 1) {
    const char = sql[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }

  return -1;
}

/**
 * `EXTRACT(EPOCH FROM (A - B))` → `((julianday(A) - julianday(B)) * 86400)`.
 *
 * julianday() returns a fractional day count, so the difference times 86400 is
 * seconds — exactly what EPOCH yields for an interval. The multiplication is
 * done in floating point on both sides, and every caller in this codebase then
 * ROUNDs, so the two engines agree to the second.
 *
 * Only the `(A - B)` shape is handled. Anything else is left alone and will be
 * caught by `assertTranslatable`, because inferring an interval from an
 * arbitrary expression is exactly the kind of guess that produces a plausible
 * wrong number.
 */
export function translateEpochDifference(sql: string): string {
  let result = sql;

  for (let guard = 0; guard < 50; guard += 1) {
    const match = /\bEXTRACT\s*\(\s*EPOCH\s+FROM\s*/i.exec(result);
    if (match?.index === undefined) break;

    const innerStart = match.index + match[0].length;

    if (result[innerStart] !== "(") {
      throw new Error(
        "EXTRACT(EPOCH FROM …) is only translated for a parenthesized " +
          "difference, e.g. EXTRACT(EPOCH FROM (a - b))."
      );
    }

    const innerEnd = matchParen(result, innerStart);
    const outerEnd = matchParen(result, match.index + result.slice(match.index).indexOf("("));

    if (innerEnd === -1 || outerEnd === -1) {
      throw new Error("Unbalanced parentheses in EXTRACT(EPOCH FROM …).");
    }

    const inner = result.slice(innerStart + 1, innerEnd - 1);
    const parts = splitTopLevelMinus(inner);

    if (parts === null) {
      throw new Error(
        `EXTRACT(EPOCH FROM (${inner.slice(0, 60)})) is not a simple difference ` +
          `and has no safe SQLite translation.`
      );
    }

    const replacement = `((julianday(${parts.left}) - julianday(${parts.right})) * 86400)`;
    result = result.slice(0, match.index) + replacement + result.slice(outerEnd);
  }

  return result;
}

/** Splits `a - b` at the top level (ignoring parens and quoted strings). */
function splitTopLevelMinus(text: string): { left: string; right: string } | null {
  let depth = 0;
  let inString = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === "'") inString = !inString;
    if (inString) continue;

    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "-" && depth === 0) {
      return {
        left: text.slice(0, index).trim(),
        right: text.slice(index + 1).trim(),
      };
    }
  }

  return null;
}

/**
 * `X - INTERVAL '30 days'` → `datetime(X, '-30 days')`.
 * `X + INTERVAL '1 month'` → `datetime(X, '+1 month')`.
 *
 * SQLite's date modifiers accept the same unit words Postgres uses (`days`,
 * `months`, `years`, `hours`, `minutes`, `seconds`), so the literal carries
 * straight across with only a sign prefix added.
 *
 * Runs BEFORE cast translation: at this point the operand is still the source
 * text (`${asOf}::timestamp`), which the expression scanner can find. After
 * casts have been rewritten it would be buried inside `CAST(… AS TEXT)`.
 */
const INTERVAL_UNITS = new Set([
  "second", "seconds", "minute", "minutes", "hour", "hours",
  "day", "days", "month", "months", "year", "years",
]);

export function translateIntervalArithmetic(sql: string): string {
  const pattern = /([+-])\s*INTERVAL\s+'(\d+)\s+(\w+)'/i;

  let result = sql;

  for (let guard = 0; guard < 50; guard += 1) {
    const match = pattern.exec(result);
    if (match?.index === undefined) break;

    const sign = match[1] === "-" ? "-" : "+";
    const amount = match[2] as string;
    const unit = (match[3] as string).toLowerCase();

    if (!INTERVAL_UNITS.has(unit)) {
      throw new Error(
        `INTERVAL '${amount} ${unit}' has no SQLite translation. Supported ` +
          `units: ${[...INTERVAL_UNITS].join(", ")}.`
      );
    }

    // The operand is whatever expression sits immediately before the operator.
    const operandEnd = match.index;
    const operandStart = findExpressionStart(result, operandEnd);
    const operand = result.slice(operandStart, operandEnd).trim();

    if (operand === "") {
      throw new Error("INTERVAL arithmetic has no left-hand operand to modify.");
    }

    const replacement = `datetime(${operand}, '${sign}${amount} ${unit}')`;

    result =
      result.slice(0, operandStart) +
      replacement +
      result.slice(match.index + match[0].length);
  }

  return result;
}

// =============================================================================
// FUNCTION TRANSLATION
// =============================================================================

/**
 * GREATEST/LEAST → max/min.
 *
 * SQLite's `max(a, b)` with two or more arguments is the SCALAR form, which is
 * exactly what GREATEST means. (With one argument it is the aggregate — hence
 * the lookahead requiring a comma, so a genuine `MAX(column)` aggregate is
 * never rewritten into something else.)
 */
export function translateFunctions(sql: string): string {
  return sql
    .replace(/\bGREATEST\s*\(/gi, "max(")
    .replace(/\bLEAST\s*\(/gi, "min(")
    // SQLite's LIKE is already case-insensitive for ASCII, so ILIKE is a
    // straight swap. (It is NOT case-insensitive for non-ASCII in either
    // engine without ICU, so behavior matches there too.)
    .replace(/\bILIKE\b/gi, "LIKE");
}

// =============================================================================
// ENTRY POINT
// =============================================================================

/**
 * Translates one Postgres SQL fragment for SQLite.
 *
 * Order matters: unsupported constructs are rejected FIRST, so a query that
 * cannot work never gets half-translated into something that runs and returns
 * the wrong answer.
 */
export function translateSql(sql: string): string {
  assertTranslatable(sql);

  // Time arithmetic runs FIRST, while operands are still in their source form.
  // Once `${asOf}::timestamp` has become `CAST(? AS TEXT)` the interval rewrite
  // can no longer see what it is modifying.
  const timeTranslated = translateIntervalArithmetic(translateEpochDifference(sql));

  return translateCasts(translateDateTrunc(translateFunctions(timeTranslated)));
}

/**
 * True when a fragment needs no translation at all.
 *
 * Most raw SQL in this codebase is plain ANSI; skipping the rewrite keeps the
 * hot path free of regex work.
 */
export function needsTranslation(sql: string): boolean {
  return /::|GREATEST|LEAST|ILIKE|DATE_TRUNC|DISTINCT\s+ON|ANY\s*\(|INTERVAL\s+'|EXTRACT\s*\(|generate_series|similarity\s*\(/i.test(
    sql
  );
}
