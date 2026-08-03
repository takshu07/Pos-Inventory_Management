# Audit Logs

The system's record of who did what: every create, update and delete across
every module, plus logins, cash movements, role changes, and exports.

Route `/admin/audit-logs`. **OWNER only. Read-only.**

Built 2026-08-03. Adds a **new read API** over the existing `audit_logs` table.
**No schema change, no migration, and no change to how audit events are
written** — every existing writer still calls `auditRepository.create`
unmodified.

---

## 1. What this module is, and is not

| | |
|---|---|
| Route | `/admin/audit-logs` |
| Access | OWNER only (`OwnerRoute` + `requireRole("OWNER")` on the whole tree) |
| Feature dir | `CLIENT/src/features/audit` (own lazy chunk, ~26 kB) |
| API tree | `/api/v1/owner/audit-logs` |
| Writes | **None.** There is no POST/PATCH/DELETE and there must never be. |

**It is read-only by construction, not by convention.** Audit entries are
written by the module that performed the action. An audit trail the application
can rewrite through its own API is not evidence of anything, so the route tree
registers no mutating handler at all — the guarantee is structural.

### 1.1 Why OWNER and not MANAGER

The trail spans finance, salary, cash handling, and role and password changes,
and it records the manager's own actions. MANAGER is an **operational** role in
this system (see the RBAC model); reading the audit trail is business
administration. There is deliberately no manager counterpart tree.

---

## 2. The data it reads

`audit_logs` is written by every module and is **the largest table in the
system**. Its shape is unchanged by this milestone:

```
id  employeeId  action  module  tableName  recordId  oldData  newData  createdAt
```

Existing indexes, all of which this module's filters target:

```
@@index([employeeId])   @@index([module])
@@index([tableName, recordId])   @@index([createdAt])
```

### 2.1 ⚠ Two things the table does NOT store

This is the single most important thing to understand before changing this
module. The spec asked for **severity filtering** and **IP/device information**.
Neither is a column on `audit_logs`.

| Asked for | Where it actually comes from |
|---|---|
| `severity` | **Derived** from `action` by `engines/audit.engine.ts`. Not stored. |
| IP / device | **Correlated** from `login_history`, tagged `source: "SESSION"`. Not stored on the entry. |

Both were solved without a schema change, deliberately — see §3 and §5.

---

## 3. Severity is derived, not stored

`SEVERITY_BY_ACTION` in `engines/audit.engine.ts` maps each `ActionType` to
`CRITICAL | HIGH | MEDIUM | LOW`.

| Level | Means | Examples |
|---|---|---|
| CRITICAL | Irreversible, or moves money/access/data out | `DELETE`, `ROLE_CHANGED`, `PASSWORD_RESET`, `CASH_PAYOUT_RECORDED`, `SALARY_PAID`, `REPORT_EXPORTED` |
| HIGH | Real business state money or stock depends on | `INVENTORY_ADJUST`, `PURCHASE_RECEIVE`, `REGISTER_CLOSED`, `EXPENSE_APPROVED`, `EMPLOYEE_DEACTIVATED` |
| MEDIUM | Ordinary business traffic (the bulk of the table) | `CREATE`, `UPDATE`, `SALE_COMPLETE` |
| LOW | Routine, high-volume | `LOGIN`, `LOGOUT`, `CLOCK_IN`, label previews and prints |

### 3.1 Why derived rather than a column

1. **Audit writes stay untouched.** A column would mean either changing every
   writer (risky on the one table that must never lose rows) or shipping a
   column that is `NULL` on every existing row — a severity filter matching
   nothing.
2. **Severity is a policy, not a fact.** Reclassifying an action is one edit
   here, applied retroactively to all history. A stored column would need a
   backfill and would leave old rows stale.
3. **An unclassified action stays visible.** The fallback is `MEDIUM`, never
   `LOW`, so a newly-added action type surfaces in the default view instead of
   hiding at the bottom.

### 3.2 ⚠ How it stays fast: `severityToActions`

