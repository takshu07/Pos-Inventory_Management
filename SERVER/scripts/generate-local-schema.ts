/* eslint-disable no-console */
// =============================================================================
// LOCAL (SQLite) SCHEMA GENERATOR
//
// Produces the offline mirror of the cloud database from the ONE authoritative
// schema, so the two can never drift:
//
//   prisma/schema.prisma  ──generate──▶  prisma/local/schema.prisma   (SQLite)
//                                    └▶  prisma/local/manifest.json   (metadata)
//
// ── Why generate instead of hand-maintaining a second schema ─────────────────
// A hand-written mirror is wrong the first time someone adds a column to the
// Postgres schema and forgets the SQLite one. The failure mode is silent: the
// column syncs as undefined and a price, a tax rate or a stock count quietly
// becomes null on the till. Generating it means `npm run db:local:generate` is
// the only thing anyone has to remember, and CI can diff the output to prove
// the mirror is current.
//
// ── What actually has to change between the two dialects ─────────────────────
// Very little, which is the happy result of an audit of the real schema:
//
//   1. datasource provider          postgresql → sqlite, and `extensions` /
//                                   `postgresqlExtensions` dropped (pg_trgm has
//                                   no SQLite equivalent).
//   2. Native type attributes       `@db.Decimal(10, 2)`, `@db.Date` are
//                                   Postgres-only spellings. Prisma's SQLite
//                                   connector supports Decimal and DateTime
//                                   natively, so the attribute is simply
//                                   dropped — the field TYPE is unchanged.
//   3. Trigram indexes              `@@index([... ops: raw("gin_trgm_ops")],
//                                   type: Gin)` is Postgres-only. Dropped; the
//                                   equivalent local search path is a plain
//                                   index (SQLite LIKE on a local file has no
//                                   network round trip to optimize away).
//   4. Scalar lists                 The ONLY genuine type incompatibility.
//                                   SQLite has no array type, so `String[]` /
//                                   `Int[]` become `String` holding JSON. The
//                                   two affected fields (`Product.imageUrls`,
//                                   `Shift.workingDays`) are transparently
//                                   re-hydrated by the scalar-list bridge in
//                                   `src/offline/datasource/scalarListBridge.ts`
//                                   so calling code still sees arrays.
//
// Enums, Json, Decimal, cuid()/uuid() defaults, @updatedAt, referential
// actions and composite uniques all work unmodified on Prisma's SQLite
// connector — verified against this schema, not assumed.
//
// Everything else — every model, field, relation, index and @@map — is copied
// through byte-for-byte.
//
// Usage:  npx tsx scripts/generate-local-schema.ts [--check]
//         --check  exits non-zero if the committed output is stale (for CI)
// =============================================================================

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// =============================================================================
// PATHS
// =============================================================================

const SERVER_ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_SCHEMA = path.join(SERVER_ROOT, "prisma", "schema.prisma");
const OUTPUT_DIR = path.join(SERVER_ROOT, "prisma", "local");
const OUTPUT_SCHEMA = path.join(OUTPUT_DIR, "schema.prisma");
const OUTPUT_MANIFEST = path.join(OUTPUT_DIR, "manifest.json");

// =============================================================================
// MANIFEST TYPES
//
// The manifest is the machine-readable description of the mirrored database.
// It is consumed by the trigger generator (needs every column of every tracked
// table), by the sync engine (needs entity → table → primary key), and by the
// conflict resolver (needs to know which side owns each entity).
// =============================================================================

export interface ManifestField {
  /** Prisma field name. No field in this schema uses `@map`, so this is also
   *  the physical column name — asserted at generation time, not assumed. */
  readonly name: string;
  /** Prisma scalar or enum type, without modifiers. */
  readonly type: string;
  readonly isOptional: boolean;
  readonly isId: boolean;
  /** True for `String[]` / `Int[]` — stored as a JSON string locally. */
  readonly isScalarList: boolean;
  readonly isEnum: boolean;
}

export interface ManifestModel {
  /** Prisma model name, e.g. "Sale". */
  readonly name: string;
  /** Physical table name from `@@map`, e.g. "sales". */
  readonly table: string;
  /** Name of the single `@id` field. */
  readonly primaryKey: string;
  /** Scalar + enum + FK columns, in declaration order. Excludes relations. */
  readonly columns: readonly ManifestField[];
}

