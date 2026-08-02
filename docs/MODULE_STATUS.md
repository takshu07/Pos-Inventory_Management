# Module status & roadmap

What is built, what is a placeholder, and what each remaining screen needs.
Kept current so "is X done?" has one answer rather than a grep.

Last updated: 2026-08-02, after the Procurement milestone.

---

## 1. Completed modules

| Module | Surface | Access | Reference |
|---|---|---|---|
| **Auth & RBAC** | Login, JWT, role hierarchy `OWNER > MANAGER > CASHIER` | All | — |
| **POS Checkout** | `/cashier/pos`, held bills, exchanges | CASHIER+ | — |
| **Sales** | History, detail, void, invoices | MANAGER+ | — |
| **Customers** | List, search, CRUD; analytics dashboard | MANAGER+ (analytics OWNER) | — |
| **Products** | Owner CRUD + 9-step creation wizard; manager read-only catalogue | Split by role | — |
| **Categories** | Full CRUD, analytics, bulk actions | OWNER | — |
| **Inventory** | Stock ledger, movements, adjustments, cycle counts, valuation, reorder, velocity | OWNER (manager narrowed) | — |
| **Workforce** | Roster, attendance, performance, login history | OWNER (activity MANAGER+) | — |
| **Cash Register** | Shift sessions, drawer reconciliation | All authenticated | [FINANCE_REGISTER_REPORTING.md](./FINANCE_REGISTER_REPORTING.md) |
| **Finance** | P&L, cash flow, payables, payroll, expenses | OWNER | [FINANCE_REGISTER_REPORTING.md](./FINANCE_REGISTER_REPORTING.md) |
| **Reports** | 5 tabbed destinations, global search | OWNER (search MANAGER+) | [FINANCE_REGISTER_REPORTING.md](./FINANCE_REGISTER_REPORTING.md) |
| **Labels & Barcodes** | Template engine, print jobs, driver/transport split | OWNER | — |
| **Discounts** | Rules, promotions, coupons | OWNER | — |
| **Procurement** | **Purchases (partial receive), Suppliers, Brands** | OWNER | [PROCUREMENT.md](./PROCUREMENT.md) |

---

## 2. Remaining placeholder pages

Nine routes still render `PlaceholderPage`. They are **routed and reachable** —
the nav links resolve rather than dead-ending — and the six under Settings carry
a `comingSoon: true` chip so the UI does not promise more than it has.

Grouped by what they actually need, because they are not equivalent work.

### 2.1 Settings cluster — needs a settings backend surface

The `Settings` model and `configuration.service` already exist and hold
`storeConfig` (timezone, exchange window, `enforceRegisterSession`). What is
missing is the CRUD surface and the screens.

| Screen | Route | Notes |
|---|---|---|
| Store Settings | `/admin/settings` | Store identity, timezone, tax defaults, the register-enforcement toggle. The one that unblocks the others — it establishes the settings form pattern. |
| Receipt & Invoice Settings | `/admin/settings/receipt` | Receipt header/footer, invoice numbering, print options. Overlaps the Label Engine's template model; check before building a second one. |
| Barcode Settings | `/admin/settings/barcode` | Symbology defaults, label size. **Largely exists already** inside the Label Engine — this may be a link rather than a new screen. |

### 2.2 Users & Roles — needs no new backend

| Screen | Route | Notes |
|---|---|---|
| Users & Roles | `/admin/settings/users` | Employee CRUD and role assignment. The `employee` service already has create / update / role-change, all OWNER-gated. This is a **frontend-only** build against existing endpoints — the cheapest remaining item. |

### 2.3 Audit Logs — needs a read API

| Screen | Route | Notes |
|---|---|---|
| Audit Logs | `/admin/audit-logs` | `audit_logs` is written by every module via `auditRepository.create` and is the largest table in the system. There is **no read endpoint** — needs a paginated, filterable list (by module, action, actor, date) plus a diff view for `oldData`/`newData`. |

### 2.4 Profile & notifications — small, self-contained

| Screen | Route | Notes |
|---|---|---|
| My Profile | `/profile` (both portals) | Own details, password change. `auth.service.changePassword` exists. Two routes render this — build once. |
| Notifications | `/notifications` | `notification.service` and the `Notification` model exist; the engine already writes low-stock and workforce alerts. Needs a list, read/unread and preferences. |
| Customer Profile | `/customers/:customerId` | The customers list and analytics are built; this is the per-customer view — purchase history, exchange history, lifetime value. Closest analogue is the supplier profile just built; reuse its tab pattern. |

### 2.5 Suggested order

1. **Users & Roles** — no backend work, unblocks account administration.
2. **My Profile** — small, and every role hits it.
3. **Customer Profile** — completes the Customers module; pattern already exists.
4. **Store Settings** — establishes the settings form pattern.
5. **Notifications** — model and writers exist.
6. **Audit Logs** — needs a new read API; largest table, so paginate carefully.
7. **Receipt & Barcode Settings** — resolve the Label Engine overlap first.

Backup & Restore is **not** in this list — the decision is not to build it
(§2.6).

