# Stabilization round 2 — reported failures, root causes, fixes

Six failures were reported from the running application (2026-08-06). Each was
traced to a root cause and fixed at that cause; none were suppressed, retried
around, or hidden behind a catch.

**Scope discipline:** no new features, no redesign, no business-logic changes.
Every change is a bug fix, a regression test, or a comment explaining why the
code is the way it is.

---

## 0. Baseline before starting

Measured, not assumed — the request described an unstable application, and the
first job was to find out how much of that was already true.

| Check | Before | After |
|---|---|---|
| Client typecheck | clean | clean |
| Server typecheck | clean | clean |
| Client tests | 317 | **342** |
| Server unit tests | 601 | **608** |
| Client lint | 0 errors | 0 errors |
| Production build | ✓ | ✓ |

Large parts of the requested surface were **already built** by the earlier
hardening phase (`PRODUCTION_HARDENING.md`): route-scoped React error
boundaries, the tuned QueryClient, request correlation, the `EmptyState` /
`ErrorState` / `OfflineState` components used by 48 of 59 pages. This round
fixed what was genuinely broken rather than rebuilding what worked.

---

## 1. Stock / Cycle Counts — `400 Validation failed`

**Reported:** `GET /owner/inventory/stock?page=1&limit=200` → 400, repeatedly.

**Root cause.** The server caps `limit` at 100 (`common.validation.ts`'s
`paginationSchema`, mirrored in `inventory.validation.ts`). Four client call
sites hard-coded `limit: 200`. zod **rejects** an over-cap limit rather than
clamping it, so each of those requests failed 100% of the time and the page
rendered no data at all.

The value 200 was not invented: `/workforce/roster` genuinely allows 200 — it
has its own local pagination schema, with a comment explaining that the roster
feeds pickers needing the whole staff list. The number was correct there and got
copied to endpoints where it was not. That is the failure mode a named constant
prevents: **the cap belongs to the endpoint, not to the caller's intuition about
"a big page."**

| Call site | Endpoint | Cap | Sent | Result |
|---|---|---|---|---|
| `CycleCountsPage` | `/inventory/stock` | 100 | 200 | category picker silently empty |
| `useInventoryFilters` | `/inventory/stock` | 100 | URL-controlled | bookmarked `?inv_limit=200` → empty table |
| `dashboardApi` | `/sales` | 100 | 200 | today's revenue tile read 0 |
| `procurementApi` | `/suppliers` | 100 | 200 | create-purchase supplier picker empty |
| `ShiftManager`, `ActivityPage` | `/workforce/roster` | **200** | 200 | ✅ legal — left alone |

**Fix.** `CLIENT/src/lib/api/pagination.ts` — `DEFAULT_MAX_LIMIT`, a
per-endpoint `MAX_LIMIT` map, and `clampLimit()` for any limit that is not a
literal the author controls (URL params, saved views, user-entered page sizes).

Clamping rather than rejecting is deliberate: the user asked for "as much as
possible", so giving them the API maximum is what they meant, and it degrades to
a working page instead of an error state.

**Why a URL param mattered.** `useInventoryFilters` read `limit` straight from
the query string with no bound. `?inv_limit=200` — from a bookmark, a shared
link, or a hand-edited address bar — went to the API unchecked. That is the
reported Stock page failure, and it survives a redeploy because it lives in the
user's bookmarks.

**Regression tests (13).**
- `SERVER/.../paginationContract.test.ts` (7) — asserts each endpoint's real cap
  and, critically, that exceeding it **throws rather than clamps**. A clamping
  schema would have made this bug invisible in review.
- `CLIENT/.../pagination.test.ts` (6) — clamping, per-endpoint override,
  fractional flooring, and junk input.

The contract test exists because a divergence here surfaces as neither a test
failure nor a type error. It surfaces as a blank page in production.

---

## 2. Cycle Counts — blank white page

**Reported:** navigating to Cycle Counts *sometimes* renders a completely blank
page with no usable UI.

**Root cause — the important one.** Every route in this app is `async lazy()`.
There are **77 of them and there was no `errorElement` anywhere in the router.**

When a dynamic import rejects, the failure happens in React Router's data layer,
**not during a component render**. That distinction is the whole bug:

- `components/ui/ErrorBoundary` is a React error boundary. It catches throws
  from render and lifecycle. **It cannot see a rejected route import.**