export interface LocalSchemaManifest {
  readonly generatedFrom: string;
  /** SHA-256 of the source schema — lets `--check` detect drift cheaply. */
  readonly sourceHash: string;
  readonly enums: readonly string[];
  readonly models: readonly ManifestModel[];
  /** model → [scalar list fields] for the runtime bridge. */
  readonly scalarListFields: Readonly<Record<string, readonly string[]>>;
}

// =============================================================================
// PARSING
//
// A purpose-built reader rather than a full Prisma AST parse: this only needs
// block boundaries and field declarations, and depending on Prisma's internal
// schema-engine WASM API for a build step would be a heavier commitment than
// the job warrants. Every assumption it makes is asserted below.
// =============================================================================

/**
 * Models that exist ONLY on the central database and must not be mirrored.
 *
 * These are the cloud's half of the sync protocol — its idempotency ledger,
 * nonce store, device registry and conflict audit. A till has no use for them,
 * and mirroring them would be actively harmful: `sync_receipts` on the edge
 * would look like a local table the policy registry must classify, and an
 * operator glancing at it could mistake a till's empty ledger for the cloud
 * having accepted nothing.
 *
 * The edge node's own bookkeeping is the separate set appended by SYNC_MODELS.
 */
const CLOUD_ONLY_MODELS = new Set([
  "SyncReceipt",
  "SyncNonce",
  "SyncDevice",
  "SyncConflictRecord",
]);

const PRISMA_SCALARS = new Set([
  "String",
  "Boolean",
  "Int",
  "BigInt",
  "Float",
  "Decimal",
  "DateTime",
  "Json",
  "Bytes",
]);

interface ParsedBlock {
  readonly kind: "model" | "enum" | "datasource" | "generator" | "other";
  readonly name: string;
  readonly lines: string[];
  readonly startLine: number;
}

