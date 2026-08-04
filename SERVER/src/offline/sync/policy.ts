// =============================================================================
// SYNC POLICY REGISTRY
//
// The single place that answers, for every one of the 55 models:
//
//   • Does it travel DOWN from the cloud, UP from the till, or both?
//   • Who wins when the same row changed on both sides?
//
// Everything else in the sync engine reads this table rather than hard-coding
// entity names, so adding a model is one entry here plus a regenerated mirror.
//
// ── The conflict rule, and why it is this way ────────────────────────────────
// It follows the operational reality of a shop rather than a timestamp:
//
//   CLOUD WINS on the catalog and on identity — products, prices, settings,
//   employees, suppliers, permissions. Head office sets these. If a manager
//   changes a price centrally at noon, that price must survive the evening
//   sync; a till has no authority to overrule it, and "last write wins" would
//   let a stale local copy silently roll back a company-wide price change.
//
//   LOCAL WINS on anything that records something that PHYSICALLY HAPPENED —
//   sales, returns, exchanges, payments, stock movements, attendance,
//   expenses. The cloud cannot have a better opinion about whether a customer
//   walked out with a shirt. These rows are append-only history, so "local
//   wins" is really "the cloud must accept what the shop recorded".
//
// A useful way to read the table: cloud owns INTENT, the till owns EVENTS.
//
// ── Why AuditLog uploads and PrintJob does not ───────────────────────────────
// Both are high-volume, but only one is evidence. An audit trail with a hole in
// it where the offline day was is not an audit trail. A print job is a device
// concern — the label already came out of the printer, and the cloud has no use
// for the record.
// =============================================================================

import manifest from "../../../prisma/local/manifest.json" with { type: "json" };

// =============================================================================
// TYPES
// =============================================================================

export type SyncDirection =
  /** Cloud → local only. Master data an edge node reads but never authors. */
  | "DOWN"
  /** Local → cloud only. Business events recorded at the till. */
  | "UP"
  /** Both ways. Rows exist centrally but may also be created at the till. */
  | "BIDIRECTIONAL"
  /** Never leaves the device. */
  | "LOCAL_ONLY";

export type ConflictWinner = "CLOUD" | "LOCAL";

export interface EntityPolicy {
  readonly entity: string;
  readonly table: string;
  readonly primaryKey: string;
  readonly direction: SyncDirection;
  readonly conflictWinner: ConflictWinner;
  /**
   * Download order. Lower pulls first, so a row never arrives before the row it
   * references — otherwise the local FK enforcement (which we deliberately
   * turned ON) would reject it.
   */
  readonly downloadOrder: number;
  /** Short note explaining a non-obvious classification. */
  readonly note?: string;
}

// =============================================================================
// THE REGISTRY
//
// Ordered as the download runs, parents before children.
// =============================================================================

interface PolicySpec {
  readonly direction: SyncDirection;
  readonly conflictWinner: ConflictWinner;
  readonly note?: string;
}

const CLOUD_MASTER: PolicySpec = { direction: "DOWN", conflictWinner: "CLOUD" };
const LOCAL_EVENT: PolicySpec = { direction: "UP", conflictWinner: "LOCAL" };

/**
 * Declaration order IS download order. Referenced entities appear before the
 * entities that reference them.
 */
