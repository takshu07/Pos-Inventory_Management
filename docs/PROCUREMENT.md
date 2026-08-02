# Procurement — Purchases, Suppliers & Brands

Three screens, one workflow. You buy **from a supplier**, the goods carry a
**brand**, and the bill settles against that supplier's **balance**. This
document is the reference for the API, the schema, the rules that must not be
re-litigated, and what is deliberately still outstanding.

Built 2026-08-02. Related: [`FINANCE_REGISTER_REPORTING.md`](./FINANCE_REGISTER_REPORTING.md).

---

## 1. Scope and access

| Module | Route tree | Frontend | Who |
|---|---|---|---|
| **Purchases** | `/api/v1/purchases` | `/admin/purchases`, `/admin/purchases/:id` | OWNER only |
| **Suppliers** | `/api/v1/suppliers` | `/admin/suppliers`, `/admin/suppliers/:id` | OWNER only |
| **Brands** | `/api/v1/brands` | `/admin/brands` | OWNER only |

Procurement is **business administration**, so it is OWNER-only end to end,
consistent with the RBAC model where MANAGER is operational. Every router calls
`requireRole("OWNER")`; the frontend routes sit inside `OwnerRoute`. Nav hiding
is never the boundary — the guards are.

Settlement (recording a payment) is performed *from* procurement screens but
belongs to Finance: `POST /api/v1/finance/supplier-payments`. That is
deliberate — a cash payment posts `CASH_OUT` to the open drawer and updates the
payables ledger, so it must go through the one service that owns those rules.

---

## 2. API surface

### 2.1 Purchases

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/purchases` | List. Filters: `search`, `supplierId`, `status`, `paymentStatus`, `dateFrom`, `dateTo`. Sort: `purchaseDate`, `purchaseNumber`, `totalAmount`, `dueAmount`, `status`, `createdAt`. |
| `GET` | `/purchases/:id` | Detail — items, payments, and a derived `receipt` progress block. |
| `POST` | `/purchases` | Create. Accepts `dueDate` for payment terms. |
| `PATCH` | `/purchases/:id` | Edit an unreceived bill. Re-derives settlement. |
| `POST` | `/purchases/:id/receive` | **Goods receipt — full or partial.** |
| `POST` | `/purchases/:id/cancel` | Cancel an untouched order. Requires `reason`. |

**Receive payload.** Omitting `items` receives **everything still outstanding**
— the behaviour the endpoint had before partial receipts existed, so older
callers are unaffected. Supplying `items` books those quantities and leaves the
rest open:

```jsonc
// Receive everything outstanding
{ "supplierInvoiceNumber": "INV-8891" }

// Receive 4 units against one line; the order stays open
{ "items": [{ "itemId": "cl…", "quantity": 4 }] }
```

### 2.2 Suppliers

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/suppliers` | List with rollups. Sort: `businessName`, `createdAt`, `updatedAt`. |
| `GET` | `/suppliers/:id` | Full profile: stats + purchase / payment / product history (50 most recent each). |
| `POST` | `/suppliers` | Create. Phone is the uniqueness key. |
| `PATCH` | `/suppliers/:id` | Edit, including `isActive` (deactivate). |
| `DELETE` | `/suppliers/:id` | Hard delete — **only** when nothing references them. |