**This is the hinge of the whole design.** Filtering by a derived value normally
forces a sequential scan. Instead, `audit.service.ts` **inverts the map at
query-build time**, so a severity filter reaches Postgres as an ordinary
indexed enum predicate:

```
?severity=CRITICAL
  →  where action IN ('DELETE','ROLE_CHANGED','PASSWORD_RESET', …)
```

Severity **never reaches SQL as a computed expression.** A `CASE` over every
action would sequentially scan the largest table in the system. This is asserted
by `audit.service.test.ts` — if you are reading this because that test failed
after a refactor, the test is right.

Two consequences worth knowing:

- **Selecting all four severities applies NO predicate.** An `IN` listing all
  41 actions is strictly worse than no filter.
- **Severity ∩ action intersects, and an empty intersection returns nothing.**
  `severity=LOW&action=DELETE` describes no possible row. Treating the empty
  intersection as "no filter" would silently **widen** an audit query — the most
  dangerous direction to be wrong in.

### 3.3 Sorting by severity is per-page, by design

Severity is not a column, so it cannot be an `ORDER BY`. Sorting by `severity`
orders in SQL by the `action` enum (the closest indexed approximation) and then
ranks the returned page by true severity. **Severity sort is therefore exact
within a page, not across the whole result set.** Filtering by severity is exact
regardless, and filtering is what someone hunting critical events actually
wants. This is why the default sort is `createdAt`.

---

## 4. API

All under `/api/v1/owner/audit-logs`, all `authenticate + requireRole("OWNER")`
applied once at the router level.

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Paginated, filtered, sorted list |
| GET | `/filters` | Filter-bar options (modules, actions, severities, entities, actors) |
| GET | `/summary` | Counts by severity/module/action under the same filters |
| GET | `/:id` | One entry: snapshots, field diff, actor, session context |
| GET | `/:id/related` | Other entries against the same record |

`/filters` and `/summary` are declared **before** `/:id` so neither is captured
as an entry id.

### 4.1 List query parameters

| Param | Notes |
|---|---|
| `page`, `limit` | `limit` capped at **100** (an uncapped page size here is a DoS surface) |
| `search` | Matched against `recordId` and the actor's name/email/code |
| `module`, `action`, `severity` | **Multi-value.** Accepts `?module=SALE,INVENTORY` *or* repeated params |
| `employeeId`, `tableName`, `recordId` | Single-value, all indexed |
| `period` | `today\|yesterday\|week\|month\|quarter\|year\|all\|custom` (default `month`) |
| `from`, `to` | Required together when `period=custom`; rejected if inverted |
| `sortBy` | `createdAt` (default) or `severity` — **only these two** |
| `sortOrder` | `asc` / `desc` |

The enums are a **security control**, not decoration: `sortBy` reaches an
`ORDER BY` and `module`/`action` reach a `WHERE`. Enumerating the accepted
values is what stops a caller-supplied string from becoming part of a query.

### 4.2 ⚠ `search` does NOT search inside the snapshots

It matches the affected record id and the actor. Searching inside
`oldData`/`newData` would require a sequential scan with a JSON cast on every
row of the biggest table — the single easiest way to take this screen and the
database down. The detail view is where snapshot contents are read.

### 4.3 Response envelope — FLAT

```jsonc
{ "success": true, "data": [ … ], "meta": { … } }
```

The axios interceptor already returns `response.data`, so rows land at
`res.data` and pagination at `res.meta`. **This tree is flat**, unlike the
procurement controllers which nest a second `{data, meta}` inside. Reading the
wrong level does not throw — it silently yields an empty list, which on an audit
screen reads as "nothing happened".

### 4.4 `meta.totalIsExact` — the unusual field

```jsonc
"meta": { "total": 10000, "totalIsExact": false, "hasNextPage": true, … }
```

`false` means the count hit the server's cap and the UI must render **"10,000+"**
rather than a precise-looking number it cannot stand behind. When capped,
`totalPages` understates the truth, so pagination trusts `hasNextPage` — a full
page is itself the signal that more exist.

---

## 5. IP / device: correlated, and labelled as such

