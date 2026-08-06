# Phase 6 — Real Till Production Stress Test Report

> **⚠ TEMPLATE — NOT YET EXECUTED.**
> Every value marked `____` is unmeasured. Do not fill any of them from a
> developer laptop, from a previous run, or from an estimate. They are filled in
> **only** by transcribing the output of a run on the shop's actual till.
>
> **Verdict: ⏳ PENDING · Go/No-Go: ⏳ PENDING**

---

## 0. Execution attempt log

An attempt to execute this gate was made on **2026-08-06** and **could not
proceed**. No measurement fields below have been filled, because no measurement
was taken. This section records the attempt so the gap is auditable.

| Precondition | Required | Actual on the attempting machine | Verdict |
|---|---|---|---|
| Machine is the shop's till (A1) | Physical cashier PC | `Tanishk-PC` — 12th Gen i5-12450H × 12, 15.7 GB, win32 — a **development laptop** | ⛔ fail |
| Temporary Neon branch (A12, B1) | `phase6-stress-*` branch | `neonctl` not installed; `NEON_API_KEY` unset; no `psql`; no Docker | ⛔ fail |
| `DATABASE_URL` is not live (B4, §C step 5) | Branch host | `.env` points at `ep-frosty-moon-at71qpbs`; `node scripts/check-db-target.mjs` → `*** PRODUCTION ***`, exit 1 | ⛔ fail |
| Receipt printer (A13) | Connected, prints test page | Only `OneNote (Desktop)` and `Microsoft Print to PDF` — **no physical printer** | ⛔ fail |
| Barcode scanner (A14) | Scans to text editor | Not present on this machine | ⛔ fail |
| Cash drawer (A15) | Opens on kick | Not present on this machine | ⛔ fail |

Per §C of the pre-flight package — *"If any box in §C is unticked, do not run
§D"* — and §G1 — *"Run did not happen on the till (`hostname` is a laptop)
⛔ NO-GO"* — the gate was **not** executed. Executing it here would have produced
laptop numbers that §G1 explicitly disqualifies, against a database the guard
identifies as production.

**What was verified instead** (code-level; no substitute for the gate):

