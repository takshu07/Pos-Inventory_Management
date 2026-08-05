# Phase 3 — Offline Synchronization Validation Report

**Date:** 2026-08-05
**Branch:** `feature/offline-first-sync`
**Target database:** Neon backup branch `ep-lingering-bonus-at613irg` (`neondb`)
**Verdict:** **PASS** — 64/64 end-to-end checks, 21/21 stress checks, 506/506 unit tests.

---

## 1. Target isolation — proven before any write

The validation harnesses write real sales into whatever `DATABASE_URL` points at,
so the first task was proving the target was not production.

`SERVER/.env` line 12 points at **live** Neon (`ep-frosty-moon-at71qpbs`); the
backup branch on line 14 is commented out. `.env` was **not modified**. The
backup URL was supplied per-command as an environment override, which `dotenv`
does not overwrite.

Neon branches are copy-on-write forks and **share a `system_identifier`**
(`7658684782315801817` on both), so that value cannot distinguish them. Isolation
was instead proven by writing a marker table to the target and confirming the
live database never saw it:

| Check | Result |
|---|---|
| `system_identifier` (live vs target) | identical — inconclusive by design |
| Marker table written to target | visible on target |
| Same table visible on live | **NO** → databases are isolated |

The harness's own safety guard also fired correctly on first run and refused the
target, because the hostname contains no `test`/`staging`/`branch` token. It was
overridden only after the isolation proof above, with
`--i-accept-writes-to-this-database`.

**Post-run audit of the live database — clean:**

| Probe | Live DB |
|---|---|
| `sync*` tables | 0 — migration still unapplied, as intended |
| Isolation probe table | absent |
| `E2E-%` sales / products / customers / employees / suppliers | 0 |
| `E2E-%` exchanges / purchases / notifications | 0 |
| `STRESS%` sales | 0 |
| Total sales | 1 (pre-existing) |

---

## 2. Backup branch readiness

| Item | State |
|---|---|
| Migration `20260805090000_offline_first_sync_cloud_tables` | applied, `finished_at` set |
| Cloud sync tables | `sync_receipts`, `sync_devices`, `sync_nonces`, `sync_conflict_records` |
| Total tables | 60 |
| Half-applied migrations | none |
| `npm run sync:verify-migration` | **exit 0** — every statement additive |

The two warnings it emits are benign: the migration is already applied to this
branch, and backup is not required for a read-only run.

---

## 3. The simulated business day

One process acts as both till and cloud — possible because `cloudApply`/`cloudServe`
address the cloud through `getCloudClient()` rather than the routed `prisma`
export. Nothing is stubbed: real Express over a real socket, real HMAC signing,
real SQLite triggers, real Prisma writes to Neon. The outage is a **real
disconnection** — the listener is closed at the socket, so the transport fails
the way it fails when a shop's router dies.

| Phase | Result |
|---|---|
| **Morning download** | SUCCESS — 398 rows, 143 variants; queue not echoed (0 items) |
| **Offline day** | 40 sales, 10 walk-in customers, 44 stock movements, 1 refund, 1 exchange, 1 goods receipt, 1 expense, 1 attendance, 1 notification |
| **Capture** | 185 queue items pending — every write captured |
| **Isolation during outage** | cloud sales unchanged (121 → 121) |
| **Night upload** | SUCCESS — 185 applied, 0 rejected, 0 failed, ~97s |

Sales, returns, exchanges, customers, purchases, inventory movements, attendance,
expenses and payments were all exercised.

---

## 4. Reconciliation — SQLite vs Neon

All 64 checks passed. The load-bearing ones:

| Module | Local | Cloud | Result |
|---|---|---|---|
| Sales count | 40 | 40 | match |
| **Sale revenue** | ₹15,721.00 | ₹15,721.00 | **to the paisa** |
| Sale items | 40 | 40 | match |
| Payments count / total | 41 / ₹15,522.00 | 41 / ₹15,522.00 | match |
| Inventory movements | 44 | 44 | match |
| Net stock change | −54 | −54 | match |
| Stock ledger vs trade | −54 | expected −54 (79 sold − 25 returned/received) | match |
| Customers | 10 | 10 | match |
| Refunded / exchanged sale status | 1 / 1 | 1 / 1 | propagated |
| Exchange headers / returned / issued lines | 1 / 1 / 1 | 1 / 1 / 1 | match |
| Purchases / lines / received qty | 1 / 1 / 24 | 1 / 1 / 24 | match |
| Notifications | 1 | 1 | match |
| Expenses / attendance | 1 / 1 | 1 / ≥1 | uploaded |

**Reports** are reconciled separately, because a report can disagree even when
every row matched — a Decimal that arrived as text or a timestamp that lost its
zone reconciles row-for-row and still produces a different daily total:

| Report figure | Local | Cloud |
|---|---|---|
| Gross sales | ₹15,721.00 | ₹15,721.00 |
| Average basket | ₹393.02 | ₹393.02 |
| Payment-method split | CASH ₹7,761.00 / UPI ₹7,761.00 | identical |
| Stock-on-hand per variant | 5 variants | all reconciled |

**Audit logs:** 0 local entries this run, 0 receipts — consistent. The audit path
itself is covered by policy tests; `AuditLog` is classified `UP` so an offline
day is not a hole in the trail.

