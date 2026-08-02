# Finance, Cash Register & Reporting

Three modules, one ledger. This document is the reference for how they fit
together, which decisions are deliberate, and what is still outstanding.

---

## 1. The three modules and why they are separate

| Module | Question it answers | Who reaches it |
|---|---|---|
| **Cash Register** | "Is my drawer right?" | Every authenticated role |
| **Finance** | "How is the money?" | OWNER only |
| **Reports** | "How is the business?" | OWNER only (global search: MANAGER+) |

They are separate route trees rather than one "Accounting" module because their
audiences and their failure modes differ. A cashier needs the drawer and nothing
else; an owner needs margins and payroll; a manager needs neither but does need
to look up an invoice. Merging them would force one guard to serve three
different questions.

---

## 2. The central invariants

These are the rules the code is built around. Each is enforced in more than one
place, deliberately.

### 2.1 A cashier cannot sell without an open register

`requireOpenSessionForSale()` in `cashRegister.service.ts` is the single
definition. `sale.service.checkout()` and `exchange.service.processExchange()`
both call it *before* their transactions begin, so a missing session is an
immediate `409 REGISTER_NOT_OPEN` rather than a rollback.

Managers and owners are **not exempt** when they are the one selling — cash they
take lands in a physical drawer like anyone else's. What differs by role is who
may *open* a drawer, not who must have one.

**Escape hatch:** `Settings.storeConfig.enforceRegisterSession = false` disables
it for businesses that do not run tills. It **fails closed** — a missing setting
means enforced, because the alternative is silently losing drawer accountability
after a config wipe.

### 2.2 Expected cash comes from the drawer ledger, never from sales

```
expectedCash = openingCash + Σ(CASH_IN) − Σ(CASH_OUT)
```

A till is affected by things that are not sales (safe drops, payouts, supplier
payments handed over in notes) and unaffected by things that are (a card sale).
Computing expected cash from the sales table would be wrong in both directions
at once — the single most common way a POS reports a phantom shortage.

The `CashTransaction` table is that ledger. `cashRegister.engine.ts` does the
arithmetic; nothing else computes expected cash.

### 2.3 A sale's cash leg commits with the sale

`recordSaleOnDrawer()` is called **inside** the checkout transaction. A sale that
committed without its cash movement would leave the drawer short by exactly that
sale's cash, with no trace of why. Same for exchanges via
`recordExchangeOnDrawer()`.

### 2.4 A discrepancy requires a reason

Any non-zero variance blocks the close until a reason is given. There is **no
tolerance band** — a tolerance means a cashier can be quietly short by a fixed
amount every shift and never be asked. Enforced at three layers:

1. Zod cross-field refine (`expectedCashAtSubmit` vs `countedCash`)
2. Service re-check against the *server's* expected figure (catches a sale that
   landed while the dialog was open)
3. A Postgres `CHECK` constraint, so a direct SQL write cannot bypass it

### 2.5 Financial history is never deleted

There is no delete endpoint for an expense, payment, payslip or register session
— for any role, including OWNER. A wrong expense is **rejected** (leaves the
P&L, record stands) or **corrected** with an offsetting entry. An approved
expense cannot even be edited; the service returns `409 EXPENSE_ALREADY_APPROVED`
and tells the caller to record a correction.

### 2.6 A shift summary is frozen at close

Closing writes the rollups (`cashSales`, `upiSales`, `refundTotal`, …) onto the
session row. They are **snapshots, not views**. If they were recomputed on read,
a late refund posted against a sale from a closed shift would silently rewrite a
reconciliation an owner had already signed off.

### 2.7 Nobody reconciles their own shift

`reconcileRegister()` refuses when `session.openedById === user.id`, even for an
OWNER. The point of a second signature is that it is a second pair of eyes.

---

## 3. Accounting definitions this system commits to

Retail accounting terms are ambiguous, so they are pinned down once in
`finance.engine.ts` and never re-decided per query.

| Term | Definition |
|---|---|
| **Gross Sales** | Σ `grandTotal` of COMPLETED sales — after discount and round-off. It is what the customer actually paid, because that is the only figure reconcilable against the payments table. |
| **Net Sales** | Gross Sales − refunds. Exchanges are **not** netted: an even-value size swap moves goods, not money. |
| **COGS** | Σ (`costAtSale` × quantity). Uses the cost **snapshot** taken at sale time, so a supplier price rise never rewrites last month's margin. |
| **Gross Profit** | Net Sales − COGS |
| **Operating Expenses** | Σ **APPROVED** expenses in the period. Pending expenses are excluded — money that may yet be rejected is not a cost. |
| **Net Profit** | Gross Profit − Operating Expenses |

