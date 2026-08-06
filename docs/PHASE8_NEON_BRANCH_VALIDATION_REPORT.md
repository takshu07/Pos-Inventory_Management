# Phase 8 — Neon Branch Validation Run

**Date:** 2026-08-06
**Branch:** `feature/offline-first-sync`
**Executed on:** `Tanishk-PC` — development laptop (12th Gen i5-12450H × 12, 15.7 GB, win32)
**Cloud target:** Neon branch `ep-cool-dew-atzuupmj` (`us-east-1`), **not** production
**Operator:** Tanishk Budhlakoti

This run closed the gates that Phases 6 and 7 recorded as blocked on Neon
credentials. It did **not** close the real-till-hardware gate, which by
definition cannot be closed from a laptop.

---

## 0. Verdict

| Gate | Before | After |
|---|---|---|
| Cloud migration applied to a branch | ⏳ blocked | ✅ applied |
| End-to-end offline day validated against real Postgres | ⏳ blocked | ✅ **64/64 checks passed** |
| Local write-path performance at day volume | ✅ (laptop) | ✅ re-measured |
| Provisioning against real Neon (Phase 7 R1) | ⏳ blocked | ✅ **PROVISIONED**, 15/15 |
| Stress harness cloud leg | ⚠ claimed | ⛔ **found to be a no-op — fixed** |
| **Can a till actually take a payment?** | assumed yes | ⛔ **no — fixed (§6a)** |
| Real till hardware (Phase 6) | ⏳ pending | ⏳ **still pending** |

**Three findings matter more than the passes** — §3 (latency), §5 (a flag that
faked coverage) and **§6a (the till could not sell at all)**. The last was
invisible to every automated harness and was only found by driving a real
checkout over HTTP.

---

## 1. Isolation proof

Isolation was proven before anything was written, using the method
[PHASE6_REAL_TILL_STRESS_REPORT §4 S6](PHASE6_REAL_TILL_STRESS_REPORT.md)
identifies as the only reliable one — a marker table written to the branch and
looked for in production.

| Check | Result |
|---|---|
| Branch host | `ep-cool-dew-atzuupmj-pooler.c-9.us-east-1` |
| Production host | `ep-frosty-moon-at71qpbs-pooler.c-9.us-east-1` |
| Marker written to branch | `phase_iso_marker_1785979471084` |
| **Production `to_regclass` for that marker** | **`null` — isolation proven** |
| Marker dropped afterwards | ✅ |
| Branch state before migration | 57 app tables, 0 of the 4 sync tables |
| Money tables on the branch | `sales=0 payments=0 sale_items=0 inventory_movements=0 audit_logs=0` |

The branch is a real, separate database. Note it is **not** a fork of
production — it holds 3 products and 2 sales of its own, not production's data.
That is fine for protocol validation and is what makes it safe, but it means
this run says nothing about real catalog volume (§4.2).

---

## 2. Phase A — cloud migration

`npm run sync:verify-migration` (read-only), then `--apply --i-have-taken-a-backup`.

| Check | Result |
|---|---|
| Every statement additive | ✅ 11 statements, `CREATE TABLE` / `CREATE INDEX` only |
| Creates only the expected tables | ✅ `sync_receipts`, `sync_nonces`, `sync_devices`, `sync_conflict_records` |
| Migration still pending | ✅ 12 migrations applied before |
| No half-applied migrations | ✅ |
| Target tables absent | ✅ |
| **Schema drift** | ✅ live needed only those four tables, no other drift |
| Applied | ✅ `20260805090000_offline_first_sync_cloud_tables` |

The backup check is an operator assertion, not a verified fact — the script says
so, and on a disposable branch with zero money rows it carries no risk.

---

## 3. Phase B — end-to-end offline day · **64/64 passed**

`npm run sync:validate -- --transactions 200 --i-accept-writes-to-this-database`

Real Postgres over the wire, HTTP listener closed at the socket for the offline
day, real HMAC signing, real keyset pagination.

### What passed

| Stage | Evidence |
|---|---|
| Morning download | 99 rows, 47 variants; **0 items echoed into the queue** |
| Offline day | 200 sales, 50 walk-in customers, 204 stock movements, returns, exchanges, purchases — **865 queue items captured** |
| Isolation during outage | **cloud sales 2 → 2** — nothing leaked while disconnected |
| Interruption | 288 items stranded `IN_FLIGHT`, run left `RUNNING` |
| Recovery | in-flight 0, pending back to **865 — nothing lost, nothing invisible** |
| Drain | 865 applied, 0 rejected, queue fully drained |
| **Idempotency** | re-uploaded the entire day: **202 → 202**, all 865 recognized as duplicates |
| **Revenue reconciliation** | local **₹79,401.00** = cloud **₹79,401.00** — to the paisa |
| Payments | 201 / ₹79,202.00 both sides |
| Stock ledger | net −374 both sides, matches 399 sold − 25 returned/received |
| Receipts | 865 synced → 865 receipts, **0 keys written twice** |
| Conflicts | cloud won a price change; till won a recorded sale; `"199.00"` vs `199` → **no false conflict** |