| Evidence | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run test:unit` | **593 passed, 28 files** |
| `npm run till:rehearse` | **37/37 checks passed** — real signed HTTP, 1,910 rows, 19 entities |
| Stress-harness guard probe | Refused to run on an unprovisioned mirror; defaulted to `./data/production-stress.db`, **never** `pos-local.db` |
| Till's real mirror | `SERVER/data/pos-local.db` untouched — 7,053,312 bytes, mtime `Aug 5 10:40`, unchanged |

**This section is not a result.** The verdict stays ⏳ PENDING.

### Update 2026-08-06 — the *cloud* gates closed, this one did not

A Neon test branch was later supplied, which closed the database-side gates that
blocked the attempt above. It does **not** close this gate.

| Gate | Status |
|---|---|
| Temporary Neon branch available | ✅ resolved — branch proven isolated from production |
| Migration applied to a branch | ✅ done |
| `sync:validate` against real Postgres | ✅ **64/64 passed**, revenue reconciled to the paisa |
| Till provisioned against real Neon | ✅ `PROVISIONED`, 15/15 checks (Phase 7 R1 closed) |
| **Run on the shop's actual till (A1)** | ⛔ **still not done — this is now the only blocking gate** |
| Peripherals: printer / scanner / cash drawer (A13–A15) | ⛔ still absent on the attempting machine |

Everything below still requires the till. The laptop run measured the *protocol*
and found it correct; it cannot measure fsync cost, eMMC write latency,
responsiveness under real load, or hardware that is not attached. Per §G1 a
laptop run is disqualified from producing a Go regardless of how green it is.

One number from the branch run does bear on the decision here: **upload is
latency-bound at ~574 ms per queue item** against `us-east-1`, projecting ~2 h to
drain a 3,000-sale day. Check that against the overnight window in §10c when
this gate is finally run.

Full results: [PHASE8_NEON_BRANCH_VALIDATION_REPORT.md](PHASE8_NEON_BRANCH_VALIDATION_REPORT.md).

**Pre-flight package:** [`PHASE6_REAL_TILL_PREFLIGHT.md`](PHASE6_REAL_TILL_PREFLIGHT.md)
**Reference runbook:** [`PHASE6_PRODUCTION_STRESS_RUNBOOK.md`](PHASE6_PRODUCTION_STRESS_RUNBOOK.md)

---

## 1. Run identification

| Field | Value |
|---|---|
| Date / time of run (local) | `____` |
| Operator (name) | `____` |
| Witness / approver (name) | `____` |
| Repository branch | `____` (expected `feature/offline-first-sync`) |
| Commit SHA | `____` |
| Working tree clean at run time | ☐ yes ☐ no |
| Node.js version | `____` |
| Harness command executed (verbatim) | `____` |
| Console log file | `____` |
| JSON report file | `SERVER/reports/production-stress-____-____.json` |

---

## 2. Machine under test

Transcribed from **§0 MACHINE UNDER TEST** of the console output.

| Field | Measured |
|---|---|
| Hostname | `____` |
| Is this the shop's till (not a laptop/VM)? | ☐ yes ☐ no |
| Platform / release / arch | `____` |
| CPU model × cores | `____` |
| Total memory / free memory | `____` GB / `____` GB |
| Storage type (eMMC / SATA SSD / NVMe / HDD) | `____` |
| Free disk on the `SERVER/data/` volume | `____` GB |
| **fsync cost on the database volume** | `____` ms — verdict ☐ ok ☐ warn |
| Node version reported by harness | `____` |

> fsync is the floor under every checkout: `synchronous = FULL` fsyncs four times
> per sale. This single number predicts most of §5.

---

## 3. Workload sizing

| Field | Value | Source |
|---|---|---|
| Shop's real catalog size (`products`) | `____` | §B5 query against live |
| Shop's real variant count (`product_variants`) | `____` | §B5 query against live |
| Busiest single day's sales count | `____` | §B5 query against live |
| Date of that busiest day | `____` | §B5 query |
| `--products` used | `____` | command |
| `--transactions` used | `____` | command |
| `--pace` used | `____` (default 2; **0 invalidates responsiveness**) | command |
| `--interrupt-after` used | `____` ms (default 4000) | command |
| Headroom run performed (3× transactions)? | ☐ yes ☐ no — `____` | §D3 |

---

## 4. Safety and isolation evidence

| # | Check | Evidence | Result |
|---|---|---|---|
| S1 | `LOCAL_DATABASE_PATH` used | `____` | ☐ safe (not `pos-local.db`) |
| S2 | Neon branch name | `____` | ☐ temporary branch |
| S3 | Branch host (password masked) | `____` | ☐ not `ep-frosty-moon-at71qpbs` |
| S4 | Migration applied to branch | `20260805090000_offline_first_sync_cloud_tables` | ☐ applied ☐ `sync:verify-migration` clean |
| S5 | **Isolation marker written to branch** | marker id `____` | ☐ written |
| S6 | **Live queried for that marker** | `to_regclass` returned `____` | ☐ `null` — isolation proven |
| S7 | `SERVER/.env` unmodified | `git diff --stat -- SERVER/.env` → `____` | ☐ empty |
| S8 | `data/pos-local.db` size/mtime **before** run | `____` | recorded |
| S9 | `data/pos-local.db` size/mtime **after** run | `____` | ☐ unchanged |
| S10 | Live `PSTRESS-` sale count after run | `____` | ☐ zero |

> S6 is the only reliable proof of isolation. Neon branches are copy-on-write
> forks and **share a `system_identifier` with production**, so that value can
> never demonstrate separation.

---

## 5. Peripherals

The harness does not drive these; they are verified as part of till readiness.

| Device | Model / connection | Pre-run | Post-run | Notes |
|---|---|---|---|---|
| Receipt printer | `____` | ☐ pass ☐ fail | ☐ pass ☐ fail | `____` |
| Barcode scanner | `____` | ☐ pass ☐ fail | ☐ pass ☐ fail | `____` |
| Cash drawer | `____` | ☐ pass ☐ fail | ☐ pass ☐ fail | `____` |

---

## 6. Results — Section 1: Setup

| Metric | Measured | Verdict |
|---|---|---|
| Change-capture triggers installed | `____` triggers, `____` missing | ☐ PASS ☐ FAIL |
| Local mirror cleared | `____` | ☐ ok |

---

## 7. Results — Section 2: Catalog load

| Metric | Measured | Threshold | Verdict |
|---|---|---|---|
| Products + variants written | `____` rows in `____` s (`____` rows/s) | — | — |
| Catalog load CPU | `____` % of one core (`____` % of machine) | — | — |
| **Barcode scan read latency** | p50 `____` ms · p95 `____` ms · p99 `____` ms | **p95 < 50 ms** (T2) | ☐ ok ☐ warn |
| Variants scanned against | `____` | — | — |

---

## 8. Results — Section 3: Full business day

| Metric | Measured | Threshold | Verdict |
|---|---|---|---|
| **Transaction throughput** | `____` sales/s | review (R2) | ☐ accept ☐ concern |
| — time writing / wall-clock | `____` s writing, `____` s wall-clock | — | — |
| **Checkout WRITE latency** | p50 `____` · p95 `____` · p99 `____` · max `____` ms | **p95 < 250 ms** (T1) | ☐ ok ☐ warn |
| **Application responsiveness** | loop delay p50 `____` ms · p99 `____` ms · max `____` ms | **p99 < 500 ms** (T3) | ☐ ok ☐ warn ☐ **NOT MEASURED** |
| **CPU during trade** | `____` % of one core (`____` % of machine) | warn ≥ 90% of machine (R3) | ☐ ok ☐ warn |
| **Memory during trade** | RSS peak `____` MB · heap peak `____` MB | **RSS < 1024 MB** (T4) | ☐ ok ☐ warn |
| **Every write was captured** | queue depth `____`, expected `____` | **exactly ×4** (T6) | ☐ PASS ☐ FAIL |
| **Database size on disk** | `____` MB (main `____` + WAL `____`) | **< 2048 MB** (T5) | ☐ ok ☐ warn |

> If responsiveness reads **NOT MEASURED**, this run does not satisfy T3.
> Absence of data is not a pass — re-run with a longer workload and `--pace` ≥ 1.

---

## 9. Results — Section 4: Queue processing at depth

| Metric | Measured | Threshold | Verdict |
|---|---|---|---|
| Status aggregate (polled by every till screen) | p50 `____` ms · p95 `____` ms at `____` queued items | warn ≥ 100 ms (R4) | ☐ ok ☐ warn |
| Batch claim (50 items) | p50 `____` ms · p95 `____` ms | warn ≥ 200 ms (R5) | ☐ ok ☐ warn |
| **Idempotency keys unique across queue** | `____` distinct / `____` total | **equal** (T7) | ☐ PASS ☐ FAIL |

---

## 10. Results — Section 5: Synchronisation (real cloud, real HTTP)

☐ This section was executed (**required** for a Go)
☐ Skipped — `--local-only` (⛔ cannot produce a Go)

| Metric | Measured |
|---|---|
| Cloud listener | `____` |
| Pending items before sync | `____` |

### 10a. Interrupted upload — the power-cut scenario

| Metric | Measured |
|---|---|
| Time before the cut | `____` s (configured `--interrupt-after ____` ms) |
| Engine behaviour | ☐ handled without throwing ☐ reported: `____` |
| Queue state after the cut | `____` pending · `____` in-flight · `____` synced · `____` failed |

### 10b. Recovery

| Metric | Measured | Threshold | Verdict |
|---|---|---|---|
| Interrupted runs closed | `____` | — | — |
| Items recovered to PENDING | `____` | — | — |
| **Nothing stranded in flight after recovery** | in-flight = `____` | **0** (T8) | ☐ PASS ☐ FAIL |
| **No queue item lost to the interruption** | `____` of `____` survived | **equal** (T9) | ☐ PASS ☐ FAIL |

### 10c. Resume and drain to completion

| Metric | Measured | Threshold | Verdict |
|---|---|---|---|
| **Synchronisation duration** | `____` s for `____` items (`____` items/s) | review (R6) | ☐ accept ☐ concern |
| **Projected drain for a full day's queue** | `____` min for `____` items | must fit the overnight window (R6) | ☐ accept ☐ concern |
| CPU during sync | `____` % of one core | — | — |
| Responsiveness during sync | loop delay p99 `____` ms | **< 500 ms** (R8) | ☐ ok ☐ warn ☐ NOT MEASURED |
| **Queue fully drained** | `____` still pending | **0** (T10) | ☐ PASS ☐ FAIL |
| **No item failed permanently** | `____` failed | **0** (T11) | ☐ PASS ☐ FAIL |

**Overnight window check:** shop closes `____`, opens `____` → window `____` h.
Projected drain `____` min. ☐ fits comfortably ☐ marginal ☐ does not fit

---

## 11. Results — Section 6: Post-sync consistency (reconciliation)

Every row is a hard assertion. Any FAIL is a blocker.

| # | Check | Measured | Verdict |
|---|---|---|---|
| T12 | Sale COUNT matches | local `____`, cloud `____` | ☐ PASS ☐ FAIL |
| T13 | **REVENUE matches to the paisa** | local ₹`____`, cloud ₹`____` | ☐ PASS ☐ FAIL |
| T14 | No sale left behind | `____` missing | ☐ PASS ☐ FAIL |
| T15 | **No DUPLICATE sales in the cloud** | `____` rows, `____` distinct sale numbers | ☐ PASS ☐ FAIL |
| T16a | PAYMENT count matches | local `____`, cloud `____` | ☐ PASS ☐ FAIL |
| T16b | PAYMENT total matches | local ₹`____`, cloud ₹`____` | ☐ PASS ☐ FAIL |
| T17a | Inventory MOVEMENT count matches | local `____`, cloud `____` | ☐ PASS ☐ FAIL |
| T17b | Net STOCK change matches | local `____`, cloud `____` | ☐ PASS ☐ FAIL |
| T18 | Stock ledger agrees with the day's trade | net `____`, expected `____` | ☐ PASS ☐ FAIL |
| T19 | Sale ITEM count matches | local `____`, cloud `____` | ☐ PASS ☐ FAIL |
| T20 | CUSTOMERS reached the cloud | local `____`, cloud `____` | ☐ PASS ☐ FAIL |
| T21 | REPORT aggregate agrees across both databases | local `____` / ₹`____`, cloud `____` / ₹`____` | ☐ PASS ☐ FAIL |

> T13 is the single most important number in the run. If revenue does not match
> to the paisa, the day's books do not balance and nothing else matters.

---

## 12. Overall harness verdict

| Field | Measured |
|---|---|
| Exit code | `____` (must be `0`) |
| Console verdict line | `____` (must be `✔ PASS`) |
| Failing checks (`✖`) | `____` (must be `0`) |
| Warnings (`!`) | `____` |
| JSON `verdict` field | `____` |

### Warnings raised, and their disposition

| # | Warning (section › label) | Measured value | Accepted by | Rationale |
|---|---|---|---|---|
| 1 | `____` | `____` | `____` | `____` |
| 2 | `____` | `____` | `____` | `____` |
| 3 | `____` | `____` | `____` | `____` |

☐ All warnings reviewed and consciously accepted by a named human.

---

## 13. Headroom run (3× busiest day) — optional but recommended

☐ Performed ☐ Not performed

| Metric | Measured | Verdict |
|---|---|---|
| Transactions | `____` | — |
| Checkout write latency p95 | `____` ms | ☐ ok ☐ warn |
| Throughput | `____` sales/s | ☐ accept ☐ concern |
| RSS peak | `____` MB | ☐ ok ☐ warn |
| Database size | `____` MB | ☐ ok ☐ warn |
| Sync duration | `____` s | ☐ accept ☐ concern |
| Exit code / verdict | `____` | ☐ PASS ☐ FAIL |

---

## 14. Post-run verification

Mirrors §F of the pre-flight package.

| # | Check | Result |
|---|---|---|
| F1 | Exit code `0` | ☐ |
| F2 | `✔ PASS`, zero `✖` | ☐ |
| F3 | JSON report exists, `verdict: PASS` | ☐ |
| F4 | Report hostname is the till | ☐ |
| F5 | Workload matches the shop's real figures | ☐ |
| F6 | `localOnly: false` on the gate run | ☐ |
| F7 | Warnings reviewed and accepted | ☐ |
| F8 | Interruption recovery: 0 stranded, 0 lost | ☐ |
| F9 | Revenue matches to the paisa | ☐ |
| F10 | Zero duplicate sales | ☐ |
| F11 | Till's real `pos-local.db` untouched | ☐ |
| F12 | Live has no `PSTRESS-` residue | ☐ |
| F13 | Live has no `phase6_isolation_marker` table | ☐ |
| F14 | Measured values transcribed into this report | ☐ |
| F15 | JSON + console log attached to sign-off | ☐ |
| F16 | Peripherals still functional | ☐ |
| F17 | Go/No-Go recorded with a named human | ☐ |

### Cleanup

| Action | Done |
|---|---|
| Stress SQLite file deleted (`data/phase6-real-till.db*`) | ☐ |
| Temporary Neon branch deleted (`phase6-stress-____`) | ☐ |
| JSON report + console log archived | ☐ |
| `.db` file retained for diagnosis (**only if the run failed**) | ☐ n/a ☐ retained |

---

## 15. Go/No-Go decision

### Blocking gate summary

| Gate | Status |
|---|---|
| Ran on the actual till (not a laptop) | ☐ yes ☐ no |
| Cloud half executed (not `--local-only`) | ☐ yes ☐ no |
| Sized to the shop's real catalog and busiest day | ☐ yes ☐ no |
| All blocking thresholds T1–T22 pass | ☐ yes ☐ no |
| Responsiveness actually measured (not `NOT MEASURED`) | ☐ yes ☐ no |
| Projected sync drain fits the overnight window | ☐ yes ☐ no |
| Peripherals functional | ☐ yes ☐ no |
| Isolation proven; live clean | ☐ yes ☐ no |
| Warnings reviewed and accepted | ☐ yes ☐ no |

### Decision

> **⏳ PENDING**
>
> The stress test has not been executed on the till. No measurement exists, no
> threshold has been evaluated, and no verdict has been produced. This report is
> a prepared template.
>
> The decision remains **PENDING** until every `____` above carries a value
> transcribed from a real run on the shop's till hardware, and a named human
> records the outcome below.

**Final decision (delete the two that do not apply):**

- ☐ ✅ **GO** — merge `feature/offline-first-sync`; set `OFFLINE_MODE_ENABLED=true`
  on the cut-over deployment **only** (it stays `false` in `.env.example`, the
  Dockerfile and compose, permanently).
- ☐ ⚠ **CONDITIONAL GO** — conditions and their owners recorded below.
- ☐ ⛔ **NO-GO** — do not merge, do not enable Offline Mode anywhere. Preserve
  all artefacts.

| Field | Value |
|---|---|
| Decision | `____` |
| Decided by (name) | `____` |
| Date | `____` |
| Conditions (if conditional) | `____` |
| Blocking findings (if no-go) | `____` |
| Follow-up actions / owners | `____` |

---

## 16. Observations and anomalies

Free text. Record anything the tables cannot hold: crashes, retries, unusual
machine behaviour, deviations from the runbook, interruptions during the run.

```
____
```

---

## 17. Attachments

| Artefact | Path |
|---|---|
| JSON report (gate run) | `____` |
| JSON report (headroom run) | `____` |
| Console log | `____` |
| Photos of the till / peripherals (optional) | `____` |
| Failed-run `.db` file (if applicable) | `____` |