function parseBlocks(source: string): ParsedBlock[] {
  const lines = source.split(/\r?\n/);
  const blocks: ParsedBlock[] = [];

  let current: { kind: ParsedBlock["kind"]; name: string; lines: string[]; startLine: number } | null =
    null;
  let depth = 0;

  lines.forEach((line, index) => {
    if (current === null) {
      const header = /^(model|enum|datasource|generator|type|view)\s+(\w+)\s*\{/.exec(line);
      if (header) {
        const keyword = header[1] as string;
        const kind: ParsedBlock["kind"] =
          keyword === "model" || keyword === "enum" || keyword === "datasource" || keyword === "generator"
            ? keyword
            : "other";
        current = { kind, name: header[2] as string, lines: [line], startLine: index };
        depth = 1;
      }
      return;
    }

    current.lines.push(line);
    depth += (line.match(/\{/g)?.length ?? 0);
    depth -= (line.match(/\}/g)?.length ?? 0);

    if (depth === 0) {
      blocks.push(current);
      current = null;
    }
  });

  if (current !== null) {
    throw new Error(`Unterminated block in ${SOURCE_SCHEMA}`);
  }

  return blocks;
}

/** Strips `//` comments while leaving `///` doc comments and string literals alone. */
function stripLineComment(line: string): string {
  const index = line.indexOf("//");
  if (index === -1) return line;
  // Don't cut inside a quoted string (e.g. a @default("http://…") value).
  const before = line.slice(0, index);
  const quotes = (before.match(/"/g)?.length ?? 0);
  if (quotes % 2 === 1) return line;
  return before;
}

interface ParsedField {
  readonly name: string;
  readonly type: string;
  readonly isList: boolean;
  readonly isOptional: boolean;
  readonly attributes: string;
}

function parseField(rawLine: string): ParsedField | null {
  const line = stripLineComment(rawLine).trim();
  if (line === "" || line.startsWith("@@") || line.startsWith("///") || line.startsWith("}")) {
    return null;
  }

  const match = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line);
  if (!match) return null;

  return {
    name: match[1] as string,
    type: match[2] as string,
    isList: match[3] === "[]",
    isOptional: match[4] === "?",
    attributes: (match[5] ?? "").trim(),
  };
}

// =============================================================================
// TRANSFORMATION
// =============================================================================

/** `@db.Decimal(10, 2)` / `@db.Date` — Postgres native type spellings. */
const NATIVE_TYPE_ATTRIBUTE = /\s*@db\.\w+(\([^)]*\))?/g;

/** A trigram/GIN index line — Postgres-only, has no SQLite counterpart. */
function isPostgresOnlyIndex(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("@@index")) return false;
  return /type:\s*(Gin|Gist|Brin|SpGist|Hash)\b/.test(trimmed) || /ops:\s*raw\(/.test(trimmed);
}

function transformDatasource(block: ParsedBlock): string[] {
  return block.lines
    .filter((line) => !/^\s*extensions\s*=/.test(line))
    .map((line) =>
      /^\s*provider\s*=/.test(line) ? line.replace(/"postgresql"/, '"sqlite"') : line
    );
}

function transformGenerator(block: ParsedBlock): string[] {
  const out: string[] = [];
  // Comment lines are buffered so that the comment explaining a removed
  // setting is removed WITH it — an orphaned paragraph about PostgreSQL
  // extensions sitting in the SQLite schema would just mislead the next reader.
  let pendingComments: string[] = [];

  for (const line of block.lines) {
    if (line.trim().startsWith("//")) {
      pendingComments.push(line);
      continue;
    }

    if (/^\s*previewFeatures\s*=/.test(line)) {
      pendingComments = [];
      continue;
    }

    out.push(...pendingComments);
    pendingComments = [];

    out.push(
      /^\s*output\s*=/.test(line)
        ? line.replace(/"[^"]*"/, '"../../generated/local-prisma"')
        : line
    );
  }

  return [...out.slice(0, -1), ...pendingComments, ...out.slice(-1)];
}

interface ModelTransform {
  readonly lines: string[];
  readonly model: ManifestModel;
  readonly scalarLists: string[];
}

function transformModel(block: ParsedBlock, enums: ReadonlySet<string>): ModelTransform {
  const out: string[] = [];
  const columns: ManifestField[] = [];
  const scalarLists: string[] = [];
  let table: string | null = null;
  let primaryKey: string | null = null;

  for (const line of block.lines) {
    // ── @@map / @@index / @@unique and friends ───────────────────────────────
    const mapMatch = /^\s*@@map\("([^"]+)"\)/.exec(line);
    if (mapMatch) {
      table = mapMatch[1] as string;
      out.push(line);
      continue;
    }

    if (isPostgresOnlyIndex(line)) {
      // Keep the intent visible in the generated file so a reader doesn't
      // wonder why local search is not trigram-accelerated.
      out.push(`  // [local] trigram index omitted (Postgres-only): ${line.trim()}`);
      continue;
    }

    const field = parseField(line);
    if (field === null) {
      out.push(line);
      continue;
    }

    const isEnum = enums.has(field.type);
    const isScalar = PRISMA_SCALARS.has(field.type) || isEnum;

    if (!isScalar) {
      // A relation field — not a column. Copied through untouched.
      out.push(line);
      continue;
    }

    if (/@map\(/.test(field.attributes)) {
      throw new Error(
        `Field ${block.name}.${field.name} uses @map. The trigger generator ` +
          `assumes field name === column name; teach it about @map before ` +
          `adding one.`
      );
    }

    let emitted = line.replace(NATIVE_TYPE_ATTRIBUTE, "");

    // ── Json column defaults ─────────────────────────────────────────────────
    // `Json @default("{}")` is valid Prisma for both connectors, but the SQLite
    // DDL generator emits the value UNQUOTED — `DEFAULT {}` — which is a syntax
    // error, so `db push` fails on the whole table. Re-spelling the default as
    // `dbgenerated("'{}'")` puts the quotes in the DDL while keeping the field
    // optional on create, so the generated client's input types are unchanged.
    if (field.type === "Json") {
      emitted = emitted.replace(
        /@default\("((?:[^"\\]|\\.)*)"\)/,
        (_whole, raw: string) => {
          const decoded = raw.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
          return `@default(dbgenerated("'${decoded.replace(/'/g, "''")}'"))`;
        }
      );
    }

    if (field.isList) {
      // ── The one real incompatibility ───────────────────────────────────────
      // SQLite has no array type. Store JSON text and let the scalar-list
      // bridge convert on the way in and out, so `product.imageUrls` is still
      // a string[] to every caller.
      scalarLists.push(field.name);

      const defaultMatch = /@default\(\[([^\]]*)\]\)/.exec(field.attributes);
      const jsonDefault =
        defaultMatch === undefined || defaultMatch === null
          ? "[]"
          : `[${(defaultMatch[1] as string).replace(/\s+/g, "")}]`;

      const optionalMarker = field.isOptional ? "?" : "";
      const otherAttributes = field.attributes
        .replace(/@default\(\[[^\]]*\]\)/, "")
        .replace(NATIVE_TYPE_ATTRIBUTE, "")
        .trim();

      const indent = /^(\s*)/.exec(line)?.[1] ?? "  ";
      emitted =
        `${indent}${field.name} String${optionalMarker} ` +
        `@default("${jsonDefault}")${otherAttributes ? ` ${otherAttributes}` : ""}` +
        `  // [local] JSON-encoded ${field.type}[]`;
    }

    if (/@id\b/.test(field.attributes)) {
      primaryKey = field.name;
    }

    columns.push({
      name: field.name,
      type: field.type,
      isOptional: field.isOptional,
      isId: /@id\b/.test(field.attributes),
      isScalarList: field.isList,
      isEnum,
    });

    out.push(emitted);
  }

  if (table === null) {
    throw new Error(
      `Model ${block.name} has no @@map. The sync engine addresses rows by ` +
        `physical table name, so every model needs one.`
    );
  }
  if (primaryKey === null) {
    throw new Error(
      `Model ${block.name} has no single-field @id. The sync engine addresses ` +
        `every row as (table, id); composite keys are not supported.`
    );
  }

  return {
    lines: out,
    model: { name: block.name, table, primaryKey, columns },
    scalarLists,
  };
}

