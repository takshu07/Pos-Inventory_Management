# Module status & roadmap

What is built, what is a placeholder, and what each remaining screen needs.
Kept current so "is X done?" has one answer rather than a grep.

Last updated: 2026-08-03, after the Audit Logs milestone.

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
| **Procurement** | Purchases (partial receive), Suppliers, Brands | OWNER | [PROCUREMENT.md](./PROCUREMENT.md) |
| **Users & Roles** | **Account CRUD, role assignment, activation, password reset** | OWNER | [USERS_AND_PROFILE.md](./USERS_AND_PROFILE.md) |
| **My Profile** | **Own details, account info, password change (both portals)** | All | [USERS_AND_PROFILE.md](./USERS_AND_PROFILE.md) |
| **Audit Logs** | **Read-only trail: filter by user/module/entity/action/severity/period, field-level diff, session context** | OWNER | [AUDIT_LOGS.md](./AUDIT_LOGS.md) |

---

## 2. Remaining placeholder pages

Six routes still render `PlaceholderPage` (was nine; Users & Roles, My Profile
and Audit Logs shipped 2026-08-03). They are **routed and reachable** — the nav
links resolve rather than dead-ending — and the four remaining under Settings
carry a `comingSoon: true` chip so the UI does not promise more than it has.

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

### 2.2 Users & Roles — ✅ BUILT (2026-08-03)

Shipped as predicted: **frontend-only**, no new endpoints, no schema change.
See [USERS_AND_PROFILE.md](./USERS_AND_PROFILE.md).

One thing worth carrying forward: role change and password reset deliberately
call the **workforce** tree (`/owner/workforce/employees/:id/role`,
`.../reset-password`) rather than `PATCH /employees/:id`. Only the workforce
path revokes the target's sessions, so a demotion through the employees
endpoint would leave the old role live in their JWT until it expired.

### 2.3 Audit Logs — BUILT

| Screen | Route | Notes |
|---|---|---|
| ~~Audit Logs~~ | `/admin/audit-logs` | ✅ **BUILT 2026-08-03.** New OWNER-only read API at `/api/v1/owner/audit-logs` (list, detail, related, filters, summary) over the existing table. **No schema change, no migration, audit-writing untouched.** Severity is DERIVED from `action` and filtered as an indexed `action IN (...)`; IP/device is correlated from `login_history` and labelled as session-derived. See [AUDIT_LOGS.md](./AUDIT_LOGS.md). |

### 2.4 Profile & notifications — small, self-contained

| Screen | Route | Notes |
|---|---|---|
| ~~My Profile~~ | `/profile`, `/cashier/profile` | ✅ **BUILT 2026-08-03.** One `ProfileView` mounted on both routes, as planned. Read-only details + password change — there is no self-service profile-update endpoint, so editing would need an additive `PATCH /auth/me`. See [USERS_AND_PROFILE.md](./USERS_AND_PROFILE.md). |
| Notifications | `/notifications` | `notification.service` and the `Notification` model exist; the engine already writes low-stock and workforce alerts. Needs a list, read/unread and preferences. |
| Customer Profile | `/customers/:customerId` | The customers list and analytics are built; this is the per-customer view — purchase history, exchange history, lifetime value. Closest analogue is the supplier profile just built; reuse its tab pattern. |

### 2.5 Suggested order

1. ~~**Users & Roles**~~ — ✅ done 2026-08-03.
2. ~~**My Profile**~~ — ✅ done 2026-08-03.
3. ~~**Audit Logs**~~ — ✅ done 2026-08-03. Taken ahead of Customer Profile
   because Users & Roles had started writing `ROLE_CHANGED`, `PASSWORD_RESET`
   and `EMPLOYEE_DEACTIVATED` rows that nothing could read.
4. **Customer Profile** — completes the Customers module; pattern already exists.
5. **Store Settings** — establishes the settings form pattern.
6. **Notifications** — model and writers exist.
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

### 2.8 Standing security rules — DECIDED, do not re-open