### ⚠ Finding 1 — upload throughput is latency-bound, and it is slow

**Upload of 865 items took 496,282 ms — 8 min 16 s. That is 574 ms per item.**

Root cause, measured directly:

| Target | Round-trip `select 1` |
|---|---|
| Test branch (`us-east-1`) | **p50 270.0 ms**, p95 274.8 |
| **Production (`us-east-1`)** | **p50 252.9 ms**, p95 307.3 |

Both databases are in `us-east-1` while the till is in India. **This is not a
test-environment artifact — production has the same latency**, so the figure is
representative of what a real till will do.

Projected overnight drain at this rate:

| Day size | Queue items | Projected drain |
|---|---|---|
| 200 sales | 865 | 8 min |
| 1,000 sales | 4,300 | **41 min** |
| 3,000 sales | 12,000 | **115 min (~2 h)** |

This still fits a normal overnight window, but with far less margin than
`OFFLINE_FIRST.md` implies. Two things follow:

1. It reinforces why `SYNC_UPLOAD_BATCH_SIZE` must stay at 50 — at 270 ms per
   round trip, a larger batch cannot finish inside `cloudApply`'s 120 s
   transaction budget.
2. **Moving the cloud node to a region near the shop is the single highest-value
   performance change available**, and it requires no code. It is not in scope
   here, but it should be a decision before the fleet grows.

---

## 4. Phase C — local stress at day volume

`npm run sync:stress -- --products 2000 --transactions 3000` (laptop, local-only)

| Measure | Result | Threshold | Verdict |
|---|---|---|---|
| Catalog load | 4,000 rows in 1,552 ms — 2,577 rows/s | — | — |
| **Barcode / SKU lookup** | **0.25 ms** avg | p95 < 50 ms | ✅ |
| Checkout with capture | 4.73 ms per sale | p95 < 250 ms | ✅ |
| Full day: 3,000 sales | 16.6 s — 181 sales/s | — | ✅ |
| **Every write captured** | **12,000 / 12,000** (exactly ×4) | exact | ✅ |
| Local database size | 16.5 MB | < 2048 MB | ✅ |
| Process heap | 212 MB | — | ✅ |
| Status aggregate at depth | 0.69 ms | < 100 ms | ✅ |
| Batch claim (200) | 4.2 ms | < 200 ms | ✅ |
| Idempotency keys unique | 12,000 / 12,000 | exact | ✅ |
| Interrupted-sync recovery | 500 stranded → 0, total preserved 12,000 | exact | ✅ |
| Capture-failure detection | not captured → repaired → captured | — | ✅ |
| Conflict decisions | 20,000 in 7 ms | — | ✅ |

### ⚠ Do not quote the "capture overhead" number

The harness reported **"capture overhead −34.9% (−2.54 ms)"** — i.e. capture
made checkouts *faster* (4.73 ms with vs 7.27 ms without). That is not
physically possible.

The cause is the measurement, not the database: `stress-sync.ts` runs a single
unrepeated A/B, with the *with-capture* arm first on a colder database, no
warm-up and no interleaving. The two arms differ by less than the run-to-run
noise, so the subtraction is meaningless.

**The honest conclusion:** capture overhead is **below this harness's noise
floor** — not negative, and not the previously documented +0.58 ms / +14%
either. What is solidly established is that **checkout is ~5–7 ms either way,
two orders of magnitude under the 250 ms threshold**, which is the fact the
decision actually rests on.

Fixing the A/B (repeat, interleave, discard a warm-up) would make the figure
trustworthy. Not done here — it is a measurement change, not a product change.

---

## 5. ⛔ Finding 2 — `--with-cloud` was a no-op, and it hid that fact

The most serious finding of this run.

`npm run sync:stress -- --with-cloud` printed `cloud: yes` and produced a fully
green run with **no cloud section at all**. Investigation:

- `withCloud` appeared in exactly **three** places in `stress-sync.ts`: parsed,
  printed in the header, and used to **suppress the "NOT measured" footer**.
- The script imports **zero** sync or cloud code (`grep -cE "runSync|cloudApply|getCloudClient"` → **0**, against **7** in `validate-sync-e2e.ts`).

So the flag never measured the cloud. Its only effect was to **delete the
warning saying the cloud had not been measured** — converting an honest "this is
uncovered" into a clean green run implying coverage it never had. Anyone
following `OFFLINE_FIRST.md §14.3`, which documents this flag as the way to
measure cloud-side throughput, would have been misled.