`audit_logs` has no network columns. `findSessionContext` in `audit.service.ts`
finds the actor's most recent successful `login_history` row at or before the
entry whose session had not already ended, served by
`login_history_employeeid_loginat_idx`.

**This is an INFERENCE, and the module never presents it as a recorded fact.**
The response tags it `source: "SESSION"`, and the drawer says *"Taken from the
sign-in session this person had open at the time. It is not stored on the entry
itself."* When no covering session is found, `context` is `null` and the UI says
so explicitly rather than showing blanks.

Presenting inferred provenance as recorded fact is precisely the thing an audit
UI must not do. **If this is ever changed, keep the labelling.**

---

## 6. Performance posture

This is the largest table in the system. Every decision below is load-bearing.

| Decision | Why |
|---|---|
| **List never selects `oldData`/`newData`** | The JSON blobs are the heaviest thing in the row and useless in a table view. Only `/:id` reads them, for one entry. |
| **Counts capped at 10,000** | A filtered `COUNT(*)` walks every matching row and is routinely slower than fetching the page. Past the cap the UI says "10,000+". |
| **Page + count in ONE `$transaction`** | Against Neon's pooler every query is a real network round-trip; issuing them sequentially would double the screen's latency. |
| **Offset paging refused past row 10,000** | `OFFSET 250000` makes Postgres walk and discard a quarter of a million rows. The error tells the reader to narrow instead of serving a slow page. |
| **Default period is 30 days, not all time** | Otherwise the very first request is the most expensive one the screen can issue. |
| **`id` is always the final `ORDER BY` tiebreaker** | Without it, rows sharing a timestamp reorder between requests, making offset paging skip or repeat rows. |
| **Search is debounced (350 ms)** | One request per keystroke against this table is not acceptable. |

### 6.1 The offset trade-off (decided)

Offset pagination was chosen over cursor/keyset **deliberately**: it keeps
jump-to-page and matches every other table in the app. The cost is a bounded
reachable depth (`MAX_OFFSET = 10,000`). Nobody audits by paging to row 250,000
— they narrow the filters, which is exactly what the error message says.

---

## 7. Architecture

Standard layering, no bypasses:

```
owner.audit.routes.ts  →  audit.controller.ts  →  audit.service.ts
                                                       ├→ audit.engine.ts   (pure)
                                                       └→ audit.repository.ts (Prisma only)
```

| File | Role |
|---|---|
| `engines/audit.engine.ts` | **Pure.** Severity policy, entity/action labels, field diff, period resolution. No Prisma, no I/O, no clock. |
| `repositories/audit.repository.ts` | Reads **appended** to the existing file; `create` is byte-identical. No update, no delete. |
| `services/audit.service.ts` | Filter translation, session correlation, pagination guards, shaping. |
| `validation/audit.validation.ts` | Zod schemas; the enum allow-lists. |

`AUDIT_ACTIONS` / `AUDIT_MODULES` in the validation module mirror the Prisma
enums and are **kept in sync by a test**, not by hand — adding a value to the
schema without adding it here fails the suite instead of shipping a filter that
400s on a legitimate value.

---

## 8. Frontend

`CLIENT/src/features/audit`, lazy-loaded (own ~26 kB chunk, never loaded for a
manager or cashier).

- **URL-backed filters** (`useAuditFilters`) — every filter, sort and page lives
  in the query string, so a filtered view is shareable, survives refresh and
  works with Back. That matters more here than anywhere else in the app: "the
  entries I am looking at" is exactly what an investigator sends to someone else.
  Multi-select filters travel as comma lists in the URL *and* the API, so the
  URL, the query key and the request cannot drift.
- **Every filter change resets to page 1**, so a narrowed result never strands
  the reader past the end.
- **Severity tiles double as filters** — the number and the way to act on it are
  the same affordance. They reflect the **current filters**, not the whole table.
- **Three distinct empty states**: filtered-to-nothing (offers *clear*),
  nothing-in-this-period (offers *widen* — the most common, since the default
  30-day window IS a filter), and genuinely-no-activity (explains, offers
  nothing). A single "No results" would make a busy system look broken.