Settled 2026-08-03 at the Users & Roles merge. Recorded here because both are
the kind of rule a later "simplification" removes by accident. Full reasoning in
[USERS_AND_PROFILE.md §7.3–§7.4](./USERS_AND_PROFILE.md).

1. **Session invalidation stays on the Workforce services.** Role change and
   password reset must keep routing through
   `/owner/workforce/employees/:id/role` and `.../reset-password` — the only
   paths that call `invalidateAuthContext` + `closeOpenSessions`. Consolidating
   them into `PATCH /employees/:id` *would appear to work* (it accepts `role`
   and enforces the hierarchy) while silently leaving a demoted manager's JWT
   valid and a reset employee's sessions live. **Session revocation is a
   security requirement of these operations, not an implementation detail.**

2. **The three client-side self-guards are security rules, not UI polish.** No
   self-role-change, no self-deactivation, no self-password-reset through the
   admin interface. The server's `enforceHierarchy` *permits* self-modification;
   the owner-guards cover the first two only by coincidence of the current role
   set, and the third has no server counterpart at all — the owner-reset path
   needs no current password, so aiming it at your own account converts an
   unlocked session into an account takeover.

Both are pinned by tests (`usersApi.test.ts`, `accountRules.test.ts`). A failure
in either after a refactor means the refactor is wrong, not the test.

---

## 3. Known technical debt

| Item | Where | Impact |
|---|---|---|
| **Global brand statistics** | `brand.repository.statsFor` | Brand stats are per-page, so product-count / revenue / stock-value sorting is page-local. Needs a `brand_stats` rollup table. **Deferred by decision (2026-08-02): ship it together with the product-statistics rollup below, not before.** They share invalidation hooks, and building them separately means wiring the same five write paths twice. Full plan in the `TODO(scale)` comment and [PROCUREMENT.md §7.1](./PROCUREMENT.md). |
| **Global product statistics** | `catalog.service` | Same shape of problem — price/stock sorts use a bounded 2000-row in-memory window. Paired with the brand rollup above; do them as one piece of work. |
| **No test database** | `SERVER/.env` | `DATABASE_URL` points at live Neon, so `sale.integration.test.ts` (9 tests) is **skipped** rather than run. `cleanDatabase()` refuses to truncate a non-test database. **Standing rule (2026-08-02): automated tests are never to be pointed at the live database — no `ALLOW_DB_WIPE=yes` in any script, CI job or local shell profile.** The fix is a `.env.test` against a scratch database; until that exists the suite stays skipped, which is the correct trade. |
| **No `/employees/stats`** | `employee.service` | Users & Roles shows role/status counts derived from the LOADED PAGE, labelled "on this page"; only the total is global. **Planned, additive** — one `GROUP BY`, no rollup table needed (unlike the two above: `employees` is sized by staff count, not transaction count). Spec above `listEmployees`; see [USERS_AND_PROFILE.md §7.1](./USERS_AND_PROFILE.md). |
| **No self-service profile edit** | `auth.service` | A cashier who moves house must ask the owner — `PATCH /employees/:id` is OWNER-only. **Planned, additive** `PATCH /auth/me` with a positively-listed field allowlist (never role/isActive/salary/phone). Spec above `me`; see [USERS_AND_PROFILE.md §7.2](./USERS_AND_PROFILE.md). |
| **Supplier returns** | — | `SUPPLIER_RETURN` movement type exists with no UI. This is why a received purchase cannot be cancelled — there is no sanctioned way to reverse the stock. |
| **No procurement export** | — | Reports and Inventory share `utils/exportRenderer.ts`; purchases / suppliers / brands do not use it yet. |
| **`migrate dev` is unusable** | `SERVER/prisma` | The historical `_perf` migration fails shadow-DB replay. Use `prisma migrate deploy`. |

---

## 4. Test coverage

### 4.1 Server — `cd SERVER && npm run test:unit`