// =============================================================================
// SYNC METADATA MODELS
//
// These exist ONLY in the local database. They are the durable bookkeeping the
// sync engine runs on, and they are deliberately absent from the cloud schema:
// the cloud never needs to know how an edge node organizes its own queue.
// =============================================================================

const SYNC_MODELS = `
// =============================================================================
// ▼▼▼ LOCAL-ONLY SYNC METADATA ▼▼▼
//
// Appended by scripts/generate-local-schema.ts. These tables do not exist in
// the cloud database and are never themselves synchronized.
// =============================================================================

/// The durable outbound log. One row per local write to a tracked table,
/// written by a SQLite trigger inside the SAME transaction as the write itself
/// — so a sale and its queue entry commit together or not at all. This is what
/// makes "never lose a transaction" a property of the database rather than a
/// promise made by application code.
model SyncQueueItem {
  /// Monotonic local sequence. Also the upload ORDER: replaying in ascending
  /// id reproduces the exact order the operations happened on the till, which
  /// is what keeps dependent rows (a Sale before its SaleItems) valid.
  id Int @id @default(autoincrement())

  /// Prisma model name, e.g. "Sale".
  entity    String
  /// Physical table name, e.g. "sales".
  tableName String
  /// Primary key of the affected row.
  entityId  String
  /// CREATE | UPDATE | DELETE
  operation String

  /// JSON snapshot of the row AFTER the change (NEW.*). Null for DELETE.
  payload    String?
  /// JSON snapshot BEFORE the change (OLD.*). Null for CREATE. Used by the
  /// conflict log and by compensating rollback.
  beforeData String?

  /// PENDING | IN_FLIGHT | SYNCED | FAILED | CONFLICT | SUPERSEDED
  status   String @default("PENDING")
  attempts Int    @default(0)

  lastError   String?
  lastAttempt DateTime?

  /// Groups the items of one upload batch so an interrupted upload can be
  /// resumed (or rolled back to PENDING) as a unit.
  batchId String?

  /// Stable, deterministic dedupe key: "<deviceId>:<id>". The cloud stores it
  /// and rejects a second arrival, which is what makes uploads idempotent
  /// across a retry that actually succeeded but whose response was lost.
  idempotencyKey String @unique

  /// When the write happened on the till (local clock).
  localTimestamp DateTime  @default(now())
  syncedAt       DateTime?

  @@index([status, id])
  @@index([entity, entityId])
  @@index([batchId])
  @@map("sync_queue")
}

/// Per-entity download cursor for incremental pulls. Storing a high-water mark
/// per entity (rather than one global timestamp) means a failed Products pull
/// does not force Customers to be re-downloaded from scratch.
model SyncCursor {
  /// Prisma model name.
  entity String @id

  /// Highest updatedAt successfully pulled for this entity.
  lastPulledAt DateTime?
  /// Tie-breaker for rows sharing lastPulledAt — pagination is keyset-based
  /// on (updatedAt, id), so an id is needed to resume mid-timestamp.
  lastPulledId String?

  lastSuccessAt DateTime?
  rowsPulled    Int       @default(0)

  @@map("sync_cursors")
}

/// One row per sync session — the history the owner sees, and the record that
/// makes a partial sync diagnosable after the fact.
model SyncRun {
  id String @id

  /// DOWNLOAD | UPLOAD | FULL
  direction String
  /// MANUAL | SCHEDULED | AUTO | STARTUP
  trigger   String
  /// RUNNING | SUCCESS | PARTIAL | FAILED | INTERRUPTED
  status    String @default("RUNNING")

  startedAt  DateTime  @default(now())
  finishedAt DateTime?
  durationMs Int?

  itemsTotal     Int @default(0)
  itemsSucceeded Int @default(0)
  itemsFailed    Int @default(0)
  itemsConflicted Int @default(0)
  bytesTransferred Int @default(0)

  error String?
  /// Free-form JSON detail (per-entity counts, etc.).
  detail String?

  conflicts SyncConflict[]

  @@index([startedAt])
  @@index([status])
  @@map("sync_runs")
}

/// An auditable record of every conflict and how it was resolved. Required by
/// the "conflicts must be logged and auditable" rule — a resolution that
/// silently discarded data would otherwise be invisible.
model SyncConflict {
  id String @id

  runId String?
  run   SyncRun? @relation(fields: [runId], references: [id], onDelete: SetNull)

  entity   String
  entityId String

  /// CLOUD_WINS | LOCAL_WINS | MANUAL
  resolution String
  /// Why the resolver chose that side.
  reason     String

  localData String?
  cloudData String?

  detectedAt DateTime  @default(now())
  reviewedAt DateTime?
  reviewedBy String?

  @@index([entity, entityId])
  @@index([detectedAt])
  @@map("sync_conflicts")
}

/// Append-only audit trail of sync lifecycle events. Separate from SyncRun so
/// that a crash mid-run still leaves a breadcrumb trail.
model SyncEvent {
  id String @id

  runId String?
  /// RUN_STARTED | BATCH_SENT | BATCH_ACKED | ITEM_FAILED | CONFLICT |
  /// MODE_CHANGED | RUN_FINISHED | INTEGRITY_CHECK
  type  String
  /// INFO | WARN | ERROR
  level String @default("INFO")

  entity  String?
  message String
  detail  String?

  createdAt DateTime @default(now())

  @@index([createdAt])
  @@index([type])
  @@map("sync_events")
}

/// Single-row table holding this node's identity and mode state, so a restart
/// resumes in the mode it was actually in rather than optimistically assuming
/// the network is back.
model SyncNodeState {
  id String @id @default("singleton")

  deviceId String

  /// Read by every change-capture trigger. Cleared for the duration of a
  /// download so that applying cloud rows locally does not queue them straight
  /// back up as local changes (the echo loop).
  ///
  /// ⚠ May only be toggled INSIDE a transaction. SQLite's write lock is what
  /// makes the suppression safe: with it held, no concurrent sale can slip
  /// through while capture is off. Toggling it outside a transaction would
  /// silently drop any write that landed in the gap.
  captureEnabled Boolean @default(true)

  /// cloud | local — the datasource the router last resolved to.
  lastMode        String    @default("local")
  lastOnlineAt    DateTime?
  lastDownloadAt  DateTime?
  lastUploadAt    DateTime?
  /// Set while a run holds the sync lock; cleared on completion. A value left
  /// behind after a restart means the previous run was interrupted.
  activeRunId     String?

  updatedAt DateTime @updatedAt

  @@map("sync_node_state")
}
`;

