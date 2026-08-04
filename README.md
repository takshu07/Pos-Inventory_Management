# Pos-Inventory_Management

A retail POS and inventory system. React 19 + Vite + TanStack Query on the
client; Express 5 + Prisma 7 + PostgreSQL (Neon) on the server.

## Status: feature-complete (single-store enterprise POS)

**As of 2026-08-03, the core platform is feature-complete for its scope: a
single-store enterprise point-of-sale and inventory system.** Every module is
built, wired to real server data, access-controlled and tested. No screen
renders mock business data, and the only route still showing a placeholder is
Backup & Restore — a **deliberate non-build**, not pending work.

Remaining work is **enhancement, scale and infrastructure**, not missing core
capability: statistics rollups, supplier returns, notification channel delivery
(email/SMS/push), a public configuration endpoint, clearing optional config
fields, test infrastructure, and multi-store support.

Full breakdown — what is done, what is deliberately not, and the line between
core and enhancement — in **[MODULE_STATUS.md §0 and §5](docs/MODULE_STATUS.md)**.

## Documentation

| Doc | What it covers |
|---|---|
| [docs/MODULE_STATUS.md](docs/MODULE_STATUS.md) | **Start here.** Feature-complete status (§0), what is built, the deliberate non-builds, known technical debt, test coverage, and the future-enhancement list (§5). |
| [docs/PROCUREMENT.md](docs/PROCUREMENT.md) | Purchases (incl. partial goods receipt), Suppliers, Brands — API, schema, invariants. |
| [docs/FINANCE_REGISTER_REPORTING.md](docs/FINANCE_REGISTER_REPORTING.md) | Cash Register, Finance and Reports — the drawer ledger and accounting definitions. |
| [docs/USERS_AND_PROFILE.md](docs/USERS_AND_PROFILE.md) | Users & Roles and My Profile — account administration, the RBAC/privilege-escalation rules, and why role changes route through the workforce tree. |
| [docs/AUDIT_LOGS.md](docs/AUDIT_LOGS.md) | Audit Logs — the read API over `audit_logs`, why severity is derived rather than stored, and the performance rules for the largest table in the system. |
| [docs/CUSTOMER_PROFILE.md](docs/CUSTOMER_PROFILE.md) | Customer Profile — the per-customer view, and why spend rollups count completed sales only while the history tab shows every status. |
| [docs/STORE_SETTINGS.md](docs/STORE_SETTINGS.md) | Store Settings — the centralized settings architecture every settings screen reuses, and ⚠ why a config block must be merged rather than assigned (the bug that silently reverted business rules to defaults). |
| [docs/RECEIPT_INVOICE_SETTINGS.md](docs/RECEIPT_INVOICE_SETTINGS.md) | Receipt & Invoice Settings — document numbering and receipt content, and ⚠ why the invoice prefix lookup is scoped to the prefix (what makes a mid-day change safe). |
| [docs/BARCODE_SETTINGS.md](docs/BARCODE_SETTINGS.md) | Barcode Settings — why barcode configuration is a tab in the Label Engine rather than a settings screen, and the setting that was read by nothing. |
| [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md) | Notifications — the derived category/severity taxonomy, ⚠ the audience boundary that is this module's **only** access control, and why channel delivery stays a documented TODO. |
| [docs/CONFIGURATION_OWNERSHIP.md](docs/CONFIGURATION_OWNERSHIP.md) | ⚠ **Read before adding any configuration field or settings screen.** Which module owns which setting, and the rules for adding new ones. |

## Running it

```bash
# Server (port 3000)
cd SERVER && npm run dev

# Client
cd CLIENT && npm run dev
```

## Migrations

Use `npx prisma migrate deploy`, **not** `migrate dev` — the historical `_perf`
migration fails shadow-database replay, which makes `migrate dev` unusable on
this project. `deploy` applies pending migrations directly and never provisions
a shadow database.

## Tests

```bash
cd SERVER && npm test            # 476 passing, 9 skipped — the full suite
cd SERVER && npm run test:unit   # 387 — pure engine/util globs only, no database
cd SERVER && npm run verify      # tsc --noEmit && vitest run — the gate
cd CLIENT && npm test            # 287 pure unit tests
cd CLIENT && npx tsc --noEmit    # must stay clean (see MODULE_STATUS §3)
```

⚠ `test:unit` is **narrower than it sounds**: it globs `engines/` and `utils/`
only, so suites under `src/__tests__/` — including the permanent security suite
below — run under `npm test`, not `test:unit`. Use `npm run verify` as the gate.

Database access is opt-in per test file. Integration suites that truncate tables
**skip** unless `DATABASE_URL` names a database containing `test` — the guard in
`src/__tests__/utils/db.ts` refuses to wipe the live database. See
[MODULE_STATUS.md §3](docs/MODULE_STATUS.md).

**Two suites are permanent security tests, not feature tests** — the
notification audience boundary (a real IDOR shipped there) and the client-side
account self-guards. A failure in either after a refactor means the refactor is
wrong. Do not delete, skip, or relax them; see
[MODULE_STATUS.md §4.3](docs/MODULE_STATUS.md).

Client tests are pure logic only (RBAC guards, validation, formatters,
transport) and run in a node environment with no DOM. See
[MODULE_STATUS.md §4.2](docs/MODULE_STATUS.md).

## Seed accounts

| Role | Phone | Password | Lands on |
|---|---|---|---|
| Manager | 9876543210 | `Manager@123` | `/` (Manager portal) |
| Owner | 9876500000 | `Owner@123` | `/` (Manager portal + owner-only screens) |
| Cashier | 9876511111 | `Cashier@123` | `/cashier/pos` (Cashier portal) |

Login accepts **either** phone or email — exactly one of the two. The seeded
emails are `owner@cexpos.local`, `manager@cexpos.local`, `cashier@cexpos.local`.

---

## Working notes

Test barcode: `890100000001` — product lookup, cash register.

Open items carried from earlier sessions:

- Products management page needed a full rebuild — **done** (owner CRUD + 9-step
  wizard; see MODULE_STATUS).
- Users & Roles and My Profile were the last two placeholder screens needing no
  new backend — **done** (see USERS_AND_PROFILE.md).
- Audit Logs needed a new read API over the largest table in the system —
  **done** (see AUDIT_LOGS.md). Additive only: no schema change, and audit
  writing is untouched.
- Customer Profile completed the Customers module — **done** (see
  CUSTOMER_PROFILE.md). Additive only. Note the one thing that looks like a bug
  and is not: the purchase-history tab lists every sale status, so its rows can
  sum to more than the lifetime-spend card, which counts completed sales only.
- Notifications was the last feature build — **done** (see NOTIFICATIONS.md).
  Closed at the feature-complete milestone: the Navbar bell now shows the live
  unread count instead of a static dot, and the dashboard widget reads the real
  API instead of three hardcoded rows, so all three surfaces share one source.
  ⚠ Its `markAsRead` IDOR fix is now guarded by a permanent security suite.
- **Everything above is closed.** New work should be measured against
  [MODULE_STATUS.md §5](docs/MODULE_STATUS.md): core functionality is what a
  store cannot operate without, an enhancement makes what already works better.
  If something genuinely missing from core turns up, it belongs in §1 as a gap
  rather than being folded into the enhancement list.

Before deploying:

- Change the owner / manager / cashier credentials before any real deployment —
  the seeded ones above are public in this repo. The owner can now do this in
  the app: **Settings → Users & Roles** for staff accounts, **My Profile** for
  their own password.
