# Module status & roadmap

What is built, what is a placeholder, and what each remaining screen needs.
Kept current so "is X done?" has one answer rather than a grep.

Last updated: 2026-08-03, at the **feature-complete** milestone.

---

## 0. Status: FEATURE-COMPLETE for single-store enterprise POS

**As of 2026-08-03, this application is feature-complete for its stated scope: a
single-store enterprise point-of-sale and inventory management system.** Every
module in §1 is built, wired to real data, access-controlled and tested. No
route renders placeholder content except the one deliberate non-build
(Backup & Restore, §2.6), and no screen renders mock data.

### 0.1 What "feature-complete" means here

It is a statement about **scope**, not about perfection:

- Every module a single-store POS needs to operate is **built and in use** — not
  scaffolded, not stubbed, not fed by fixtures.
- Every screen reads **real server data**. The last mock (the dashboard
  notifications widget) was retired at this milestone; the dashboard and the
  Notification Center now share one source.
- Every module enforces its **access boundary server-side**, and the boundaries
  that were hard-won are pinned by tests that fail if a refactor removes them.
- The remaining work in §3 and §5 is **enhancement, scale and infrastructure** —
  things that make existing features faster, broader or reach further. None of
  it is a missing capability of the core product.

### 0.2 What it does NOT mean

- **Not "no known gaps".** §3 is a real list of technical debt and it is not
  empty. The claim is that nothing in it blocks a single store from running its
  full operation on this system.
- **Not "multi-store".** Single-store is a scope boundary, not an oversight.
  Multi-store is the largest item in §5 and touches the schema.
- **Not "stop reviewing".** The standing rules in §2.6, §2.8 and §5.1 exist
  precisely because a later "simplification" is the most likely way they get
  undone.

### 0.3 The line between core and enhancement

New work should be measured against this: **core functionality is what a store
cannot operate without; an enhancement makes what already works better.** The
seven items in §5 are enhancements by that test — a store can sell, restock,
reconcile, pay, report and audit today without any of them.

If something genuinely missing from core surfaces, it belongs in §1 as a gap,
not in §5 — and this section's claim should be corrected rather than quietly
stretched to cover it.

---

## 1. Completed modules

| Module | Surface | Access | Reference |
|---|---|---|---|
| **Auth & RBAC** | Login, JWT, role hierarchy `OWNER > MANAGER > CASHIER` | All | — |
| **POS Checkout** | `/cashier/pos`, held bills, exchanges | CASHIER+ | — |
| **Sales** | History, detail, void, invoices | MANAGER+ | — |
| **Customers** | List, search, CRUD; analytics dashboard; **per-customer profile** | MANAGER+ (analytics + profile OWNER) | [CUSTOMER_PROFILE.md](./CUSTOMER_PROFILE.md) |
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
| **Store Settings** | **Store identity, business rules, regional/system preferences, security policy, integrations** | OWNER | [STORE_SETTINGS.md](./STORE_SETTINGS.md) |
| **Receipt & Invoice Settings** | **Document numbering (live on the sale path), receipt content, print options** | OWNER | [RECEIPT_INVOICE_SETTINGS.md](./RECEIPT_INVOICE_SETTINGS.md) |
| **Barcode Settings** | **Symbology, printed size, quality, workflow triggers — a tab in the Label Engine, not a screen** | OWNER | [BARCODE_SETTINGS.md](./BARCODE_SETTINGS.md) |
| **Notifications** | **List, filter, search, paging, read/unread, bulk actions; owner-only channel preferences; live Navbar unread count; dashboard widget on the same source** | All (preferences OWNER) | [NOTIFICATIONS.md](./NOTIFICATIONS.md) |

> **Configuration boundaries:** which module owns which setting, and the rules
> for adding new ones, are in
> **[CONFIGURATION_OWNERSHIP.md](./CONFIGURATION_OWNERSHIP.md)**. Read it before
> adding a configuration field or a settings screen.
>
> ⚠ **Fixed 2026-08-03:** the Settings client called `/settings`, which the
> server does not mount — every Store Settings and Receipt & Invoice read and
> write 404'd. Corrected to `/configuration`, verified end-to-end against the
> live backend, and pinned by `settings/settingsApi` routing tests.

---

## 2. Remaining placeholder pages