- **Immutable-aware caching**: entries never change once written, so a fetched
  detail is correct indefinitely (5 min stale) and lists are 30 s. **Nothing
  polls** — an audit trail is a record, not a live monitor.
- Rows are activatable by click, Enter and Space, and exposed as buttons to
  assistive tech.

---

## 9. Tests

**67 new tests, all passing.** Full suites: **372 server** (9 pre-existing
skips), **150 client**.

| File | Count | Covers |
|---|---|---|
| `SERVER/src/engines/__tests__/audit.engine.test.ts` | 29 | Severity policy, the inversion round-trip and partition, enum sync, diff honesty, half-open periods |
| `SERVER/src/__tests__/audit.service.test.ts` | 22 | Severity→`action IN`, the empty-intersection case, half-open `lt`, offset refusal, capped counts, no-snapshots-in-list, session-context tagging |
| `SERVER/src/__tests__/audit.validation.test.ts` | 16 | Enum guards (injection surface), multi-value forms, custom-range rules, limit caps |
| `CLIENT/src/features/audit/__tests__/auditApi.test.ts` | 14 | Envelope level, comma-joining, empty-param dropping, `totalIsExact` defaults, **no write functions exist** |
| `CLIENT/src/features/audit/__tests__/format.test.ts` | 25 | `null` vs `""` vs absent vs `false`, severity variant distinctness, capped-total rendering |

The tests target failure modes that are **silent**: a wrong `where` still
returns rows, just not the right ones, and nobody notices until the trail is
actually needed.

### 9.1 Live verification (2026-08-03, against the real Neon database)

Run against 101 real audit rows with the dev server up.

| Check | Result |
|---|---|
| MANAGER on all 5 endpoints | **403** each |
| Anonymous | **401** |
| `POST` / `PATCH` / `PUT` / `DELETE` on the tree | **404** each — the read-only guarantee is structural, not just guarded |
| Severity partition | LOW 57 + MEDIUM 37 + CRITICAL 7 + HIGH 0 = **101** = the unfiltered total, so the inversion has no gaps or overlaps **on real data** |
| `severity=LOW&action=DELETE` | **0 rows** — the impossible intersection returns nothing, not everything |
| Field diff on a real UPDATE | Isolated `isActive: true → false` out of a full-record snapshot |
| Session correlation | Resolved a real IP, tagged `source: "SESSION"` |
| Guards (bad `sortBy`/`module`, `limit=5000`, custom w/o dates, inverted range, deep offset) | **400** each |
| Missing entry (well-formed cuid) | **404** `"Audit entry not found."` |

⚠ Note when testing by hand: `validateParam("id")` requires a cuid v2 shape
(`c` + 24 **lowercase** alphanumerics). A malformed id returns 400 from the
middleware and never reaches the service's 404.

---

## 10. Known gaps / deliberate omissions

| Gap | Status |
|---|---|
| **Export to CSV** | Not built. `REPORT_EXPORTED` is itself CRITICAL-classified, so an export of the audit trail should be audited too — worth doing deliberately, not as a footnote. |
| **Severity sort across the whole result set** | Not possible without a stored column. Per-page, as documented in §3.3. |
| **Full-text search inside snapshots** | Deliberately not built (§4.2). Would need a GIN index on the JSON columns to be viable — a schema change and a real decision. |
| **Composite indexes** | Not added. The existing single-column indexes serve the current filters; `(module, createdAt)` and `(employeeId, createdAt)` would help at much larger volume. Additive when wanted. |
| **Retention / archival** | No policy. The table grows without bound; at some point this needs a partition or archive strategy. |

---

## 11. Standing rules (do not re-open casually)

1. **The audit API stays read-only.** No create/update/delete route, ever.
   Asserted by a client test that scans the API surface for write-shaped names.
2. **Audit writing is not changed by this module.** Every writer still calls
   `auditRepository.create` unmodified; the reads were appended to the same file.
3. **Severity filtering must stay an indexed `action IN (...)`.** If it ever
   becomes a computed SQL expression, this screen scans the largest table.
4. **Inferred context stays labelled as inferred.** See §5.
5. **The list must never select `oldData`/`newData`.**
