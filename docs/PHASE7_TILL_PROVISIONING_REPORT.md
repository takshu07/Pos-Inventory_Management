# Phase 7 — Fresh Till Provisioning & Mirror Initialization

**Date:** 2026-08-06
**Branch:** `feature/offline-first-sync`
**Scope:** An automated, verified provisioning workflow so every new cashier PC
starts from a clean offline mirror rather than from whatever SQLite file happens
to be on disk.

---

## 0. Verdict

| Question | Answer |
|---|---|
| Is the provisioning workflow implemented? | **Yes.** Six-stage command, fully idempotent, safe to retry. |
| Is it validated? | **Yes, at two levels.** 36 automated tests + a 37-check end-to-end rehearsal over real signed HTTP. |
| Was it run against a temporary Neon branch? | ~~No — blocked.~~ **Yes — done 2026-08-06.** `RESULT: PROVISIONED`, 15/15 checks, against a real Neon branch proven isolated from production. See [PHASE8 §6](PHASE8_NEON_BRANCH_VALIDATION_REPORT.md); R1 in §7 is closed. |
| Is a freshly provisioned till ready for Offline Mode? | **Yes, subject to the Phase 6 hardware gate.** Every mechanism is verified, now including against real Neon. What remains is not provisioning — it is `sync:stress` on the actual till. |

**The honest summary:** the workflow is complete and its logic is proven against
real SQLite and a real signed download path. What has *not* been exercised is a
download of the real production catalog at real volume from real Neon. That gap
is infrastructural, not a gap in the code, and it is one command to close.

---

## 1. What was built

All additive. No existing file's behavior was changed.

| File | Lines | Purpose |
|---|---|---|
| `src/offline/provisioning/preflight.ts` | 454 | The gate. Decides whether a till may be wiped. |
| `src/offline/provisioning/provision.ts` | 490 | Orchestrator: quarantine → build → identity → download → verify, with rollback. |
| `src/offline/provisioning/verify.ts` | 562 | 15 checks proving a mirror is fit to sell from. |
| `scripts/provision-till.ts` | 243 | The operator CLI. |
| `scripts/provision-rehearsal.ts` | 526 | End-to-end rehearsal against a stand-in cloud. |
| `src/offline/__tests__/provisioning.integration.test.ts` | 1105 | 36 tests over real SQLite. |

Modified: `package.json` (3 npm scripts), `vitest.unit.config.ts` (register the
suite, raise its timeout). **Nothing else.**

```
 SERVER/package.json          |  3 +++
 SERVER/vitest.unit.config.ts | 11 ++++++++++-
```

### Constraint compliance

| Constraint | Status |
|---|---|
| Do not modify the offline sync protocol | ✅ `protocol.ts`, `upload.ts`, `cloudApply.ts`, `cloudServe.ts` untouched. Row-count verification re-pages the **existing** `/sync/download` endpoint from a zero cursor rather than adding a count endpoint. |
| Do not change production data | ✅ Provisioning only reads from the cloud, via the signed API. No `DATABASE_URL` is required or used. |
| Do not weaken existing safety checks | ✅ Purely additive. Diff above. |
| Keep provisioning idempotent and safe to retry | ✅ Verified by test and by rehearsal §6. |
| Preserve backward compatibility | ✅ With `OFFLINE_MODE_ENABLED` unset, none of this code loads. |

---

## 2. The design decisions that matter

### 2.1 Quarantine, never delete

An existing mirror is **renamed** to `pos-local.db.superseded-<timestamp>`, not
unlinked, and renamed back if any stage fails.

The alternative — delete then rebuild — makes the worst case unrecoverable. A
till's queue can hold sales that exist nowhere else; if the rebuild then fails
halfway, the operator has neither the old data nor a working till. Quarantining
costs disk space on a machine that has plenty and makes the worst outcome "we
are back where we started."

All three SQLite files (`.db`, `-wal`, `-shm`) move together. Moving only the
`.db` leaves a WAL belonging to a database that is no longer there, which SQLite
reports as corruption.

### 2.2 Three severities, not two

The confirmation flag `--i-understand-this-destroys-the-mirror` is a statement
about **data loss**. Three severities keep it that way:

- **BLOCKING** — no override. Pending uploads, wrong role, no device id.
- **CONFIRMABLE** — requires the flag. Non-empty mirror, foreign mirror, stress database.
- **ADVISORY** — reported, never gates.

This distinction was **found by a failing test, not designed up front.** The
first implementation made "this node has a `DATABASE_URL`" confirmable, which
meant every developer workstation needed the destroys-the-mirror flag to
provision an empty directory. That trains operators to pass the flag reflexively
— and the one time it genuinely means data loss, they pass it without reading.
A hygiene warning must never spend the credibility of a data-loss gate.

### 2.3 Pending uploads are unoverridable

The single most important line in the system:

```ts
if (queued > 0) {
  findings.push({ code: "PENDING_UPLOADS", severity: "BLOCKING", … });
}
```

Checked **first**, before database emptiness, because irreversibility — not cost
— sets the order. Counts `PENDING`, `IN_FLIGHT`, `FAILED` and `CONFLICT`: a
`FAILED` item is an unsent sale that merely exhausted its retries, and treating
it as disposable is how a day's takings vanish.

There is deliberately no flag for this. The operator who most needs stopping is
the one already convinced it is fine.

### 2.4 Verification rejects the mirror rather than warning about it

A failed non-advisory check triggers full rollback. Provisioning is not finished
when the download stops; it is finished when the mirror is **proven** correct.
Every way this goes wrong produces a database that looks fine:

- a download that stopped at page 9 of 40 → a catalog with a hole in it
- a cursor written ahead of its rows → tomorrow's sync skips rows, permanently
- FK enforcement that silently did not take → orphans, rejected at upload
- missing capture triggers → the till sells perfectly and uploads nothing

None of these throw. All are caught by the 15 checks in `verify.ts`.

### 2.5 The cursor check

The most valuable single check, and the least obvious. A cursor is a promise:
*"everything up to `(updatedAt, id)` is already here."* If it was advanced past
rows that never committed, tomorrow's incremental sync starts **after** those
rows and never fetches them. The gap is permanent and completely silent — the
products simply do not exist on that till, and every scan of them fails at the
counter.

The check: every cursor must name a row the mirror actually holds.

---

## 3. Validation — automated tests

`npm run test:unit` → **593 tests, 28 files, all passing.**
Provisioning suite alone: **36 tests, all passing.**

Real SQLite with the real generated mirror schema and the real 102 change-capture
triggers. Only the cloud is substituted, so a case can model "the link dropped at
page 9" without needing Neon.

| Required scenario | Tests | Result |
|---|---|---|
| First-time provisioning | 4 | ✅ |
| Re-provisioning | 3 | ✅ |
| Existing queue detection | 3 | ✅ |
| Duplicate device detection | 5 | ✅ |
| Corrupted database | 2 | ✅ |
| Interrupted provisioning | 3 | ✅ |
| Failed download recovery | 4 | ✅ |
| Cursor verification | 3 | ✅ |
| Mirror verification | 7 | ✅ |
| Rollback after failure | (covered above) | ✅ |
| Role enforcement + severity semantics | 3 | ✅ |

Notable cases:

- **`REFUSES when the queue holds unsent sales, even with confirmation`** — passes
  `confirmed: true` and asserts refusal anyway. This is the test that would fail
  if someone later "helpfully" made the check overridable.
- **`rolls back to the previous mirror when the download throws`** — seeds a product
  named `SURVIVES-ROLLBACK`, fails the download, asserts it is still there.
- **`catches a cursor that points at a row the mirror does not hold`** — the silent
  data-gap check.
- **`does not gate a first-time run behind the destroys-the-mirror flag`** — locks in
  §2.2 so the advisory/confirmable distinction cannot regress.

---

## 4. Validation — end-to-end rehearsal

`npm run till:rehearse` → **37/37 checks passed**, reproducible across runs.

Drives `provisionTill` through the **real** download path: real HTTP over a real
socket, real HMAC-SHA256 signing, real keyset pagination, real page-at-a-time
transactional apply, real cursor advancement, real verification. Only the store
behind the cloud's `/sync/download` endpoint is a stand-in.

The catalog is built with **coarse timestamps** — 50 rows share each `updatedAt`
— so the `id` half of the composite keyset cursor is load-bearing. A cursor on
`updatedAt` alone would skip rows here, which means the rehearsal can actually
catch that bug rather than assume its absence.