### 2.6 Backup & Restore — DECIDED: no in-app restore

**Product decision, 2026-08-02. This is settled; do not re-open it by building
a restore screen "because the nav item is there".**

| Screen | Route | Status |
|---|---|---|
| Backup & Restore | `/admin/settings/backup` | **In-app restore will not be built.** Export-only if and when a need appears. |

**The decision.**

1. **No in-app restore mechanism.** Not now, not as a stretch goal.
2. **Neon Point-in-Time Recovery is the supported restore strategy** — see §2.7.
3. **Export-only is the sole permitted scope** for this screen, and only if a
   concrete need appears (an accountant wanting a data dump, a migration off the
   platform). It downloads; it never loads.

**Why.** The database is Neon, managed Postgres with continuous PITR already
included. An in-app restore would have to truncate live tables and reload them —
the single most destructive operation the system could expose, sitting behind a
button in a settings page, reachable by anyone with the owner password. It would
duplicate infrastructure that already exists, is continuously tested by the
provider, and is more trustworthy than anything built here. The failure mode is
also asymmetric: a backup feature that silently doesn't work is discovered on
the worst day of the business's year, and a restore feature that works too well
destroys data that was never meant to be rolled back.

If this screen is ever built as export-only, it must not be called "Backup &
Restore" — the name promises recovery the feature does not provide. "Export
data" is the honest label.

### 2.7 Restore procedure (Neon PITR)

The supported way to recover this system's data. Neon retains a continuous
history and can branch from any point within the retention window.

1. **Do not** attempt recovery through the application. There is no in-app
   restore path, by design (§2.6).
2. In the Neon console, create a **branch from a timestamp** just before the
   incident. This is non-destructive — the current database is untouched, so a
   mistaken recovery point costs nothing.
3. Point a scratch deployment at the branch's connection string and verify the
   data is what you expect *before* touching production.
4. Promote the branch, or copy the specific rows back, depending on blast
   radius. A single mis-deleted supplier does not warrant rolling back every
   sale since.
5. Retention depends on the Neon plan — **confirm the current window before
   relying on it.** A 7-day window does not help with damage discovered in week
   three.

Application-level safety nets that reduce how often this is needed, and which
should be preserved:

- No delete endpoint exists for any financial record, at any role.
- Brands and suppliers with history cannot be deleted, only deactivated.
- `audit_logs` records `oldData`/`newData` for every mutation, so many
  "restores" are really a targeted correction read out of the audit trail.
- `cleanDatabase()` in the test harness refuses to truncate a database whose
  name does not contain "test".

---

## 3. Known technical debt

| Item | Where | Impact |
|---|---|---|
| **Global brand statistics** | `brand.repository.statsFor` | Brand stats are per-page, so product-count / revenue / stock-value sorting is page-local. Needs a `brand_stats` rollup table. **Deferred by decision (2026-08-02): ship it together with the product-statistics rollup below, not before.** They share invalidation hooks, and building them separately means wiring the same five write paths twice. Full plan in the `TODO(scale)` comment and [PROCUREMENT.md §7.1](./PROCUREMENT.md). |
| **Global product statistics** | `catalog.service` | Same shape of problem — price/stock sorts use a bounded 2000-row in-memory window. Paired with the brand rollup above; do them as one piece of work. |
| **No test database** | `SERVER/.env` | `DATABASE_URL` points at live Neon, so `sale.integration.test.ts` (9 tests) is **skipped** rather than run. `cleanDatabase()` refuses to truncate a non-test database. **Standing rule (2026-08-02): automated tests are never to be pointed at the live database — no `ALLOW_DB_WIPE=yes` in any script, CI job or local shell profile.** The fix is a `.env.test` against a scratch database; until that exists the suite stays skipped, which is the correct trade. |
| **Supplier returns** | — | `SUPPLIER_RETURN` movement type exists with no UI. This is why a received purchase cannot be cancelled — there is no sanctioned way to reverse the stock. |
| **No procurement export** | — | Reports and Inventory share `utils/exportRenderer.ts`; purchases / suppliers / brands do not use it yet. |
| **`migrate dev` is unusable** | `SERVER/prisma` | The historical `_perf` migration fails shadow-DB replay. Use `prisma migrate deploy`. |

---

## 4. Test coverage

| Suite | Tests | Notes |
|---|---|---|
| `procurement.engine` | 52 | Partial receive, settlement, due amounts, supplier balances, brand stats, RBAC, inventory reconciliation |
| `finance.engine` | — | P&L, settlement, payroll, period resolution |
| `inventory.engine`, `cashRegister.engine`, `workforce.engine`, `catalogPricing.engine`, `asset.engine`, `promotion`/`discountDates` | — | Pure engine rules |
| `authContextCache`, `exchangeWindow` | — | Utils |
| `sale.integration` | 9 | **Skipped** — needs a test database (see §3) |

**Totals: 256 passing, 9 skipped, 0 failing.**

Database access in tests is **opt-in per file** via `useTestDatabase()`. Pure
unit tests run with no connection, no truncation and no network.