**One route still renders `PlaceholderPage`** (was nine). Users & Roles, My
Profile, Audit Logs, Customer Profile, Store Settings, Receipt & Invoice
Settings, Barcode Settings and Notifications all shipped 2026-08-03.

The remaining one is **Backup & Restore**, which is a **decided non-build**
(§2.6) rather than pending work — it keeps its `comingSoon: true` chip so the UI
does not promise more than it has.

### 2.0 Mock data — retired 2026-08-03

**No screen renders fabricated business data.** Closed at the feature-complete
milestone by replacing the last one:

| Was mock | Now | Note |
|---|---|---|
| `dashboardApi.getNotifications` | `GET /notifications/feed` | Returned three hardcoded rows — a "System Update" that was never scheduled, a sale that never happened. The dashboard and the Notification Center are now **one data source**; pinned by `dashboard/dashboardNotifications.test.ts`. |
| Navbar bell indicator | `GET /notifications/summary` | Was a static red dot that claimed unread mail unconditionally. Now the live audience-scoped unread count, sharing the Notification Center's React Query key so marking rows read updates the badge in the same tick. |

Three **presentation** helpers in `dashboardApi` remain explicitly labelled
`MOCK` — sales chart trends, top products, and inventory alerts. They are
labelled, not silent, and each awaits an aggregate endpoint rather than being a
gap in a shipped feature. ⚠ **When those endpoints land, the rule that applies
is the one above: no fallback to sample data on error.** `getSalesKPIs` already
states it — a 403 or a network failure must surface as an honest error, never as
fabricated revenue.

Grouped by what they actually need, because they are not equivalent work.

### 2.1 Settings cluster — pattern now established

| Screen | Route | Notes |
|---|---|---|
| ~~Store Settings~~ | `/admin/settings` | ✅ **BUILT 2026-08-03.** Six sections over the existing `Settings` singleton and the existing `GET/PATCH /configuration`. **No schema change, no migration** — the two new blocks (`systemConfig`, `integrationConfig`) reuse the `customerConfig` / `notificationConfig` columns, which were declared but never read. Fixed a latent data-loss bug: partial `PATCH`es were overwriting whole JSON columns, silently reverting business rules to Zod defaults. See [STORE_SETTINGS.md](./STORE_SETTINGS.md). |
| ~~Receipt & Invoice Settings~~ | `/admin/settings/receipt` | ✅ **BUILT 2026-08-03.** Owns `invoiceConfig` on the existing endpoints — no schema change, no migration, no new endpoint. Cost ~2 kB gzipped because it reuses the shared hooks and primitives. ⚠ Also **wired invoice numbering to its settings**: `invoicePrefix` / `invoiceNumberLength` had existed forever and were read by nothing, while `InvoiceService` hardcoded `INV-` and 6 digits. Stock settings reproduce the old format byte-for-byte. See [RECEIPT_INVOICE_SETTINGS.md](./RECEIPT_INVOICE_SETTINGS.md). |
| ~~Barcode Settings~~ | `/admin/settings/barcode` → `/admin/labels?tab=barcode` | ✅ **RESOLVED 2026-08-03 — deliberately NOT a screen.** The overlap was real: symbology, label size, quality and template overrides are all owned by the Label Engine (`PrinterSetting` + the Barcode Engine registry). Built as a **tab in the Label Engine**; the settings route redirects into it and the nav entry stays. ⚠ Also **retired a setting that did nothing**: `invoiceConfig.barcodeFormat` was editable under Receipt & Invoice and read by **nothing**, while its doc comment falsely claimed the Label Engine consumed it. Zod field kept as deprecated for backward compatibility. See [BARCODE_SETTINGS.md](./BARCODE_SETTINGS.md). |