**Fix applied** ([`scripts/stress-sync.ts`](../SERVER/scripts/stress-sync.ts)):

- `--with-cloud` now **refuses with exit code 2** and explains that it never
  measured the cloud, naming `sync:validate` as the harness that really does.
- The "NOT measured" notice is now **unconditional** — it states that this
  harness is local-only by construction and cannot be made to imply otherwise.

`npx tsc --noEmit` → exit 0. `npm run test:unit` → **593 passed, 28 files**.

`OFFLINE_FIRST.md §14.3` still documents the old flag and needs correcting.

---

## 6. Phase D — provisioning against real Neon · **R1 closed**

A cloud node was started against the branch (port 4310) and a fresh till
provisioned against it over real signed HTTP.

### First attempt — **correctly refused**

```
✖ no stress-test data   51 harness-tagged row(s) (1 products, 50 customers)
Mirror verification FAILED (1 check(s)). The mirror was rejected rather than
handed to a cashier.
```

This is **the safety mechanism working**, and it is exactly Phase 7 risk **R6**
("stress data present in the cloud") firing in practice. My own Phase B run had
left 50 `E2E-` customers and a product in the branch; provisioning detected the
residue *in the cloud* and refused to build a till from it. Being a first-time
provisioning there was nothing to roll back to, so the partial mirror was
discarded — no half-built database was left behind.

The residue was then removed (865 rows, in FK-dependency order derived from
`information_schema`, in a single transaction; two earlier attempts with guessed
table names **rolled back cleanly without changing anything**). The branch
returned to its original 3 products / 2 customers / 2 sales.

### Second attempt — **PROVISIONED**

| Check | Result |
|---|---|
| queue is empty | ✅ 0 items |
| database integrity | ✅ `integrity_check = ok` |
| foreign key enforcement ON | ✅ `foreign_keys = 1` |
| no foreign key violations | ✅ 0 orphans |
| change-capture triggers | ✅ **102/102** |
| device identity initialized | ✅ `phase7-till-01` |
| device id is not a harness id | ✅ |
| change capture enabled | ✅ |
| no fake idempotency keys | ✅ |
| **no stress-test data** | ✅ no `E2E-`/`STRESS-` rows |
| download cursors initialized | ✅ 19 cursors |
| **cursors point at rows the mirror holds** | ✅ every cursor names a present row |
| cursor state matches downloaded data | ✅ |
| **row counts match cloud expectations** | ✅ 19 entities reconciled |
| no local-only rows | ✅ |

```
RESULT: PROVISIONED   —   93 rows, 19 entities, 49.7s
```

**Phase 7 R1 is closed.** R2 (provisioning wall time) is partially answered —
**49.7 s for 93 rows** — but on a 93-row catalog that number is dominated by the
19 sequential signed round trips, not by data volume, so it does not predict a
real catalog. R2 stays open (§7).

One advisory fired correctly throughout: `EDGE_HAS_DATABASE_URL`, noting this
workstation holds Neon credentials a real till should not. That it stayed
**advisory** rather than demanding the destroys-the-mirror flag is the
three-severity design from Phase 7 §2.2 working as intended.

---

## 6a. ⛔ Finding 3 — the till could not sell at all (found 2026-08-06, after §6)

Found while building a manual test rig ([OFFLINE_LOCAL_TEST_RIG.md](OFFLINE_LOCAL_TEST_RIG.md))
and driving a real checkout over HTTP. **This is the most serious defect found
in the whole effort**, and every automated harness passed while it was present.

Opening a cash register failed on an edge node:

```
PrismaClientValidationError: Invalid `db(tx).cashRegister.create()`
  openingBalance: { constructor: [object Function], s: 1, e: 3, d: [5000] }
Invalid value for argument `constructor`: We could not serialize
[object Function] value.
```

No open register means **no sale can be recorded**. The till was unable to sell.

**Cause.** `scalarListBridge.ts` walks the Prisma args tree to rewrite
`imageUrls` / `workingDays`, and rebuilds any containing object with
`{ ...source }`. A `Prisma.Decimal` stores its digits in own *enumerable*
properties — `Object.keys(new Decimal(5000))` is `["constructor","s","e","d"]` —
so the spread produced a plain object with a `constructor` function and no
Decimal prototype. The bridge guarded `Date` but not `Decimal`.

An initial hypothesis — that the two generated clients have different `Decimal`
classes — was **wrong and was checked rather than assumed**:
`cloud.Prisma.Decimal === local.Prisma.Decimal` is `true`. The router's comment
claiming class identity is correct; it simply was not the hazard. That comment
has been extended to say what the real hazard is.

**Why every harness missed it.** `sync:validate` and `sync:stress` write through
repositories and raw SQL. Only a request through the real HTTP checkout path
builds a `Decimal` in service code and hands it to the routed client. The rig
did that; the harnesses never do.

