# Customer Profile

The per-customer view at `/customers/:customerId` — purchase history, exchange
history, lifetime value, and what the customer actually buys. Built 2026-08-03,
completing the Customers module and clearing the last placeholder route outside
the Settings cluster.

**Additive only.** No schema change, no migration. Every query reads tables that
already existed; nothing in the sale, exchange or customer write paths was
touched.

---

## 1. Access

**OWNER only**, matching `/customers/table` and `/customers/analytics`.

Lifetime value, spend history and buying patterns are business intelligence —
the same class of data as the analytics cards, not shop-floor data. Cashiers and
managers keep everything the till needs:

| Endpoint | Access | Purpose |
|---|---|---|
| `GET /customers/search` | CASHIER+ | Typeahead for attaching a customer to a sale |
| `GET /customers/:id` | CASHIER+ | The basic record |
| `GET /customers/:id/exchange-eligibility` | CASHIER+ | Exchange-window check at the till |
| **`GET /customers/:id/profile`** | **OWNER** | **Full profile — this module** |

Verified live against the running server: owner `200`, manager `403`, cashier
`403`, anonymous `401`, and all four write verbs `404` on the profile path.

---

## 2. One endpoint, one round trip

`GET /api/v1/customers/:id/profile` returns the record, both rollups, and all
three histories in a single response:

```
{ ...customer,
  statistics: { lifetimeSpend, totalOrders, averageOrderValue, firstVisit,
                lastVisit, totalItemsPurchased,
                totalExchanges, totalReturnedValue, totalIssuedValue,
                netPriceDifference, lastExchangeDate,
                active, activeWindowDays },
  purchases:    [ ...capped ],
  exchanges:    [ ...capped ],
  topProducts:  [ ...top 10 ],
  historyLimit: 50 }
```

The five aggregations are issued with `Promise.all`, not sequentially. The
profile always renders every tab, so against a network-latency (Neon) database
five serial queries would cost five round trips for no benefit. This mirrors
`getSupplierById`. A regression test asserts the concurrency, because losing it
makes the screen ~5× slower with no visible failure.

---

## 3. The invariants that make it correct

These are the things that fail **quietly** — a bad rollup still renders a
number, a leaked row still renders a row. Each is covered by a regression test.

### 3.1 COMPLETED-only rollups vs all-status history

Two rules that pull in opposite directions, which is why a single "just filter
it once" refactor breaks one of them:

- **Spend rollups** (`lifetimeSpend`, `totalOrders`, `averageOrderValue`,
  `topProducts`) count **COMPLETED sales only**.
- **The purchase-history tab** shows **every status**. A VOIDED or PARTIAL sale
  is part of the relationship history; hiding it would make the tab disagree
  with the customer's own receipts.

The consequence is deliberate and visible: summing the rows in the purchase tab
can exceed the lifetime-spend KPI. Status badges are colour-coded so a
non-COMPLETED row reads differently at a glance, and the UI never recomputes
either number in the browser — the server's rollup is the authority.

### 3.2 `priceDifference` is signed at the source

Exchange net difference is the **sum of the stored signed `priceDifference`
column**, never re-derived as `issued − returned`. Those two agree today but
diverge the moment an exchange is partially settled. Positive means the customer
paid extra; negative means the shop refunded them. The sign is passed through
unchanged so the UI renders direction rather than guessing it.

A customer with two offsetting exchanges nets to zero but still has two exchange
events — the count and the net are independent facts, and both are shown.

### 3.3 Walk-In is refused

`GET /customers/:walkInId/profile` returns **400**, before any aggregation runs.

The Walk-In record is a system placeholder that accumulates every anonymous sale
in the shop. Rendering a "profile" for it would present hundreds of unrelated
strangers' transactions as one person's purchase history — a plausible-looking
screen that is entirely meaningless. The guard short-circuits ahead of the
fan-out, which a test asserts.

### 3.4 The active badge cannot contradict the list

`active` is derived from the **same `ACTIVE_WINDOW_DAYS` (90)** the customer
table and analytics cards use, imported from one constant. A customer who has
never purchased has a `null` last visit and is **inactive** — a null-unsafe
comparison would silently flip them to active.

### 3.5 Histories are capped, and the cap is disclosed

Each history is capped at `PROFILE_HISTORY_LIMIT` (50) server-side and the cap
is returned as `historyLimit`. When a tab is full the UI says *"Showing the 50
most recent … Use Reports for the complete history."* Silent truncation is the
failure mode this prevents: a user reconciling the profile against a report
needs to know they are seeing a slice.

### 3.6 Product names come from snapshots, not the live catalogue

`topProducts` groups on `SaleItem`'s archival snapshot columns
(`productName`, `sizeName`, `colorName`, `sku`) rather than joining `products`
and `product_variants`.

Those snapshots exist precisely so a historical line renders as it was sold.
Joining the live tables would relabel past purchases whenever a product is
renamed. `variantId` is still carried through for linking, taken as `MAX()`
since it is functionally dependent on the snapshot group.

---

## 4. Files

**Server** (all additive):

| File | Added |
|---|---|
| `repositories/customer.repository.ts` | `purchaseHistory`, `exchangeHistory`, `getExchangeStatistics`, `topPurchasedProducts`, `PROFILE_HISTORY_LIMIT` |
| `services/customer.service.ts` | `getCustomerProfile` — guard, fan-out, derivations |
| `controllers/customer.controller.ts` | `getCustomerProfile` |
| `routes/customer.routes.ts` | `GET /:id/profile` behind `requireRole("OWNER")` |

**Client** — `features/customers/pages/CustomerProfilePage.tsx`, plus the
profile types, `getCustomerProfile` api call, and `useCustomerProfile` hook.
Ships in the existing `customers` chunk (27.6 kB).

Tabs are URL-synced via `?tab=`, matching the supplier profile and reports —
bookmarking, sharing, refresh and the Back button all keep working, which plain
`useState` silently breaks.

The profile has its **own React Query cache key** rather than reusing `detail`.
The two endpoints return different shapes, and sharing a key would let a
cashier's lightweight `/customers/:id` response satisfy — and blank out — the
profile screen's tabs.

The customer table's row click now navigates to `/customers/:id` (it previously
went to `/sales?customerId=…`, and the profile route was the placeholder).

---

## 5. Verification

- **21 new tests** (`__tests__/customer.profile.test.ts`), Prisma mocked at the
  module boundary. Full suites: **393 server** (was 372), **150 client**, 0
  failures. Client build clean.
- **Live run** against the real database confirmed: lifetime spend equals the
  COMPLETED-only sum exactly; the top-products rollup matches a raw
  `sale_items` sum; exchange net matches the stored signed sum; unknown id
  `404`s.
- **RBAC over HTTP** confirmed across all three seeded roles (§1).
- Guard paths absent from real data (walk-in, zero-sale customer) were exercised
  inside a transaction that was rolled back; the database was verified unchanged
  afterwards.

---

## 6. Not built — deliberate

- **Pagination on the history tabs.** Capped at 50 with the cap disclosed.
  Reports already own complete history; paginating here would duplicate that
  surface. Add it if a customer's tab routinely hits the cap.
- **Editing from the profile.** `PATCH /customers/:id` exists (MANAGER+) but no
  edit affordance is wired here. The profile is currently read-only; adding a
  drawer is a self-contained follow-up.
- **Export.** Same open question as the audit trail: exporting customer
  purchase history is a `REPORT_EXPORTED`-class action and should itself be
  audited. Worth a deliberate decision rather than a footnote.