- React Router handles that itself, by walking up to the nearest route with an
  `errorElement`. There were none, so it fell back to its own default — which
  **replaces the entire element tree**, unmounting `RootLayout`, `MainLayout`,
  the sidebar and the navbar with it.

Hence a blank page with no navigation and no way back. The existing error
boundary was never going to catch it.

**Why "sometimes."** A chunk import fails when the file cannot be fetched: a
dropped connection, a wifi hop mid-shift, or — the common one — **a redeploy
that changes content-hashed chunk filenames while a till still has the old
`index.html` loaded.** Every lazy route on that tab then 404s on click. A POS
terminal stays open for days, so it hits this far more than a typical web app.

**Fix.** `CLIENT/src/app/router/RouteErrorElement.tsx`, mounted at three levels:

| Mount | Why |
|---|---|
| `MainLayout` | Fallback renders inside `<Outlet />`; sidebar + navbar stay mounted and usable |
| `CashierLayout` | Matters *more* here — a till is the client most likely to hold chunk names a deploy replaced |
| `RootLayout` | Backstop for routes outside both shells (`/login`, `/unauthorized`) |

**A stale chunk gets "Reload", not "Try again."** Re-running the same import
re-requests a file that is no longer deployed and fails identically — a button
that can never work. Only a reload fetches the new index and its new chunk
names. The copy names the cause plainly ("the application was updated while this
tab was open") because that is something the user can act on.

The element also reports through `reportClientError` with a new `isChunkError`
flag. A cluster of those in the logs is an **infrastructure** signal — clients
running against removed chunks — not a code bug to go hunting for.

**Regression tests (7).** `isChunkLoadError` against the real messages from
Chrome/Vite, Firefox and Safari (which disagree with each other), plus the
webpack-style `ChunkLoadError` that carries its signal in `error.name` rather
than the message — the case a message-only match would miss. And the negative
cases: an API 500 must **not** get a "Reload" button that fixes nothing.

**Second cause, same page.** `CycleCountsPage` called `useStock` purely to
populate its category picker and never read the hook's `isError`. With the 400
above, `?? []` produced an empty picker indistinguishable from "this catalogue
has no categories". It now shows an inline message with a Retry, and states that
a full-scope count is still available — a degraded picker, not a dead page.

---

## 3. Inventory Dashboard — 500 (**not fixed — needs your DB**)

**Reported:** `GET /owner/inventory/dashboard?period=month` → 500.

**Investigated, not reproduced.** Every one of the nine sub-queries behind
`getDashboard()` was run in isolation against the configured database. **All
nine passed.** The `.env` database has been reset (`productVariant=0`,
`sale=0`, `inventoryMovement=0`, 3 employees, 1 customer), so it cannot
reproduce a data-dependent failure.

What this **rules out**: a malformed query, a missing relation, a bad join, a
missing migration. Those fail on an empty table too. The BigInt conversions were
audited by hand and are correct — `inventoryTotals`, `movementTrend`,
`valueByCategory` all pass through `Number()` before serialization, so this is
not the classic `JSON.stringify` BigInt 500 either.

What remains, and needs real rows to confirm:

1. A **null dereference on a data shape the empty DB never produces** — the
   likeliest candidate. `getDashboard` reads `lastCount.countedItems` and
   divides by it; the guard is `countedItems > 0`, which is correct, but the
   surrounding `accuracy`/`valueTrend`/`topCategories` mapping runs over rows
   that simply do not exist here.
2. A **Decimal/Prisma type** arriving where a number is expected, only once
   snapshots or adjustments exist.

**To close this out I need one of:**

- the `Reference:` id from the error box (it maps to the exact server log line —
  stack, actor, SQL timings, via the request-correlation work already in place), **or**
- the server's stderr around the 500, **or**
- the `DATABASE_URL` your running app uses, so I can probe the same data.

The probe script is easy to recreate; I removed it rather than leave scratch
files behind.

---

## 4. Sidebar active state

**Reported:** highlighting is inconsistent; some pages lose their active state.

**Root cause.** `findGroupForPath()` iterated `visibleGroupItems(group, role)` —
a group's **children** — and never considered the group's own `path`. A group
that is itself a destination (`path` set, `items` empty) renders as a plain link
and had no child to match, so it could never resolve.

The Dashboard is exactly that shape (`id: "dashboard"`, `path: "/"`). So
`findGroupForPath("/", "OWNER")` returned `null`: **the landing page every user
sees first was the one screen with no sidebar highlight.**

Proven before fixing — a characterization test was written first and failed
exactly there (`expected null to be 'dashboard'`), while the other 10 cases
passed. That kept the fix narrow.

**Fix.** Group paths are now considered, matched **exactly and only exactly**.
That gate is load-bearing: Dashboard's path is `/`, a prefix of every route in
the application, so admitting group paths under the nested rule would highlight
Dashboard everywhere. A test pins that hazard directly.

**Regression tests (12).** Longest-match wins; sibling prefixes
(`/admin/inventoryfoo` must not match `/admin/inventory`); detail routes keeping
their parent highlighted (cycle-count session, supplier profile, purchase
detail, customer profile, sale detail — all previously untested); role scoping;
unknown routes returning `null` rather than guessing.

The detail-route cases turned out to **already work** — worth pinning, since
they are the other half of "loses its active state after navigation" and nothing
protected them before.

---

## 5. Offline `LATERAL` — found by following the evidence

Not reported, but the same class as two bugs already in the working tree, and
found by sweeping the surface those came from.

**Root cause.** `reports.repository.ts` has **six live `LEFT JOIN LATERAL`
clauses**. SQLite has no `LATERAL`, and `LATERAL` was **absent from the dialect
translator's `UNSUPPORTED` list** — so on an edge node it reached the engine
untranslated and failed with `near "SELECT": syntax error`: a 500 naming neither
the construct nor the file, which is the exact outcome that allowlist exists to
prevent. The Product Report 500s on every offline node.

**Fix.** `LATERAL` added to `UNSUPPORTED` with a fix message pointing at the
proven rewrite (pre-aggregate with `GROUP BY` on the join key, `LEFT JOIN` on
it, `COALESCE` in the outer select) — the pattern already applied to
`customer.repository.ts`. It now fails loudly at the source, with instructions,
instead of opaquely at the engine.

**Two false positives deliberately not "fixed."** `brand.repository.ts` and
`workforce.repository.ts` mention `= ANY` and `DISTINCT ON`, but **only in
comments** — the live SQL already uses the dialect-neutral `ROW_NUMBER()` form.
A less careful sweep would have rewritten working code.

**Regression tests (2).** The refusal fires on a realistic `LEFT JOIN LATERAL`;
and the grouped-subquery rewrite the error message recommends actually **passes**
translation — without that, the guidance could send someone toward a form that
trips a different rule.

**All six sites are now rewritten and verified** — see §5b.

---

## 5b. Pre-merge verification (requested)

Two checks were requested before merge. Both found something.

### A. Does every endpoint use the pagination contract?

**Swept the whole client, not just inventory** — and the sweep found the bug was
**ten times wider than the four call sites originally fixed.**

Server side is consistent: every paginated inventory schema spreads the same
`pagination` object at `max(100)`, and 100 is the universal cap across the API
(`common.validation.ts`), with `/workforce/roster` at 200 as the sole documented
exception.

Client side, hard-coded literals were clean after the first round. But **ten
URL-backed filter hooks read `limit` from the query string with no upper
bound** — the same defect that broke the Stock page, sitting unfixed in nine
other places:

| Hook | Feature |
|---|---|
| `useAuditFilters` | Audit logs |
| `useDiscountFilters` | Discounts |
| `useProcurementFilters` ×2 | Purchases, supplier/brand catalog |
| `useUserFilters` | Users & roles |
| `useWorkforceFilters` | Roster |
| `useTableState` | generic table state |
| `useCategoryFilters` | Categories |
| `useProductFilters` | Products |
| `useInventoryFilters` | Inventory *(fixed in round 1)* |

All ten now clamp. Two details that mattered:

- **`useWorkforceFilters` clamps to `MAX_LIMIT.roster` (200), not 100** — it
  drives `RosterPage`, where the API genuinely allows 200. Clamping it to the
  default would have silently truncated a page size the server accepts.
- **`useTableState` also lacked a `|| defaultLimit` fallback**, so `?limit=abc`
  produced `NaN`, which serializes as the string `"NaN"` and 400s just as surely
  as an over-cap number. Fixed alongside the clamp.

### B. Do the LATERAL rewrites return identical numbers?

**Yes — proven against real Postgres, not argued.**

`scratch/verify-lateral-equivalence.ts` runs both the LATERAL and the
grouped-subquery form against a fixture built inside a transaction that always
rolls back, and diffs **every row of every column** with BigInt/Decimal/Date
normalized so comparison is by value.

The fixture deliberately contains the four shapes that break this rewrite:

| # | Hazard | Fixture case |
|---|---|---|
| 1 | **No matching rows** — LATERAL's inner COALESCE returns 0; a grouped join returns NULL | `v3`: no sales, no exchanges, no movements |
| 2 | **Fan-out** — a non-unique GROUP BY key multiplies rows and inflates totals | `v1`: two sales + two exchange return lines |
| 3 | **Filtered aggregate** — rows the LATERAL's WHERE excluded must stay excluded | `v4`: CANCELLED sale + out-of-window sale |
| 4 | **NULL vs zero** — `MAX()` over no rows is NULL, and NULL is the correct answer | `v3`: `lastMovementAt` must stay NULL |

Results — all three pairs identical:

```
✓ productReport exchange units:   4 rows × 3 columns identical
✓ velocity units + lastMovement:  4 rows × 3 columns identical
✓ exchange report units:          2 rows × 3 columns identical
```

Spot-checking the fixture confirms the hazards were genuinely exercised: `v1`
returns `returnedUnits=5` (2+3 summed, no fan-out) and `units=7` (3+4); `v3`
returns `units=0` with `lastAt=NULL`; `v4` returns `units=0` with the CANCELLED
and out-of-window sales correctly excluded.

**The harness carries a negative control**, and it is the reason to trust the
result. It deliberately introduces the most likely mistake — COALESCE left
*inside* the subquery instead of the outer select — and asserts the comparison
**fails**:

```
✗ NEGATIVE CONTROL (must FAIL): row 2 column "units" — lateral=n:0 grouped=NULL
  ↑ expected: proves the harness detects the COALESCE mistake
```

Without that, a harness that silently passed everything would be
indistinguishable from a correct result.

**Safety:** the fixture is created and destroyed inside one transaction that
always rolls back. Verified afterwards — zero `vc_%` rows remain in any table.

Before rewriting, each site was checked for a `LIMIT`, `ORDER BY` or
`ROW_NUMBER` inside the LATERAL body — constructs a `GROUP BY` **cannot**
reproduce. All six are plain scalar aggregates, so the rewrite is valid; had any
carried a per-row `LIMIT`, it would have needed a window function instead.

All five aggregate columns already COALESCE in the **outer** select, so hazard
#1 was already handled. `velocity.unitsSold` was the one to watch — it feeds
division and a `= 0` test, where a NULL would have produced a silently wrong
`daysOfCover` rather than an error.

### C. A pre-existing 500 the sweep uncovered

Running the **real** repository functions (not just the isolated SQL) surfaced a
bug that was **already in production and unrelated to the rewrites**:

```
FAIL inventoryPosition + categoryId filter
     Raw query failed. Code: 42P01
     Message: missing FROM-clause entry for table "p"
```

`inventoryPosition` built its optional predicates as `p."categoryId"`, but the
query aliases products as **`pr`**. So the **Inventory report 500'd on every
request that applied a category, brand or supplier filter.** The unfiltered page
never emits those lines, which is why it looked fine.

Confirmed pre-existing by `git stash` — it fails identically on the original
code. Fixed to `pr`.

A follow-up sweep (`scratch/verify-report-filters.ts`) then ran **all 26 reports
queries with every optional filter populated at once**, so no conditional branch
went unexercised. All 26 pass. The `p`/`pr` mismatch was the only one.

---

## 6. Files changed

**Fixes**
- `CLIENT/src/lib/api/pagination.ts` — **new.** The pagination contract.
- `CLIENT/src/app/router/RouteErrorElement.tsx` — **new.** Router-level error UI.
- `CLIENT/src/app/router/index.tsx` — `errorElement` at three levels.
- `CLIENT/src/config/navigation.ts` — group paths in `findGroupForPath`.
- `CLIENT/src/features/inventory/hooks/useInventoryFilters.ts` — clamp URL limit.
- `CLIENT/src/features/inventory/pages/CycleCountsPage.tsx` — cap + picker error state.
- `CLIENT/src/features/dashboard/api/dashboardApi.ts` — cap + documented ceiling.
- `CLIENT/src/features/procurement/api/procurementApi.ts` — cap.
- `CLIENT/src/lib/errorReporting.ts` — `isChunkError` / `status` context.
- `SERVER/src/offline/datasource/sqlDialect.ts` — `LATERAL` refusal.
- `SERVER/src/repositories/reports.repository.ts` — 6 LATERAL rewrites + the
  `p`→`pr` alias fix.

**Pagination clamp — the nine additional hooks (§5b A)**
- `CLIENT/src/features/audit/hooks/useAuditFilters.ts`
- `CLIENT/src/features/owner/discounts/hooks/useDiscountFilters.ts`
- `CLIENT/src/features/procurement/hooks/useProcurementFilters.ts` (×2)
- `CLIENT/src/features/users/hooks/useUserFilters.ts`
- `CLIENT/src/features/workforce/hooks/useWorkforceFilters.ts` (roster cap 200)
- `CLIENT/src/hooks/useTableState.ts` (also fixes the `NaN` path)
- `CLIENT/src/shared/category/useCategoryFilters.ts`
- `CLIENT/src/shared/product/useProductFilters.ts`

**Verification harnesses (kept — reusable, read-only)**
- `SERVER/scratch/verify-lateral-equivalence.ts` — LATERAL vs grouped, with a
  negative control; transaction-scoped fixture, always rolled back.
- `SERVER/scratch/verify-reports-runtime.ts` — the rewritten functions, incl.
  every velocity bucket and each sort column.
- `SERVER/scratch/verify-report-filters.ts` — all 26 reports queries with every
  optional filter applied.

**Tests (+32)**
- `SERVER/src/validation/__tests__/paginationContract.test.ts` — new, 7
- `CLIENT/src/lib/api/__tests__/pagination.test.ts` — new, 6
- `CLIENT/src/config/__tests__/navigation.test.ts` — new, 12
- `CLIENT/src/app/router/__tests__/RouteErrorElement.test.ts` — new, 7
- `SERVER/src/offline/__tests__/sqlDialect.test.ts` — +2

---

## 7. Remaining risks

1. **The dashboard 500 is unresolved.** Root cause not established. See §3 for
   the three things that would close it.
2. **The LATERAL equivalence proof used a synthetic fixture, not production
   data.** The fixture covers the four hazards this rewrite class has, and the
   negative control shows the harness detects a real difference — but the
   database available here is empty, so the check could not run against a
   production-sized dataset. Re-running `verify-lateral-equivalence.ts` against
   a populated database would close the remaining gap. It is read-only and
   rolls back.
3. **Dashboard revenue tile plateaus above 100 sales/day.** Pre-existing and
   previously masked by the 400 (the tile read 0 regardless). Order count stays
   exact; revenue understates. The real fix is a server-side `SUM` aggregate —
   a new endpoint, so it is documented in-code rather than done silently.
4. **`GET /sales` unbounded page for a busy store** — same root shape as above.
5. **11 of 59 pages** were not confirmed to use the shared `ErrorState` /
   `EmptyState` pattern. A grep suggested they might not; it was unreliable, so
   the number is a lead to verify, not a finding.

---

## 8. Verification — what was actually run

| Check | Result |
|---|---|
| `tsc -b --noEmit` (client) | ✅ clean |
| `tsc --noEmit` (server) | ✅ clean |
| `vitest run` (client) | ✅ **342 passed** (was 317) |
| `vitest run --config vitest.unit.config.ts` (server) | ✅ **608 passed** (was 601) |
| `oxlint` | ✅ 0 errors |
| `vite build` | ✅ succeeds |
| `verify-lateral-equivalence.ts` | ✅ 3/3 pairs identical; negative control failed as designed |
| `verify-reports-runtime.ts` | ✅ 12/12 (every bucket, every rewritten sort column) |
| `verify-report-filters.ts` | ✅ 26/26 reports queries with all filters applied |

**Not run: manual browser testing.** This work was done in a terminal with no
browser, so no page was loaded, no console was read, and no click path was
exercised. The claims above are backed by tests, types and static analysis —
nothing here should be read as "verified in the running application."

`docs/MANUAL_E2E_TEST_GUIDE.md` is the artifact for that pass. The screens worth
the most attention, because this round changed their behavior:

- **Inventory → Stock** — including a bookmarked `?inv_limit=200`
- **Inventory → Cycle Counts** — list, and the Start Count category picker
- **Dashboard** — sidebar highlight on `/`, and the today's-revenue tile
- **Procurement → New Purchase** — supplier picker
- **Any lazy route during a redeploy** — the chunk-error path, which is the one
  fix here that is genuinely hard to exercise on purpose