**Fix.** An `isOpaqueValue` guard in both `encodeArgs` and `decodeResult`.
It matches by **shape** (`toFixed` + numeric `s`/`e`), not `constructor.name`:
the bundled client minifies the class to **`Decimal2`**, so a name check fails
silently — the first version of the fix did exactly that and the tests caught it.

Locked in by `src/offline/__tests__/scalarListBridge.test.ts` — 8 tests,
including the exact "no `constructor` key leaks" assertion and a Decimal beside
a scalar list, which is the combination that forces the rebuild.

`npx tsc --noEmit` → exit 0. `npm run test:unit` → **601 passed, 29 files**.

**Manual verification after the fix:** cloud process stopped, 5 sales rung up
through the HTTP API, then drained and reconciled:

| Check | Local | Cloud |
|---|---|---|
| sale count | 5 | 5 |
| **sale revenue** | **₹4,056.00** | **₹4,056.00** |
| payment total | ₹4,056.48 | ₹4,056.48 |
| inventory movements | 5 | 5 |
| duplicate sales | — | 0 |

**The lesson worth keeping:** protocol-level harnesses proved the sync correct
while the application could not take a payment. Coverage of the wire is not
coverage of the till.

---

## 7. What is still NOT validated

| # | Gap | Why it remains |
|---|---|---|
| G1 | **Real till hardware** | Phase 6's gate. This was a laptop. fsync cost, eMMC write latency, responsiveness under load and peripherals (printer, scanner, cash drawer) are all unmeasured. **This is still the blocking gate.** |
| G2 | **Real catalog volume** | The branch holds 3 products. Production may hold thousands. Provisioning and morning-download wall time at real volume are unknown. |
| G3 | **Cloud-side upload throughput under concurrency** | One device, sequentially. Several tills draining at once is unmeasured. |
| G4 | **Capture overhead as a number** | §4 — the harness's A/B is too noisy to quote. |
| G5 | **Two tills, same `OFFLINE_DEVICE_ID`** | Phase 7 R5, unchanged. Still a fleet-management gap; belongs at cloud enrollment. |

---

## 8. Recommendations, in priority order

1. **Run the Phase 6 gate on the actual till.** Everything else is secondary;
   this run does not substitute for it.
2. **Decide on cloud region.** 253 ms to production from India sets a ~2 h drain
   for a 3,000-sale day. A region change is free performance and needs no code.
3. **Correct `OFFLINE_FIRST.md §14.3`** — it still documents `--with-cloud` as
   the way to measure cloud throughput. It never was.
4. **Fix the capture-overhead A/B** (repeat, interleave, warm-up) so the figure
   can be quoted, or remove it and quote absolute checkout latency instead.
5. **Re-measure provisioning against a production-sized catalog** before a
   multi-till rollout.
6. **Clean harness residue from any cloud database before provisioning tills
   from it** — provisioning enforces this, as §6 demonstrates.

---

## 9. Reproducing this run

```bash
cd SERVER
DATABASE_URL=<branch> npm run sync:verify-migration
DATABASE_URL=<branch> npm run sync:verify-migration -- --apply --i-have-taken-a-backup

LOCAL_DATABASE_PATH=./data/e2e-validation.db npm run db:local:push
DATABASE_URL=<branch> npm run sync:validate -- --transactions 200 --i-accept-writes-to-this-database

LOCAL_DATABASE_PATH=./data/stress.db npm run db:local:push
npm run sync:stress -- --products 2000 --transactions 3000

# cloud node on the branch, then:
OFFLINE_MODE_ENABLED=true OFFLINE_DEVICE_ID=phase7-till-01 \
SYNC_CLOUD_URL=http://localhost:4310 SYNC_DEVICE_SECRET=<32+> \
LOCAL_DATABASE_PATH=./data/phase7-till.db \
npm run till:provision -- --verify-against-cloud
```

The till's real mirror `data/pos-local.db` was **not touched** by any of this —
every harness ran against its own SQLite file (`e2e-validation.db`, `stress.db`,
`stress-cloud.db`, `phase7-till.db`).

## 10. Related documents

- [OFFLINE_FIRST.md](OFFLINE_FIRST.md) — architecture (§14.3 needs the fix in §5)
- [PHASE6_REAL_TILL_STRESS_REPORT.md](PHASE6_REAL_TILL_STRESS_REPORT.md) — the still-pending hardware gate
- [PHASE7_TILL_PROVISIONING_REPORT.md](PHASE7_TILL_PROVISIONING_REPORT.md) — R1 closed by §6
- [TILL_PROVISIONING_RUNBOOK.md](TILL_PROVISIONING_RUNBOOK.md) — operational procedure