// =============================================================================
// GENERATION
// =============================================================================

function generate(source: string): { schema: string; manifest: LocalSchemaManifest } {
  const blocks = parseBlocks(source);

  const enums = new Set(blocks.filter((b) => b.kind === "enum").map((b) => b.name));

  const header = [
    "// ===========================================================================",
    "// GENERATED FILE — DO NOT EDIT",
    "//",
    "// Produced by scripts/generate-local-schema.ts from prisma/schema.prisma.",
    "// Edit the Postgres schema and re-run `npm run db:local:generate`.",
    "//",
    "// This is the OFFLINE MIRROR: the same models, relations and constraints as",
    "// the cloud database, expressed for SQLite. Business rules are identical by",
    "// construction because both sides are generated from one source.",
    "// ===========================================================================",
    "",
  ];

  const out: string[] = [...header];
  const models: ManifestModel[] = [];
  const scalarListFields: Record<string, string[]> = {};

  // Copy the file through block by block, preserving the original ordering and
  // the prose comments between blocks (they document real business rules).
  const sourceLines = source.split(/\r?\n/);
  let cursor = 0;

  for (const block of blocks) {
    // Emit whatever sat between the previous block and this one (comments,
    // section banners, blank lines).
    if (block.startLine > cursor) {
      out.push(...sourceLines.slice(cursor, block.startLine));
    }
    cursor = block.startLine + block.lines.length;

    switch (block.kind) {
      case "datasource":
        out.push(...transformDatasource(block));
        break;
      case "generator":
        out.push(...transformGenerator(block));
        break;
      case "model": {
        if (CLOUD_ONLY_MODELS.has(block.name)) {
          out.push(
            `// [local] ${block.name} omitted — cloud-side sync bookkeeping, ` +
              `see prisma/schema.prisma`
          );
          break;
        }

        const transformed = transformModel(block, enums);
        out.push(...transformed.lines);
        models.push(transformed.model);
        if (transformed.scalarLists.length > 0) {
          scalarListFields[transformed.model.name] = transformed.scalarLists;
        }
        break;
      }
      default:
        out.push(...block.lines);
    }
  }

  if (cursor < sourceLines.length) {
    out.push(...sourceLines.slice(cursor));
  }

  out.push(SYNC_MODELS);

  // ── Guard the assumption the runtime bridge is built on ────────────────────
  // src/offline/datasource/scalarListBridge.ts re-encodes scalar lists by
  // matching on FIELD NAME at any depth of a Prisma args/result tree, because
  // Prisma does not tell an extension which model a nested object belongs to.
  // That is only correct while those names are unique across the whole schema.
  // If a second model ever adds its own `imageUrls`, the bridge would start
  // JSON-encoding a field that is a genuine array in Postgres — so fail the
  // build here rather than corrupt data at runtime.
  const listFieldOwners = new Map<string, string[]>();
  for (const [modelName, fields] of Object.entries(scalarListFields)) {
    for (const field of fields) {
      listFieldOwners.set(field, [...(listFieldOwners.get(field) ?? []), modelName]);
    }
  }
  const ambiguous = [...listFieldOwners.entries()].filter(([, owners]) => owners.length > 1);
  if (ambiguous.length > 0) {
    throw new Error(
      `Scalar-list field names must be unique across the schema, but these are ` +
        `declared on more than one model:\n` +
        ambiguous.map(([field, owners]) => `  - ${field}: ${owners.join(", ")}`).join("\n") +
        `\nRename one of them, or teach scalarListBridge.ts to resolve fields ` +
        `per-model before re-running.`
    );
  }

  return {
    schema: out.join("\n"),
    manifest: {
      generatedFrom: "prisma/schema.prisma",
      sourceHash: createHash("sha256").update(source).digest("hex"),
      enums: [...enums].sort(),
      models,
      scalarListFields,
    },
  };
}