### What is deliberately NOT subtracted again

- **Salaries** are an `Expense` row (category `SALARY`), created when a salary is
  paid. That is the single place payroll enters the P&L.
- **Supplier payments** settle inventory whose cost is already counted in COGS
  when it sold. They appear in **cash flow**, not in profit.
- **Discounts** are already inside `grandTotal`. Subtracting them again is the
  classic way a retail P&L invents a loss.

### Growth and percentages

- Growth from a zero baseline returns **100**, not a huge number. Reporting
  `+10000%` would make a shop's first sale look like a trend.
- A percentage with a zero denominator returns **0**, never `Infinity`/`NaN`.
- The comparison window is the **same length** immediately before the current
  one — never "the previous calendar month". Comparing a 12-day month-to-date
  against a full 31-day month would report a collapse every month.

---

## 4. Data model

### New tables

| Table | Purpose |
|---|---|
| `cash_drops` | Cash moved to a safe/bank. Reduces the drawer, **not** an expense. |
| `cash_payouts` | An expense paid from the drawer. Also materialises an `Expense` row. |
| `register_activities` | The ordered narrative of one shift, with a running balance. |
| `supplier_payments` | One payment against a supplier, optionally against a specific bill. |
| `salary_payments` | One employee, one pay period. Unique on `(employeeId, year, month)`. |
| `salary_adjustments` | Itemised advance / bonus / overtime / deduction lines. |

### Extended tables

- **`cash_registers`** — `registerNumber`, `sessionNumber`, `countedCash`,
  `discrepancyReason`, `denominations`, frozen rollups, reconciliation fields.
- **`expenses`** — approval workflow, `receiptAssetId`, `registerId`.
- **`purchases`** — `paidAmount`, `dueAmount`, `paymentStatus`, `dueDate`.
- **`expense_categories`** — `code` (machine key), `displayOrder`, `isRecurring`.

### Modelling notes

- **A `CashRegister` row is one SHIFT SESSION, not a till.** That is what lets
  two cashiers work the same counter on consecutive shifts and each be
  accountable only for their own drawer. `registerNumber` names the physical
  counter; the row is the period between one open and one close.
- **`closingBalance` and `countedCash` are separate columns** even though the
  service writes both. They are equal today, but a supervisor override at close
  would make them diverge — and a schema that cannot express that divergence
  cannot audit it.