### 2.3 Brands

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/brands` | List with catalogue + sales stats. Sort: `name`, `createdAt`, `updatedAt`. |
| `GET` | `/brands/:id` | Single brand with stats. |
| `POST` | `/brands` | Create. |
| `PATCH` | `/brands/:id` | Edit, including `isActive`. |
| `DELETE` | `/brands/:id` | Hard delete — **only** when no product references it. |

### 2.4 Response envelopes — the trap

> **LIST endpoints are double-nested; DETAIL endpoints are flat.**

The axios interceptor already returns `response.data` (the
`{ success, message, data }` wrapper). List controllers then put the service's
own `{ data, meta }` object *inside* that `data`:

```
GET /brands      → res.data.data = rows,  res.data.meta = pagination
GET /brands/:id  → res.data      = the brand
```

`/owner/products` is nested; `/finance/suppliers/:id/open-bills` is flat. Reading
the wrong level **does not throw** — it silently yields an empty list, which is
why this is covered by a live contract test rather than trusted to typecheck.
Inventory endpoints use the flat shape, which is why procurement has its own
local `toPaginated`.

---

## 3. Database schema

Migration `20260802140000_procurement_partial_receive` (applied via
`prisma migrate deploy` — **never `migrate dev`** on this project; see
`FINANCE_REGISTER_REPORTING.md` §on migrations).

| Table | Column | Why |
|---|---|---|
| `purchase_items` | `receivedQuantity INTEGER NOT NULL DEFAULT 0` | Units actually booked in. `quantity − receivedQuantity` is what remains outstanding. Stock is **never** derived from `quantity`. |
| `purchases` | `receivedAt TIMESTAMP(3)` | Set only when the **last** outstanding unit lands. A `PARTIAL` purchase leaves it null. |

Plus index `purchase_items_purchase_received_idx (purchaseId, receivedQuantity)`
for the outstanding-lines lookup.

**Three backfills ran with the migration**, and each matters:

1. Existing `RECEIVED` purchases got `receivedQuantity = quantity`. Without it
   they read as 100 % outstanding and the receive screen would invite a second
   receipt — double-counting stock.
2. `receivedAt = updatedAt` for those same rows, the best-known completion time.
3. **`dueAmount = totalAmount − paidAmount` for every non-cancelled bill.** See
   §5.1 — this repaired live data, not just history.

`PurchaseStatus` already contained `PARTIAL`; nothing wrote it until now.

---

## 4. Architecture

```
routes/{purchase,supplier,brand}.routes.ts   requireRole("OWNER")
  └─ controllers/                            Zod parse → service → envelope
       └─ services/                          transaction, audit, orchestration
            ├─ engines/procurement.engine.ts PURE RULES (no DB)
            ├─ engines/finance.engine.ts     deriveSettlementStatus
            ├─ inventoryMovement.service     executeMovement — the ONLY stock write
            └─ repositories/                 Prisma only
```

`engines/procurement.engine.ts` was extracted so the rules most likely to be
quietly wrong — what may be received, whether a receipt completes an order, what
a bill totals, how a supplier's balance is derived — are testable without a
database. The services still own transactions, movements and audit.

**Stock is only ever written through `executeMovement`.** A goods receipt calls
it once per received line, inside the same transaction that advances
`receivedQuantity`, so a failure rolls back both together.

### 4.1 Frontend

One feature, `CLIENT/src/features/procurement/`, one lazy chunk (~18 kB gz)
covering all five screens — the three modules are one workflow and splitting
them would triplicate the shared money/status vocabulary.

```
types.ts                      domain types; money always arrives as `number`
api/procurementApi.ts         transport; owns the envelope unwrapping
hooks/useProcurement.ts       React Query + cross-module invalidation
hooks/useProcurementFilters.ts URL-backed filters, debounced search
components/                   atoms, dialogs, form drawers, the builder
pages/                        Purchases, PurchaseDetail, Suppliers,
                              SupplierProfile, Brands