| Suite | Tests | Notes |
|---|---|---|
| `procurement.engine` | 52 | Partial receive, settlement, due amounts, supplier balances, brand stats, RBAC, inventory reconciliation |
| `employeeValidation` | 49 | **New.** The server side of the contract the client mirrors: role enum (OWNER not assignable), password policy, `email:""` clears, `isActive` on update, list-query filters and sort keys |
| `finance.engine` | — | P&L, settlement, payroll, period resolution |
| `inventory.engine`, `cashRegister.engine`, `workforce.engine`, `catalogPricing.engine`, `asset.engine`, `promotion`/`discountDates` | — | Pure engine rules |
| `authContextCache`, `exchangeWindow` | — | Utils |
| `audit.engine` | 29 | **New.** Severity policy over every `ActionType`, the severity→actions inversion (round-trip + partition, no gaps/overlaps), validation-enum sync with Prisma, diff honesty (`null` vs `""` vs absent, credentials never rendered), half-open period ranges |
| `audit.service` | 22 | **New.** Severity filtering compiles to an indexed `action IN (...)`; the empty-intersection case returns nothing rather than everything; `lt` not `lte`; deep-offset refusal; capped counts; list never selects `oldData`/`newData`; session context tagged `SESSION` |
| `audit.validation` | 16 | **New.** Enum guards as an injection surface, comma-list *and* repeated-param forms, custom-range rules, `limit` cap |
| `sale.integration` | 9 | **Skipped** — needs a test database (see §3) |

**Totals: 372 passing, 9 skipped, 0 failing.** (Was 305 before the Audit Logs
milestone, 256 before Users & Roles.)

Database access in tests is **opt-in per file** via `useTestDatabase()`. Pure
unit tests run with no connection, no truncation and no network.

### 4.2 Client — `cd CLIENT && npm test`

**New in 2026-08-03.** The client had no test infrastructure before this
milestone. `CLIENT/vitest.config.ts` runs PURE unit tests only — node
environment, no DOM, no setup file — mirroring the server's `test:unit`
philosophy.

| Suite | Tests | Notes |
|---|---|---|
| `users/accountRules` | 29 | Every RBAC guard: self-demotion, owner deactivation, cross-owner administration, role assignment, unauthenticated actor |
| `users/validation` | 39 | Form schemas mirroring `employee.validation` |
| `users/format` | 28 | Null-safety — "Not recorded" vs ₹0, "Never" vs a date, em dash vs "Invalid Date" |
| `users/usersApi` | 15 | Endpoint routing (role change must hit the workforce tree), empty-param dropping, `isActive:false` / `email:""` survival |
| `audit/auditApi` | 14 | **New.** Envelope level (this tree is FLAT), array filters comma-joined, empty params dropped, `totalIsExact` defaults, and an assertion that **no write functions exist** on the audit API surface |
| `audit/format` | 25 | **New.** `null` vs `""` vs absent vs `false` all render distinctly, severity variants stay visually distinct, capped totals render with a `+` |

**Total: 150 passing, 0 failing.**

#### Testing policy — DECIDED 2026-08-03

**Logic tests are mandatory.** Any feature shipping RBAC rules, validation
schemas, money/date maths, filter derivation or transport routing lands with
unit tests covering them. Those regressions are silent: nothing crashes, the
types still check, and a permission that stopped being enforced is invisible
until it causes harm.

**Component/UI tests are a separate infrastructure milestone** — deliberately
not set up here. They need jsdom, `@testing-library/react`, a setup file and a
house style for queries and async assertions. That must not be bolted onto a
feature build: a half-adopted testing library is worse than none, because it
sets a precedent nobody follows consistently. When that milestone happens, add
a jsdom project *alongside* `CLIENT/vitest.config.ts` rather than flipping it,
so the pure-logic suites keep running with no DOM and no setup cost.

The split follows where failure is invisible: a button that moves is caught by
looking at the screen; a guard that stopped refusing self-demotion is not.
Policy is restated at the top of `CLIENT/vitest.config.ts`.