- **A payout is two rows in one transaction**: the drawer-side `CashPayout` and
  the accounting-side `Expense`. They answer different questions ("why is the
  till short ₹200" vs "what did we spend on packaging") and one row cannot be
  indexed well for both.
- **`SalaryAdjustment.amount` is always positive**; direction lives in `type`.
  A `CHECK` constraint enforces it, so a deduction can never be entered as a
  negative bonus and net out invisibly.

### Migration

`prisma/migrations/20260730120000_finance_register_reporting_module/`

Additive only. Every new column on an existing table is nullable or has a
default that preserves the meaning of pre-existing rows:

- `expenses.approvalStatus` defaults to **APPROVED** — an expense recorded
  before the workflow existed *was* effectively approved on entry. Defaulting to
  PENDING would retroactively remove historical spend from the P&L.
- `purchases.dueAmount` is backfilled from `totalAmount`, so existing bills
  appear as genuinely outstanding payables rather than silently settled.

**To apply:** `node prisma/apply-migration.cjs 20260730120000_finance_register_reporting_module`
(the documented workflow for this repo — `prisma migrate dev` cannot run here
because the historical `_perf` migration fails shadow-DB replay).

---

## 5. API surface

### `/api/v1/register` — operational, every authenticated role

Authorization is deliberately **not** expressed as route guards for most of this
tree. Which *sessions* an actor may touch is a per-row question (is this my
drawer?), which a route guard cannot express. `assertCanViewSession()` and
`assertCanOperateSession()` handle it per request.

| Method | Path | Notes |
|---|---|---|
| GET | `/live` | The cashier's shift dashboard |
| GET | `/registers` | Distinct till identifiers |
| POST | `/open` | |
| GET | `/:id/close-preview` | Uncached — the figure signed off against |
| POST | `/:id/close` | |
| POST | `/:id/reconcile` | **MANAGER+**, and never your own shift |
| POST | `/:id/drops` | |
| POST | `/:id/payouts` | Creates a linked Expense |
| POST | `/:id/adjustments` | **MANAGER+** — a cashier who can add cash to their own expected balance can cover any shortage |
| POST | `/:id/notes` | |
| GET | `/history`, `/drops`, `/payouts` | Scoped to the caller by the service |
| GET | `/:id/summary`, `/:id/activity` | |
| GET | `/:id/summary/export`, `/history/export`, `/drops/export`, `/payouts/export` | |

### `/api/v1/finance` — OWNER only, guarded at the router

| Group | Paths |
|---|---|
| Analytics | `/dashboard`, `/revenue`, `/profit-loss`, `/cash-flow`, `/payment-analytics` |
| Expenses | `/expenses` (GET/POST), `/expenses/:id` (GET/PATCH), `/expenses/:id/review`, `/expense-categories` |
| Payables | `/payables`, `/payables/:id/due-date`, `/supplier-payments`, `/suppliers`, `/suppliers/:id/open-bills` |
| Payroll | `/payroll/generate`, `/salaries`, `/salaries/:id`, `/salaries/:id/adjustments`, `/salaries/:id/pay` |
| Export | `/export/:report` — 7 reports × 3 formats |

A MANAGER gets a **403**, not a narrowed result set. Partial visibility into
payroll is worse than none: it invites inferring colleagues' salaries from a
total.

### `/api/v1/reports` — OWNER only, except search

| Path | Access |
|---|---|
| `/search`, `/filter-options` | **MANAGER+** — invoice and customer lookup is daily operational work |
| `/dashboard` + 11 reports | OWNER |
| `/export/:report` | OWNER — audited as `REPORT_EXPORTED` |

Reports: `sales`, `products`, `categories`, `brands`, `customers`, `employees`,
`inventory`, `purchases`, `payments`, `returns`, `profit`.

**Every report accepts the same filter set** (date range/period, employee,
customer, supplier, brand, category, product, SKU, invoice number, payment
method). That is enforced by construction: `reports.validation.ts` declares the
filter block once and every report spreads it, so a report cannot forget one.

---

## 6. Architecture

```
Route → Validation (Zod) → Controller → Service → Engine (pure) → Repository → Prisma
```

| Layer | Files | Rule |
|---|---|---|
| **Engines** | `cashRegister.engine.ts`, `finance.engine.ts` | **Zero DB access.** All money maths, provably testable without Postgres. |
| **Repositories** | `cashRegister.repository.ts`, `finance.repository.ts`, `reports.repository.ts` | Prisma only. No business rules. |
| **Services** | `cashRegister.service.ts`, `finance.service.ts`, `reports.service.ts` | Authorization, transactions, audit, DTO shaping. |
| **Controllers** | Thin HTTP adapters. No logic, no authz decisions. |
| **Exports** | `*Export.service.ts` | Reuse the *service* functions the screens call, so an export can never disagree with the screen it came from. |

### Raw SQL policy

`reports.repository.ts` is mostly raw SQL because a report is a grouped
aggregate over a join, and Prisma cannot express `SUM(a * b)`, `FILTER (WHERE …)`
or window functions. Three rules apply to every query there:

1. **Table names are the `@@map`'d lowercase ones** (`"sale_items"`, not
   `"SaleItem"`). Prisma's `@@map` means the model name does not exist in
   Postgres and fails at runtime, never at compile time.
2. **Every value is a `${}` tagged-template parameter.** The only interpolated
   identifiers are `date_trunc` units and ORDER BY directions, both from closed
   whitelists.
3. **Product-dimension filters are `EXISTS` subqueries, not joins.** Joining
   line items to bills multiplies `grandTotal` by the line count — the classic
   fan-out bug in retail reporting.

### Money handling

`Prisma.Decimal` throughout the server. Currency in IEEE-754 doubles accumulates
error that surfaces as a one-paisa drawer discrepancy nobody can explain.
Decimal → number conversion happens **only** at the DTO boundary, so the client
never parses a currency string.

---

## 7. Frontend

### Shared BI kit — `components/shared/bi/`

All three features import from here, never from individual files. That is what
makes them look like one product.

| File | Provides |
|---|---|
| `format.ts` | Currency/number/date formatting, status label + colour maps |
| `KpiCard.tsx` | Animated KPI cards, trend indicators, stat rows |
| `Charts.tsx` | Area, line, bar, pie/donut, heat map, sparkline + the palette |
| `FilterBar.tsx` | The shared filter bar, active-filter chips, debounced search |
| `ExportMenu.tsx` | Print / CSV / Excel / PDF |
| `ReportTable.tsx` | Sticky header, column visibility, resizable columns, server-side sort/paging |
| `PageHeader.tsx` | Page/section headers, metric panels |

**Chart palette**: the same validated, colour-blind-safe tokens the workforce and
inventory modules already use, so a blue series means the same thing everywhere
and there is one palette to re-validate.