| Phase | Checks | Evidence |
|---|---|---|
| 1. First-time provisioning | 8 | 1,910 rows over 22 signed requests; Product paginated across 3 pages; 13/13 verification checks |
| 2. Mirror contents | 10 | 1250 products, 40 categories, 620 customers; **queue empty (no download echo)**; 19 cursors, none dangling; 102/102 triggers |
| 3. Re-provisioning refused | 4 | Refused at PREFLIGHT; catalog untouched |
| 4. Pending uploads block | 4 | Real sale via the real trigger; **confirmed run still refused**; sale preserved |
| 5. Rollback | 4 | Cloud made to fail; previous mirror restored; catalog and queue intact |
| 6. Retry / idempotency | 5 | Re-run after failure succeeds; superseded mirror preserved |
| 7. Cloud reconciliation | 2 | 19 entities reconciled via `--verify-against-cloud` |

The rehearsal runs with `DATABASE_URL` **deleted from the environment**, which
also proves provisioning needs no production database credentials.

---

## 5. Two bugs found and fixed during validation

Both were found by tests failing, and both would have caused real field failures.

### 5.1 Verification read the ambient environment instead of the injected config

`verifyMirror` called `offlineConfig()` directly while `provisionTill` accepted an
injected config. In any process where the two differ, verification compared the
new mirror against a **different identity** than the one it had just written —
reporting the freshly correct device id as *"this mirror carries another till's
identity."* Fixed by threading the config through every check that needs it.

### 5.2 A corrupt database leaked a file handle, breaking quarantine

The preflight opens the existing mirror read-only. For a corrupt file the
better-sqlite3 constructor **succeeds** and only the first query fails — so the
cleanup, which was keyed on `existing !== null`, skipped the close for exactly
the case that needed it. Windows then refused to rename the file and quarantine
failed with `file is not a database`.

This is the "rebuild a corrupt mirror" path — a genuine field scenario, and the
one where the operator is already having a bad day. Fixed by tracking whether a
handle was *opened* separately from whether it turned out to be *usable*.

---

## 6. What was NOT validated, and why

### 6.1 The Neon branch run — blocked on credentials

The task asked for execution against a temporary Neon branch. **I could not do
this, and I did not fake it.**

| Requirement | Status |
|---|---|
| `neonctl` / `neon` CLI | Not installed |
| `NEON_API_KEY` or equivalent | Not present in environment or `.env` |
| Local Postgres or Docker | Neither available (`docker: command not found`) |
| `DATABASE_URL` | Points at **production** (`ep-frosty-moon-at71qpbs`) — confirmed via `node scripts/check-db-target.mjs`, exit 1 |

Creating a Neon branch is an operator step requiring console or CLI access, and
this is consistent with how Phases 5 and 6 documented the same gate
([MODULE_STATUS §0.4](MODULE_STATUS.md), [PHASE6_REAL_TILL_PREFLIGHT §B1](PHASE6_REAL_TILL_PREFLIGHT.md)).

I ran the strongest substitute available — the §4 rehearsal, which exercises
every code path except the Postgres backend — and built it as a permanent,
re-runnable script rather than a one-off.

**To close this gate, one command on a machine with Neon access:**

```bash
neonctl branches create --name phase7-provisioning-$(date +%Y%m%d)
export SYNC_CLOUD_URL=<cloud node pointed at that branch>
npm run till:provision -- --verify-against-cloud
```

Expect `RESULT: PROVISIONED` with `row counts match cloud expectations` passing.

### 6.2 Real catalog volume and timing

The rehearsal downloads 1,910 rows. A production catalog may be one or two orders
of magnitude larger. Nothing in the design is volume-sensitive — pagination is
keyset-based and pages apply one transaction at a time — but **provisioning wall
time on a real catalog is unmeasured.** Measure it on the first till; it sets the
per-machine budget for a rollout.

### 6.3 Cloud-side count semantics under concurrent writes