**The settings form pattern now exists** (`CLIENT/src/features/settings`) and the
two remaining screens are expected to reuse it — `useSettingsForm`,
`SettingsSection`/`Row`/`Toggle`, `SettingsSaveBar`, the skeleton and error
states — rather than growing their own form handling. No new API or hook code
should be needed. See §4.1 of [STORE_SETTINGS.md](./STORE_SETTINGS.md).

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
| ~~Notifications~~ | `/notifications` | ✅ **BUILT 2026-08-03.** List, filter, search, paging, read/unread, bulk actions and owner-only preferences over the existing `Notification` model. **No schema change, no migration; all 18 dispatch sites untouched.** Category and severity are **DERIVED** from `type` (no such columns) — same pattern as Audit Logs. ⚠ Also fixed an **IDOR**: `markAsRead` accepted a `userId` and never used it, so any authenticated caller could mark anyone's notification read — now a **permanent security suite** (`notification.audience.security.test.ts`, 14 tests, no database required). ⚠ E2E caught an **inverted severity sort** that put CRITICAL last. **Completed 2026-08-03:** the Navbar bell shows the live unread count and the dashboard widget reads the real API, so all three surfaces share one source. See [NOTIFICATIONS.md](./NOTIFICATIONS.md). |
| ~~Customer Profile~~ | `/customers/:customerId` | ✅ **BUILT 2026-08-03.** Per-customer view — purchase history, exchange history, lifetime value, most-purchased items. New OWNER-only `GET /customers/:id/profile` returning record + rollups + capped histories in one round trip. **No schema change, no migration.** Spend rollups count COMPLETED sales only while the history tab shows every status — deliberate, and the reason the two numbers can differ. See [CUSTOMER_PROFILE.md](./CUSTOMER_PROFILE.md). |

### 2.5 Suggested order

1. ~~**Users & Roles**~~ — ✅ done 2026-08-03.
2. ~~**My Profile**~~ — ✅ done 2026-08-03.
3. ~~**Audit Logs**~~ — ✅ done 2026-08-03. Taken ahead of Customer Profile
   because Users & Roles had started writing `ROLE_CHANGED`, `PASSWORD_RESET`
   and `EMPLOYEE_DEACTIVATED` rows that nothing could read.
4. ~~**Customer Profile**~~ — ✅ done 2026-08-03. Completed the Customers module.
5. ~~**Store Settings**~~ — ✅ done 2026-08-03. Established the settings form
   pattern the remaining two screens build on, and fixed the partial-update
   data-loss bug in `configuration.service` on the way through.
6. ~~**Receipt & Invoice Settings**~~ — ✅ done 2026-08-03. Taken ahead of
   Notifications because it was the cheapest proof that the settings
   architecture actually generalises, and because it surfaced that invoice
   numbering settings were inert.
7. ~~**Notifications**~~ — ✅ done 2026-08-03. Consumed `integrationConfig` for
   its Preferences tab exactly as predicted, and reused the settings primitives
   for presentation while keeping its own data hooks. See
   [NOTIFICATIONS.md](./NOTIFICATIONS.md).
8. ~~**Barcode Settings**~~ — ✅ **DONE 2026-08-03.** The overlap resolved in
   favour of the Label Engine: barcode configuration is a tab there, not a
   screen here, and `/admin/settings/barcode` redirects into it.
   `invoiceConfig.barcodeFormat` turned out to be read by nothing and was
   retired. See [BARCODE_SETTINGS.md](./BARCODE_SETTINGS.md).

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
| **Optional config fields cannot be CLEARED** | `configuration.validation.ts` + `configMerge.ts` | ⚠ **Logged 2026-08-03 as a dedicated Configuration enhancement — do NOT fold into another module.** `optionalText` maps `""` → `undefined`, and `mergeConfigBlock` skips `undefined`, so a `PATCH` can add or change an optional field but **never remove one**. Clearing a logo URL, phone, email, website or business-hours from the UI silently does nothing: the request 200s and the old value remains. Undoing one today needs a direct DB write plus a restart (the `ConfigurationEngine` cache does not see external writes). **The design problem:** the wire format has no way to say "clear this" that is distinguishable from "not mentioned" — both arrive as absent-or-undefined. **Constraints for the fix:** must be additive, must not change what an existing client's payload means, and must keep merge-not-replace semantics. Sketch: accept an explicit `null` as the clear sentinel (`optionalText` would need `.nullable()` and `mergeConfigBlock` a `null`-means-delete branch), since no optional field currently accepts `null` as a legitimate value — so no existing payload changes meaning. Needs its own tests for add / change / clear / no-change on every optional field. Discovered during the endpoint-routing fix; see [CONFIGURATION_OWNERSHIP.md §7.5](./CONFIGURATION_OWNERSHIP.md). |
| **No self-service profile edit** | `auth.service` | A cashier who moves house must ask the owner — `PATCH /employees/:id` is OWNER-only. **Planned, additive** `PATCH /auth/me` with a positively-listed field allowlist (never role/isActive/salary/phone). Spec above `me`; see [USERS_AND_PROFILE.md §7.2](./USERS_AND_PROFILE.md). |
| **No public store-config endpoint** | `configuration.routes` | `GET /configuration` is OWNER-only, so MANAGER/CASHIER screens render the **default** currency symbol, number grouping and date format instead of the store's configured ones. Cosmetic only — every amount is computed server-side and arrives correct — but a store on a non-INR currency shows ₹ to its cashiers. **Planned, additive** `GET /configuration/public`. Full spec in [STORE_SETTINGS.md §8](./STORE_SETTINGS.md). |
| **Supplier returns** | — | `SUPPLIER_RETURN` movement type exists with no UI. This is why a received purchase cannot be cancelled — there is no sanctioned way to reverse the stock. |
| **No procurement export** | — | Reports and Inventory share `utils/exportRenderer.ts`; purchases / suppliers / brands do not use it yet. |
| **`migrate dev` is unusable** | `SERVER/prisma` | The historical `_perf` migration fails shadow-DB replay. Use `prisma migrate deploy`. |