**Accessibility**: the animated counter respects `prefers-reduced-motion`; wide
tables scroll inside their own container so the page body never scrolls
sideways; every chart has an explicit empty state (a blank plot area is
indistinguishable from a broken query).

### Routes

| Path | Portal | Access |
|---|---|---|
| `/register`, `/register/history`, `/register/movements`, `/register/sessions/:id` | Manager shell | MANAGER + OWNER |
| `/cashier/register`, `/cashier/register/history`, `/cashier/register/sessions/:id` | Cashier shell | CASHIER |
| `/admin/finance/*` (8 screens) | Manager shell | OWNER (`OwnerRoute`) |
| `/admin/reports/*` (12 screens) | Manager shell | OWNER (`OwnerRoute`) |

`/finance/register` redirects to `/register` — the old owner-only path, kept so
existing bookmarks do not 404.

### React Query posture

- **Live register**: 20s `refetchInterval` + refetch on focus. The expected
  balance is what a cashier counts against; stale is not cosmetic here.
- **Close preview**: `staleTime: 0`, `gcTime: 0`. Better right than fast.
- **Analytics** (dashboard, P&L, cash flow, reports): 60s. Expensive
  multi-aggregate queries whose inputs do not change second to second.
- **Filter options**: 10min, shared by query key across all twelve reports.
- **Mutations invalidate broadly**, and finance mutations also invalidate the
  `register` key — the two modules share one ledger.

---

## 8. Security

| Control | Where |
|---|---|
| Route guards | `requireRole` at the router level for `/finance` and `/reports` |
| Per-row authorization | `assertCanViewSession` / `assertCanOperateSession` |
| Self-approval blocked | Expense review, shift reconciliation |
| Audit logging | Every financial mutation → `AuditLog` (fire-and-forget, never blocks) |
| Input validation | Zod at every boundary; `.multipleOf(0.01)` on money |
| SQL injection | Tagged-template parameters; whitelisted sort keys |
| CSV injection | `csvCell()` prefixes `=+-@` with an apostrophe |
| Export caps | 5,000 rows, surfaced in the subtitle so truncation is never silent |
| No deletion | No delete endpoint exists for any financial record |

### Audit actions added

`REGISTER_OPENED`, `REGISTER_CLOSED`, `REGISTER_RECONCILED`,
`CASH_DROP_RECORDED`, `CASH_PAYOUT_RECORDED`, `EXPENSE_APPROVED`,
`EXPENSE_REJECTED`, `SUPPLIER_PAYMENT_RECORDED`, `SALARY_PAID`,
`SALARY_ADJUSTED`, `REPORT_EXPORTED`.

---

## 9. Tests

`src/engines/__tests__/cashRegister.engine.test.ts` and `finance.engine.test.ts`
— 60+ pure unit tests, no database. Run with `npm run test:unit`.

They cover the cases where a plausible-looking implementation would be wrong in
a way nobody notices until the numbers are on a screen: zero-baseline growth,
zero-denominator percentages, comparison-window length, denomination typos,
float drift, OVERDUE beating PARTIALLY_PAID, series gap-filling.

> The previous `finance.service.test.ts` was removed. It called `cleanDatabase()`
> against the live Neon database, and it tested a service surface this work
> replaced. The engine tests cover the same arithmetic without that hazard.

---

## 10. Outstanding — what is NOT done

Stated plainly rather than left to be discovered:

1. **The migration has not been applied.** The schema is valid and the Prisma
   client is generated, but `20260730120000_finance_register_reporting_module`
   has not been run against the database. Until it is, the new endpoints will
   fail at runtime. Apply with the `apply-migration.cjs` command in §4.

2. **No end-to-end verification against real data.** Everything typechecks, the
   client builds, and the engine tests pass — but no request has been made
   against a live database with the migration applied. The raw SQL in
   `reports.repository.ts` in particular has been reviewed for fan-out and
   naming correctness but not executed.

3. **Receipt upload for payouts/expenses is a field, not a flow.**
   `receiptAssetId` is stored and returned, and the Asset engine already exists,
   but no upload control is wired into the payout or expense dialogs.

4. **Heat map is built but unused.** `BiHeatMap` is in the kit and works; no
   report currently renders one. The natural use is hour-of-day × day-of-week
   sales density, which needs a new repository query.

5. **Payout approval thresholds are not configurable.** `CashPayout` carries the
   full approval workflow in the schema, but the service auto-approves at
   creation (documented reasoning: the cash has already left the till). Wiring a
   configurable threshold is a service change, not a schema one.

6. **Global search is not in the navbar.** `GlobalSearchBar` is exported and
   used on the Reports dashboard; mounting it in `Navbar.tsx` would make it
   reachable from every screen.