// =============================================================================
// ENTRY POINT
// =============================================================================

function main(): void {
  const checkOnly = process.argv.includes("--check");

  const source = fs.readFileSync(SOURCE_SCHEMA, "utf8");
  const { schema, manifest } = generate(source);
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

  if (checkOnly) {
    const currentSchema = fs.existsSync(OUTPUT_SCHEMA)
      ? fs.readFileSync(OUTPUT_SCHEMA, "utf8")
      : "";
    const currentManifest = fs.existsSync(OUTPUT_MANIFEST)
      ? fs.readFileSync(OUTPUT_MANIFEST, "utf8")
      : "";

    if (currentSchema !== schema || currentManifest !== manifestJson) {
      console.error(
        "✖ The local SQLite mirror is stale.\n" +
          "  prisma/schema.prisma has changed since prisma/local/schema.prisma was generated.\n" +
          "  Run: npm run db:local:generate"
      );
      process.exit(1);
    }

    console.log("✔ Local SQLite mirror is up to date.");
    return;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_SCHEMA, schema, "utf8");
  fs.writeFileSync(OUTPUT_MANIFEST, manifestJson, "utf8");

  const scalarListCount = Object.values(manifest.scalarListFields).flat().length;
  console.log(
    `✔ Generated local SQLite mirror\n` +
      `    models      ${manifest.models.length}\n` +
      `    enums       ${manifest.enums.length}\n` +
      `    JSON-encoded scalar lists  ${scalarListCount}\n` +
      `    → ${path.relative(SERVER_ROOT, OUTPUT_SCHEMA)}\n` +
      `    → ${path.relative(SERVER_ROOT, OUTPUT_MANIFEST)}`
  );
}

main();