const POLICIES: ReadonlyArray<readonly [string, PolicySpec]> = [
  // ── Catalog and configuration: head office decides ────────────────────────
  ["Settings", CLOUD_MASTER],
  ["Size", CLOUD_MASTER],
  ["Color", CLOUD_MASTER],
  ["Category", CLOUD_MASTER],
  ["Brand", CLOUD_MASTER],
  ["Supplier", CLOUD_MASTER],
  ["Product", CLOUD_MASTER],
  ["ProductVariant", CLOUD_MASTER],
  ["ExpenseCategory", CLOUD_MASTER],
  ["DiscountRule", CLOUD_MASTER],
  ["Coupon", CLOUD_MASTER],
  ["Promotion", CLOUD_MASTER],
  ["LabelTemplate", CLOUD_MASTER],
  ["Printer", CLOUD_MASTER],
  ["PrinterSetting", CLOUD_MASTER],

  // ── Identity and permissions: never editable from a till ──────────────────
  [
    "Employee",
    {
      direction: "DOWN",
      conflictWinner: "CLOUD",
      note:
        "Includes the password hash and role. A till that could author these " +
        "would be a privilege-escalation path: create an OWNER locally, sync " +
        "up, own the chain.",
    },
  ],
  ["Shift", CLOUD_MASTER],

  // ── Customers: master data that a cashier may also create at the counter ──
  [
    "Customer",
    {
      direction: "BIDIRECTIONAL",
      conflictWinner: "CLOUD",
      note:
        "Downloaded as master data, but a walk-in signed up at the till must " +
        "reach the cloud or their purchase history starts empty. Cloud wins on " +
        "an existing row (head office may have merged duplicates); a row the " +
        "cloud has never seen is inserted as-is.",
    },
  ],
  ["CustomerAddress", { direction: "BIDIRECTIONAL", conflictWinner: "CLOUD" }],

  // ── Events the shop recorded: the till is the authority ───────────────────
  ["Attendance", LOCAL_EVENT],
  ["LeaveRequest", LOCAL_EVENT],
  ["EmployeeNote", LOCAL_EVENT],

  ["Purchase", LOCAL_EVENT],
  ["PurchaseItem", LOCAL_EVENT],
  ["SupplierPayment", LOCAL_EVENT],

  ["Sale", LOCAL_EVENT],
  ["SaleItem", LOCAL_EVENT],
  ["Payment", LOCAL_EVENT],
  [
    "Invoice",
    {
      direction: "UP",
      conflictWinner: "LOCAL",
      note:
        "Carries the legally-issued document number that was printed and handed " +
        "to a customer. It cannot be regenerated centrally without changing what " +
        "the customer holds.",
    },
  ],

  ["Exchange", LOCAL_EVENT],
  ["ExchangeReturnItem", LOCAL_EVENT],
  ["ExchangeIssuedItem", LOCAL_EVENT],

  ["InventoryMovement", LOCAL_EVENT],
  ["InventoryReservation", LOCAL_EVENT],
  ["StockAdjustment", LOCAL_EVENT],
  ["CycleCount", LOCAL_EVENT],
  ["CycleCountItem", LOCAL_EVENT],
  ["DamagedStock", LOCAL_EVENT],

  ["Expense", LOCAL_EVENT],
  ["CashRegister", LOCAL_EVENT],
  ["CashDrop", LOCAL_EVENT],
  ["CashPayout", LOCAL_EVENT],
  ["CashTransaction", LOCAL_EVENT],
  ["RegisterActivity", LOCAL_EVENT],
  ["SalaryPayment", LOCAL_EVENT],
  ["SalaryAdjustment", LOCAL_EVENT],
  ["DiscountHistory", LOCAL_EVENT],

  ["Notification", LOCAL_EVENT],

  [
    "AuditLog",
    {
      direction: "UP",
      conflictWinner: "LOCAL",
      note:
        "The largest table in the system, and it still uploads: an audit trail " +
        "with the offline day missing is not an audit trail.",
    },
  ],
  ["EmployeeAction", LOCAL_EVENT],
  ["LoginHistory", LOCAL_EVENT],

  // ── Device-local: never leaves the till ───────────────────────────────────
  [
    "InventorySnapshot",
    {
      direction: "LOCAL_ONLY",
      conflictWinner: "LOCAL",
      note:
        "A derived rollup. The cloud recomputes it from the movements that DO " +
        "upload; sending both would double-count.",
    },
  ],
  [
    "Asset",
    {
      direction: "LOCAL_ONLY",
      conflictWinner: "LOCAL",
      note:
        "A row here is a pointer to a file on this machine's disk. Syncing the " +
        "row without the bytes would give the cloud a broken link — file " +
        "transfer is a separate problem this channel does not solve.",
    },
  ],
  [
    "PrintJob",
    {
      direction: "LOCAL_ONLY",
      conflictWinner: "LOCAL",
      note: "The label already came out of the printer. The cloud has no use for it.",
    },
  ],
  ["PrintJobItem", { direction: "LOCAL_ONLY", conflictWinner: "LOCAL" }],
];

// =============================================================================
// BUILD + VALIDATE
// =============================================================================

function buildRegistry(): ReadonlyMap<string, EntityPolicy> {
  const modelsByName = new Map(manifest.models.map((model) => [model.name, model]));
  const registry = new Map<string, EntityPolicy>();

  POLICIES.forEach(([entity, spec], index) => {
    const model = modelsByName.get(entity);

    if (model === undefined) {
      throw new Error(
        `Sync policy references unknown model "${entity}". The schema changed ` +
          `without the policy registry being updated — see src/offline/sync/policy.ts.`
      );
    }

    registry.set(entity, {
      entity,
      table: model.table,
      primaryKey: model.primaryKey,
      direction: spec.direction,
      conflictWinner: spec.conflictWinner,
      downloadOrder: index,
      ...(spec.note === undefined ? {} : { note: spec.note }),
    });
  });

  // ── The check that matters most ────────────────────────────────────────────
  // A model with NO policy is a model whose local writes are never captured and
  // never uploaded. That is silent, permanent data loss, and it would be
  // introduced by the most ordinary act in this codebase: adding a table. So a
  // missing entry is a hard failure at import time, not a warning.
  const missing = manifest.models
    .map((model) => model.name)
    .filter((name) => !registry.has(name));

  if (missing.length > 0) {
    throw new Error(
      `These models have no sync policy: ${missing.join(", ")}.\n` +
        `Every model must be classified — an unclassified table's local writes ` +
        `would be silently dropped at the end of the day. Add them to POLICIES ` +
        `in src/offline/sync/policy.ts (use LOCAL_ONLY if they genuinely must ` +
        `not leave the device).`
    );
  }

  return registry;
}

const REGISTRY = buildRegistry();

// =============================================================================
// ACCESS
// =============================================================================

export function policyFor(entity: string): EntityPolicy | undefined {
  return REGISTRY.get(entity);
}

export function requirePolicy(entity: string): EntityPolicy {
  const policy = REGISTRY.get(entity);
  if (policy === undefined) {
    throw new Error(`No sync policy for entity "${entity}".`);
  }
  return policy;
}

export function allPolicies(): readonly EntityPolicy[] {
  return [...REGISTRY.values()];
}

/** Entities pulled during a download, in dependency-safe order. */
export function downloadEntities(): readonly EntityPolicy[] {
  return allPolicies()
    .filter((policy) => policy.direction === "DOWN" || policy.direction === "BIDIRECTIONAL")
    .sort((a, b) => a.downloadOrder - b.downloadOrder);
}

/** Entities whose local writes are captured into the sync queue. */
export function uploadEntities(): readonly EntityPolicy[] {
  return allPolicies().filter(
    (policy) => policy.direction === "UP" || policy.direction === "BIDIRECTIONAL"
  );
}

/** Physical table names that change-capture triggers are installed on. */
export function capturedTables(): readonly string[] {
  return uploadEntities().map((policy) => policy.table);
}

export function entityForTable(table: string): EntityPolicy | undefined {
  return allPolicies().find((policy) => policy.table === table);
}