**Cleared 2026-08-03 (maintenance):** the client tree had 9 standing `tsc`
errors in `features/audit`, which masked a live bug — `AuditSearch` passed
`SearchBox` an event-style handler, but `SearchBox` calls `onChange` with a
plain string, so `e.target.value` was `undefined` and **audit search silently
returned the unfiltered list**. Fixed with the `ApiEnvelope` type in
`lib/api` (so `res.meta` is checked rather than `any`-silenced), the handler
corrected to take the string, and `.at(-1)` replaced with index access for the
ES2020 lib target. `npx tsc --noEmit` on CLIENT is now **clean**; keep it that
way, because that is the condition under which a new error is visible.

### 3.1 Production hardening — closed 2026-08-04

A hardening phase added the observability layer the debt list above was hard to
work without. It changed **no business logic, no API contract, no schema and no
RBAC boundary**. Full write-up in
**[PRODUCTION_HARDENING.md](./PRODUCTION_HARDENING.md)**.

What it added: request correlation (`X-Request-Id` propagated via
`AsyncLocalStorage` to every layer, surfaced on the client's error screen),
SQL-level slow-query detection with per-statement log throttling, per-route
latency percentiles at `GET /health/metrics`, full stacks in production error
logs, readiness draining on SIGTERM, and route-level error boundaries.

Two findings worth carrying forward:

- ⚠ **The print queue polls `print_jobs` every 2s forever** — ~43,000
  round-trips a day on an idle store, holding a pool connection roughly half the
  time on the measured Neon instance and preventing compute autosuspend. The
  query is **not** defective (`EXPLAIN ANALYZE`: 0.045ms, optimal index), so no
  index was added. The default interval is unchanged; it is now tunable via
  `PRINT_QUEUE_IDLE_POLL_MS`. A poll-to-push rewrite is a Label Engine design
  change and is **not** done.
- ⚠ **Every IP-keyed rate limit is a whole-STORE budget**, not per user — all
  terminals typically egress from one public address. This applies to the
  pre-existing `globalLimiter` (200/min), which was left unchanged pending a
  decision against real multi-terminal traffic.

Dependency posture: request-path vulnerabilities are patched. The remainder sit
under `@prisma/dev` (not loaded by the running API) and `react-router` (an
RSC-mode advisory that does not apply to this app's router). Both are documented
rather than force-upgraded, since either fix is a stack change.

---

## 4. Test coverage

### 4.1 Server — `cd SERVER && npm test`

> Two commands, and the difference matters. `npm test` runs **everything**
> (476 passing, 9 skipped). `npm run test:unit` runs only the pure
> engine/util globs (387) — it exists so those suites never load the
> database-wiping setup file. **Suites under `src/__tests__/` — including the
> permanent security suite in §4.3 — run under `npm test`, not `test:unit`.**
> Use `npm run verify` (`tsc --noEmit && vitest run`) as the gate.

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

| `configMerge` | 32 | **New.** Settings partial-update semantics: merge preserves siblings, arrays replace wholesale, corrupt blocks, the Zod `.partial()` defaults leak, and every cross-field rule checked post-merge |
| `invoiceNumbering` | 10 | **New.** Invoice numbers are byte-for-byte unchanged under stock settings; configured prefix/width; prefix-scoped lookup makes a mid-day prefix change safe; width narrowing never truncates |

| `notification.audience.security` | 14 | **New.** ⚠ **PERMANENT SECURITY SUITE — see §4.3.** The notification audience boundary on every read and every mutation; the exact vulnerable query shape asserted against; `updateMany` not `update` (a foreign id matches 0 rows rather than throwing and confirming it exists); `findPage`'s count and rows share one predicate; omitting `role` narrows rather than widens. Mocks Prisma, so it needs **no database** and never skips |

**Totals: 476 passing, 9 skipped, 0 failing.** (Was 376 at the Store Settings
milestone, 305 before Audit Logs, 256 before Users & Roles.)

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
| `settings/validation` | 27 | **New.** Every Store Settings rule, error-to-field mapping, critical-change detection, and that each critical field has both an explanation and a dialog label |
| `settings/patch` | 15 | **New.** `applyPatch` mirrors the server merge exactly (siblings survive, arrays replace, `expectedVersion` never cached); per-field change counting |
| `settings/receipt` | 15 | **New.** Prefix character/length rules, duplicate-prefix guard, and the invoice preview format — pinned against the server's generator |
| `utils/formatters` | 12 | **New.** Configured currency/locale propagation to ~650 call sites, and fallbacks that never throw into a receipt |
| `ui/searchBoxContract` | 3 | **New.** `SearchBox` calls `onChange` with a STRING — pins the contract that audit search violated |
| `settings/barcodeOwnership` | 11 | **New.** The deprecated `barcodeFormat` stays **readable** and still round-trips (older clients keep working) but is `readonly` so new writes are a TS2540 compile error; no settings screen writes or imports it; the orphaned options constant is gone; `/admin/settings/barcode` redirects into the Label Engine |

| `settings/settingsApi` | 10 | **New.** ⚠ Endpoint routing — the settings document is `/configuration`, never `/settings`; the path stays relative to `baseURL`; the PATCH body and `expectedVersion` go out verbatim; the envelope is unwrapped exactly once. Closes the gap that let a 404'ing base path ship unnoticed |
| `notifications/notificationsApi` | 15 | **New.** ⚠ Endpoint routing — the screen reads `/notifications/feed`, never the bare unread-only path (both return 200, so a wrong path degrades silently); `isRead:false` survives serialisation; empty arrays dropped; envelope unwrapped once |
| `notifications/format` | 16 | **New.** Bad/missing timestamps render `—` rather than "Invalid Date"; CRITICAL and WARNING stay visually distinct; no "1 notifications"; unread badge hides at 0 and caps at 99+ |
| `dashboard/dashboardNotifications` | 13 | **New.** ⚠ Single source of truth — the dashboard widget issues a REAL request and never returns the retired mock fixtures; routes to `/notifications/feed`, not the bare unread-only path; an empty result is a genuine empty state rather than a fallback to samples; errors propagate instead of being masked by mock data; every server severity maps to a widget tone, `CRITICAL → ERROR` explicitly (the one value where the two vocabularies disagree) |

| `auth/portalRouting` | 12 | **New.** ⚠ Shared shell components link per-role. The app has two portals and `ManagerRoute` bounces a CASHIER out of the whole `/` subtree, so a constant path in the Navbar (rendered in BOTH shells) sends half its users to a guard — silently, with no error. Pins that portal membership is exclusive and that `notificationsPathForRole` / `portalHomeForRole` never disagree about which shell a role is in |

**Total: 287 passing, 0 failing.** (Was 262 before the feature-complete
milestone.)

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

### 4.3 Permanent security suites

Two suites are **security tests, not feature tests**. They assert access
boundaries that were violated once already, and a failure in either after a
refactor means **the refactor is wrong, not the test**. Do not delete, skip, or
relax them to make a change pass.

| Suite | Protects | Why it is permanent |
|---|---|---|
| `SERVER/.../notification.audience.security.test.ts` (14) | The notification **audience** boundary — `audienceWhere` AND-ed into every read and every mutation | A real IDOR shipped here: `markAsRead` took a `userId` and never used it, so any authenticated caller could mark anyone's notification read, including an OWNER's security alerts. Ids are exposed in feed payloads, so they were never secret. Verified to fail if the vulnerable `update({ where: { id } })` returns. |
| `CLIENT/.../users/accountRules.test.ts` (29) | The three client-side self-guards (§2.8) | The server's `enforceHierarchy` permits self-modification; two guards hold only by coincidence of the current role set and the third has **no server counterpart at all**. |

⚠ The notification suite **mocks Prisma deliberately** so it needs no database.
Integration suites here self-skip when no wipeable test database is configured
(§3), and *a security test that silently skips on most checkouts is not a
security test.* It asserts query shape; the end-to-end behaviour was verified
live on 2026-08-03 (a cashier POSTing an owner's notification id gets
`200 {updated: 0}` and the row stays unread). When the test-database gap in §3
closes, add an integration counterpart — but keep this one.

---

## 5. Future enhancements

**Everything here is an enhancement, not missing core functionality** (§0.3). A
single store can sell, restock, reconcile, pay, report and audit today without
any of it. Ordered roughly by value-to-effort.

| # | Enhancement | Where it is specified | Shape |
|---|---|---|---|
| 1 | **Product & Brand Statistics Rollup** | §3, `PROCUREMENT.md §7.1` | Per-page stats make product-count / revenue / stock-value sorting page-local. Needs rollup tables. ⚠ **Ship the two together** — they share invalidation hooks, and doing them separately wires the same five write paths twice. |
| 2 | **Supplier Returns** | §3 | `SUPPLIER_RETURN` movement type exists with no UI. This is the reason a received purchase cannot be cancelled: there is no sanctioned way to reverse the stock. |
| 3 | **Channel Delivery (email / SMS / push)** | `NOTIFICATIONS.md`, `notification.engine.ts` | In-app is the only delivered channel. Each of the others needs infrastructure that does not exist (SMTP credential; SMS gateway + DLT registration; VAPID/FCM + service worker). ⚠ **No placeholder senders** — see §5.1. |
| 4 | **Public Configuration Endpoint** | `STORE_SETTINGS.md §8` | `GET /configuration` is OWNER-only, so cashier screens render default currency/date formats. Cosmetic — every amount is computed server-side — but a non-INR store shows ₹ to its cashiers. Additive `GET /configuration/public`. |
| 5 | **Optional Configuration Field Clearing** | §3, `CONFIGURATION_OWNERSHIP.md §7.5` | A `PATCH` can add or change an optional field but never **remove** one: the wire format cannot distinguish "clear this" from "not mentioned". Sketch: accept explicit `null` as the clear sentinel. Must stay additive and must not change what an existing payload means. |
| 6 | **Test Infrastructure** | §3, §4.2 | Two gaps: (a) a `.env.test` scratch database, which un-skips `sale.integration.test.ts` — ⚠ **never point tests at live Neon, no `ALLOW_DB_WIPE=yes` anywhere**; (b) the jsdom/component-testing milestone, added *alongside* `CLIENT/vitest.config.ts`, not by flipping it. |
| 7 | **Multi-store support** | — | The largest item, and a **scope change rather than a feature**: it touches the schema (a store dimension on inventory, sales, registers and employees), every aggregate query, and RBAC (a manager scoped to *their* store). Not to be approached incrementally by adding a `storeId` to one module at a time — partial multi-tenancy is worse than none, because a query that forgets the dimension silently mixes two stores' money. |

Also open, smaller, and already specified in §3: `GET /employees/stats`
(one `GROUP BY`, no rollup needed), self-service `PATCH /auth/me` with a
positive field allowlist, and procurement export via the shared
`utils/exportRenderer.ts`.

### 5.1 Standing rule: no placeholder delivery logic

**DECIDED 2026-08-03. Applies to enhancement #3 and anything shaped like it.**

Until the infrastructure for a notification channel exists, that channel stays a
**documented TODO** in `NotificationEngine.dispatch` — not a no-op sender, not a
log-only "delivery", not a feature flag defaulting to a silent success.

**Why.** A channel that reports success without delivering is worse than an
absent one. The owner-facing Preferences tab already persists per-channel
toggles; a stub would make those toggles read as *working*, and a store would
trust an out-of-stock email that was never sent. An absent channel is visibly
absent. A fake one is invisibly broken, and is discovered by the stockout it
failed to prevent.

**When a channel is built,** its failure must be **non-fatal**: a dead SMTP host
must not roll back an in-app notification that was written successfully. The
in-app row is the durable record; every other channel is best-effort on top of
it.