---

## 5. Duplicate prevention

| Check | Result |
|---|---|
| Whole day re-uploaded (185 items replayed) | sales 161 → **161** — no duplicates created |
| Items recognised as duplicates | 185 |
| Duplicate `saleNumber` rows in cloud | 0 |
| Synced items vs receipts | 185 / **185** — exactly one each |
| Any idempotency key with 2+ receipts | **0** |

---

## 6. Interrupted sync resumes safely

A batch was claimed and abandoned exactly as a killed process leaves it —
61 items `IN_FLIGHT`, the run row still `RUNNING` — then real startup recovery
(`recoverAndBootstrap`) was run:

| Check | Result |
|---|---|
| Items stranded in flight | 61 |
| After recovery — still in flight | **0** — nothing invisible to the next drain |
| Queue total preserved | 185 = 185 — nothing lost, nothing duplicated |
| Interrupted run closed | status `INTERRUPTED` — lock released, status no longer reports "syncing" forever |

The subsequent upload then drained all 185 items cleanly.

---

## 7. Conflict handling

Both directions provoked for real against the cloud:

| Scenario | Expected | Result |
|---|---|---|
| Head office re-prices while till is offline (both sides changed the row) | CLOUD wins | till ₹179.00 → **₹349.00** |
| Till's record of a completed sale | LOCAL wins | **LOCAL** |
| Unchanged row re-downloaded | no conflict logged | 1 → 1, **no false conflict** |

The third is the regression guard for the numeric-comparison trap: Postgres
returns `"199.00"`, SQLite returns `199`. Compared as text, every priced row
would log a conflict on every sync. The stress run confirms the same
independently (`Postgres 12.50 vs SQLite 12.5 → identical`).

---

## 8. Stress and recovery

`npm run sync:stress` — **exit 0, no failures**, 1,000 products / 2,000 transactions:

| Metric | Value |
|---|---|
| Change-capture triggers | 102 |
| Barcode/SKU scan path | 0.33 ms avg |
| Capture overhead | +1.15 ms/sale (+27.8%) — imperceptible at the till |
| Queue depth after the day | 8,000 (exactly 4 writes/sale) |
| Idempotency keys unique | 8,000 / 8,000, no collisions |
| Heap after a full day | 159 MB — queue streamed, never loaded whole |
| Status endpoint aggregate | 0.66 ms |
| Stranded-item recovery | 500 recovered, 0 still stranded, 8,000 preserved |
| Capture-off detection + repair | suppression confirmed, auto-repaired |

---

## 9. Changes made during validation

`SERVER/scripts/validate-sync-e2e.ts` was extended to close real coverage gaps —
returns, exchanges, purchases and notifications had **no** end-to-end coverage,
and interrupted-resume and conflict handling were only covered as in-memory
benchmarks, never over the wire.

Added: refund, exchange (with return/issued lines and both stock legs), supplier
goods receipt, notification, reports reconciliation, an over-the-wire
interrupted-resume phase, and a conflict-handling phase.

Three fixes to **the harness's own assertions**, not the sync engine:

1. **Wrong field names** — `notes` / `exchangeId` / `purchaseId` on
   `InventoryMovement`; the real columns are `reason` / `relatedExchangeId` /
   `relatedPurchaseId`.
2. **Stock ledger assertion predated returns.** It compared net movement against
   units *sold*, which only holds on a day with no returns and no deliveries.
   Now compares against sold − returned/received. An exchange is deliberately
   excluded: it is stock-neutral (same quantity in and out).
3. **Receipt count compared cumulatively.** It counted *all* receipts for the
   device against *this run's* synced items, so it folded in every earlier run
   (357 vs 185) and failed a perfectly good sync. Now matched on
   `idempotencyKey`, plus a new check that no key ever received two receipts.

Verified after each change: `tsc --noEmit` clean, 506/506 unit tests pass,
26/26 `defaultDisabled` guard tests pass (`OFFLINE_MODE_ENABLED` still false by
default).

---

## 10. Known gap — not a blocker

`stress-sync.ts` accepts `--with-cloud` and prints `cloud: yes`, but the flag
**gates no actual work** — it only suppresses a hint at the end. Cloud-side
upload throughput over the wire is therefore *not* measured by that harness.

This is a harness limitation, not a sync defect, and it is **covered elsewhere**:
`validate-sync-e2e.ts` drives the complete upload path over a real socket against
Neon, including the ~97s drain of 185 items reported above. Worth fixing before
the flag misleads someone, but it does not affect this phase's verdict.

---

## 11. Verdict

Every required validation passed:

- [x] Full suite run against the **backup branch only**; live database proven untouched
- [x] Morning download → offline day → night sync
- [x] Realistic transactions across all nine required modules
- [x] Reconciliation: sales, inventory, customers, payments, purchases, reports, audit logs, notifications
- [x] Duplicate uploads prevented
- [x] Interrupted sync resumes safely
- [x] Conflict handling behaves as designed

**Phase 3 passes.** Remaining before production cutover (unchanged from the
runbook, both operational): run `sync:stress` on real till hardware, then enable
Offline Mode per-deployment. `OFFLINE_MODE_ENABLED` must stay `false` by default.
