# Pos-Inventory_Management

A retail POS and inventory system. React 19 + Vite + TanStack Query on the
client; Express 5 + Prisma 7 + PostgreSQL (Neon) on the server.

## Documentation

| Doc | What it covers |
|---|---|
| [docs/MODULE_STATUS.md](docs/MODULE_STATUS.md) | **Start here.** What is built, what is still a placeholder, known technical debt, test coverage. |
| [docs/PROCUREMENT.md](docs/PROCUREMENT.md) | Purchases (incl. partial goods receipt), Suppliers, Brands — API, schema, invariants. |
| [docs/FINANCE_REGISTER_REPORTING.md](docs/FINANCE_REGISTER_REPORTING.md) | Cash Register, Finance and Reports — the drawer ledger and accounting definitions. |
| [docs/USERS_AND_PROFILE.md](docs/USERS_AND_PROFILE.md) | Users & Roles and My Profile — account administration, the RBAC/privilege-escalation rules, and why role changes route through the workforce tree. |

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
cd SERVER && npm run test:unit   # 305 pure unit tests, no database
cd SERVER && npx vitest run      # adds the integration suites (see caveat below)
cd CLIENT && npm test            # 111 pure unit tests
```

Database access is opt-in per test file. Integration suites that truncate tables
**skip** unless `DATABASE_URL` names a database containing `test` — the guard in
`src/__tests__/utils/db.ts` refuses to wipe the live database. See
[MODULE_STATUS.md §3](docs/MODULE_STATUS.md).

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
- Change the owner / manager / cashier credentials before any real deployment —
  the seeded ones above are public in this repo. The owner can now do this in
  the app: **Settings → Users & Roles** for staff accounts, **My Profile** for
  their own password.