`--verify-against-cloud` re-pages every entity and allows the cloud to be *ahead*
(head office may add a product mid-verification); only a **shortfall** fails.
A cloud-side `DELETE` between download and verification is indistinguishable from
residue, which is why the excess check is advisory. This is the correct trade —
failing a good mirror is worse than flagging a rare benign difference — but it
means the excess check should not be treated as a hard integrity guarantee.

---

## 7. Remaining risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | ~~Neon-branch run not yet performed~~ | ~~Medium~~ **CLOSED** | ✅ **Closed 2026-08-06.** Run against a real Neon branch: `RESULT: PROVISIONED`, 93 rows / 19 entities in 49.7s, **15/15 verification checks passed**. Notably the *first* attempt correctly **refused** — it detected `E2E-` harness residue in the cloud (risk R6, firing in practice) and rejected the mirror rather than handing it to a cashier. See [PHASE8 §6](PHASE8_NEON_BRANCH_VALIDATION_REPORT.md). |
| R2 | Provisioning time on a real catalog unknown | Low | **Partially answered:** 49.7s for 93 rows — but that is dominated by 19 sequential signed round trips at ~270 ms, not by data volume, so it does not predict a real catalog. Still measure on the first real till. |
| R3 | Operator passes the confirmation flag habitually | **Medium** | Three severities keep the flag scarce (§2.2). Pending uploads remain unoverridable regardless. |
| R4 | A `.superseded-` file is deleted before a successful sync | Low | Runbook §2 G6 makes deletion the last step, after upload is confirmed. |
| R5 | Two tills configured with the same `OFFLINE_DEVICE_ID` | **High if it happens** | Detected as `FOREIGN_MIRROR` only when the *mirror* is shared. Two tills **separately** configured with the same id is a pre-existing fleet-management gap, not closed by this phase. `GET /api/v1/sync/devices` is the fleet view; a uniqueness check at enrollment would close it properly. |
| R6 | Stress data present in the **cloud** | Medium | Detected by the `no stress-test data` check, which fails the mirror. Clean the cloud before provisioning tills from it. |
| R7 | Rollback-of-rollback failure (exit 2) | Low | Runbook §4 manual procedure. Data is never deleted, so recovery is always possible. |

**R5 is the one worth stating plainly:** provisioning detects a *copied mirror*,
but it cannot detect two tills that were independently mis-configured with the
same device id, because each has a locally consistent identity. That check
belongs at cloud enrollment. It is out of scope here (it would mean touching the
sync protocol) and should be tracked separately.

---

## 8. Is a freshly provisioned till ready for Offline Mode?

**Yes — subject to the R1 gate.**

A till that reports `RESULT: PROVISIONED` has been proven to have:

- a brand-new SQLite database, never an inherited one
- the complete master data, downloaded over signed HTTP with no failed entities
- its own device identity, with no stale watermarks from a previous mirror
- all 102 change-capture triggers installed and capture enabled
- an empty queue, `integrity_check = ok`, FKs enforced and satisfied
- cursors that name rows the mirror actually holds
- no stress data and no hand-written idempotency keys

Any of these failing rejects the mirror and restores the previous one.

**Before the first production till:**

1. Run §6.1 against a Neon branch. *(closes R1)*
2. Record the wall time. *(closes R2)*
3. Follow the post-provisioning validation in
   [TILL_PROVISIONING_RUNBOOK.md §2 G1–G6](TILL_PROVISIONING_RUNBOOK.md) — ring
   up one real sale and confirm it reaches the cloud. That is the only test that
   proves identity, signing and the upload path together on that specific machine.

---

## 9. Reproducing this report

```bash
cd SERVER
npx tsc --noEmit                      # exit 0
npm run test:unit                     # 593 passed, 28 files
npm run till:rehearse                 # 37/37 checks passed
npm run till:provision:check          # dry run, writes nothing
```

## 10. Related documents

- [TILL_PROVISIONING_RUNBOOK.md](TILL_PROVISIONING_RUNBOOK.md) — operational procedure
- [OFFLINE_FIRST.md](OFFLINE_FIRST.md) — the architecture
- [OFFLINE_ROLLBACK_RUNBOOK.md](OFFLINE_ROLLBACK_RUNBOOK.md) — disabling Offline Mode
- [PHASE6_REAL_TILL_PREFLIGHT.md](PHASE6_REAL_TILL_PREFLIGHT.md) — hardware preflight