```

**Cross-module freshness** is one function, `invalidateDownstream()`. A receipt
moves stock (Inventory), changes payables and cash (Finance), and feeds the
Dashboard and Reports. It invalidates the roots `inventory`, `finance`,
`dashboard`, `reports`, `owner-products`, `manager-products`, `categories`,
`register`. Verify a root against that feature's `xKeys.all` before adding one —
`products` and `catalog` do **not** exist as query roots.

---

## 5. Invariants worth not re-litigating

### 5.1 A new bill owes its full total

`createPurchase` seeds `dueAmount = totalAmount` and `paymentStatus = UNPAID`.

It previously left `dueAmount` at its schema default of `0`, which meant **every
new unpaid bill reported nothing outstanding** and never appeared in the
payables queue or in any supplier balance. This was a live bug, not a
theoretical one; the migration backfills affected rows.

### 5.2 Over-receipt is rejected, never clamped

Receiving more than was ordered is a mis-keyed number far more often than a
genuine over-shipment. Clamping would put stock on the shelf the supplier never
shipped, which then reconciles against nothing. The server returns `400` with
`{ reason: "OVER_RECEIPT", outstanding }` and the UI caps the input so the value
can never be typed.

### 5.3 A partial receipt leaves the order OPEN

Status goes `PARTIAL`, `receivedAt` stays null, and the remaining units can be
received later. Marking it `RECEIVED` would strand them permanently.

### 5.4 Only what this receipt touched gets repriced

`recomputeVariants` is called with the variants in **this** receipt, not every
line on the purchase. Untouched lines have not had their cost updated, so
repricing them is a no-op at best and a spurious price event at worst.

`sellingPrice` is still never written by a receipt — only `costPrice` is, and
the pricing engine re-derives from it. (Pre-existing rule, preserved.)

### 5.5 Cancel is refused once stock or money has moved

Reversing a receipt is a **supplier return**, with its own movement type and
paperwork — not a side effect of cancelling the order. A bill with payments must
be settled or refunded, not erased. Both refusals are enforced in
`checkCancellable` and surfaced as `409`.

### 5.6 Outstanding comes from the bills, not (spend − paid)

A supplier can be paid **on account** — a `SupplierPayment` with no
`purchaseId`. Deriving outstanding as (spend − paid) would treat that as
settling specific bills and **understate the liability**. The bills' own summed
`dueAmount` is authoritative; on-account money is reported separately as
`onAccountCredit`.

### 5.7 Delete is for unused records only

Brands are `Restrict`-referenced by products; suppliers by purchases, payments
and variants. Anything with history is **deactivated**, which preserves every
bill and sale while removing it from pickers. The delete guard counts **all**
products including inactive ones — an inactive product still holds the foreign
key, so an active-only check would pass and then fail on the constraint with an
opaque database error.

### 5.8 `PaymentMethod` has no BANK_TRANSFER or CHEQUE

The enum is `CASH | UPI | CARD | CREDIT | GIFT_CARD | OTHER`. Offering anything
else 400s at submit. Bank transfers and cheques go under `OTHER` with the
reference number recorded.

---

## 6. Testing

`src/engines/__tests__/procurement.engine.test.ts` — **52 pure unit tests**, no
database, covering: purchase totals, partial receive, over-receipt rejection,
inventory reconciliation across repeated receipts, receipt progress, due amounts,
payment settlement, supplier balances, brand statistics, cancellation rules and
RBAC.

**Database access in tests is opt-in per file.** `__tests__/setup.ts` previously
connected and `TRUNCATE`d 33 tables before *every* test in *every* file, which
made pure unit tests fail on a database concern. A suite that needs a database
now calls `useTestDatabase()`, and gates itself with
`describe.skipIf(!hasTestDatabase())`.

`cleanDatabase()` **refuses to run** unless `DATABASE_URL` names a database
containing "test" (or `ALLOW_DB_WIPE=yes` is set). This project has only the
live database configured, so `sale.integration.test.ts` reports as **skipped**.
That is honest: those tests cannot run safely here. Point `DATABASE_URL` at a
test database and they run.

Current state: **256 passing, 9 skipped, 0 failing.**

A live-server contract test (49 assertions over every endpoint, response shape,
RBAC boundary and the full money/goods lifecycle) was run against the running
API during the build. It is not checked in — it mutates real data and cleans up
after itself, which is appropriate for a one-off verification but not for CI.

---

## 7. Outstanding

### 7.1 Global brand statistics (`TODO(scale)`)

Brand stats are computed for the **current page only**, so product-count,
revenue and stock-value sorting is page-local and the UI says so. Sorting them
globally is impossible today: the ordering column does not exist in SQL, so
Postgres cannot `ORDER BY` it before paginating.

The intended fix, documented in full at `brand.repository.statsFor`:

1. A `brand_stats` rollup table keyed by `brandId`.
2. Maintained incrementally from the events that change it — sale, goods
   receipt, stock adjustment, product create/archive, variant cost change. Each
   already flows through a single write path.
3. Rebuilt nightly so incremental drift self-heals.
4. `findMany` then LEFT JOINs it and sorts in SQL; the page-local sort and its
   caveat are deleted.

**Decided (2026-08-02): this ships together with the `product_stats` rollup
already pending in `catalog.service`, not before it.** Both are fed by the same
five write paths, so building them separately means wiring the same hooks twice
and running two half-finished rollup systems in between. Until then the
page-local sort stands and the UI states its scope.

### 7.2 Not built

- **Editing an existing purchase's lines from the UI.** The `PATCH` endpoint
  supports it; the frontend only edits header fields and terms.
- **Supplier returns.** The `SUPPLIER_RETURN` movement type exists and is the
  documented way to reverse a receipt, but there is no screen for it. This is
  the gap that makes §5.5 a hard refusal rather than a redirect.
- **Export.** Purchases, suppliers and brands have no CSV/PDF export, unlike
  Reports and Inventory which share `utils/exportRenderer.ts`.
