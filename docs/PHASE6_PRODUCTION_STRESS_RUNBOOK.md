# Phase 6 — Production Stress Test Runbook

**Audience:** whoever is running the stress test on the shop's till computer.
**Goal:** prove the offline-first build is safe to enable on real hardware —
or find out that it is not, before a customer is standing at the counter.

**Gate:** until this passes on the actual till, do **not** merge
`feature/offline-first-sync` and do **not** set `OFFLINE_MODE_ENABLED=true` on
any production deployment.

---

## 0. Read this first (60 seconds)

| | |
|---|---|
| **Where must this run?** | **On the till computer.** Numbers from a developer laptop do not count — see §1. |
| **Will it touch the live database?** | **Only if you let it.** It refuses any `DATABASE_URL` that does not look disposable. Use a Neon **branch**. |
| **Will it touch the till's real sales?** | **Not if you set `LOCAL_DATABASE_PATH`** to its own file, as every command below does. It defaults to `./data/production-stress.db`, never the till's `data/pos-local.db`. |
| **How long does it take?** | 10–25 minutes at default size, mostly the catalog load and the sync drain. |
| **What does it leave behind?** | Rows tagged `PSTRESS-…` in the branch database, a JSON report under `SERVER/reports/`, and its own `.db` file. |
| **The single most dangerous mistake** | Pointing `LOCAL_DATABASE_PATH` at `data/pos-local.db`. The harness **wipes** the database it is given. That file holds un-uploaded sales. |

> ⛔ **Never run this against the live Neon URL, and never against the till's
> real local database.** Both are one flag away, and both are unrecoverable.

---

## 1. Why it must run on the till

The whole point of Phase 6 is the hardware. On this workload the dominant cost
is **fsync**: the local database runs `synchronous = FULL`, so every sale waits
for the disk to physically flush, four times over.

Measured `fsync` cost on the dev laptop (NVMe): **~1.4 ms**. A till on eMMC or a
spinning disk is commonly **5–20 ms**. That difference multiplies through every
checkout, and it is invisible in any other spec — same Node version, same code,
same database, ten times the latency.

The harness records the machine identity and its measured fsync cost into every
report, so a laptop result can never be mistaken for a till result.

---

## 2. What you need

- The till computer, with the repo checked out on `feature/offline-first-sync`.
- `npm ci` completed on that machine.
- **A disposable Neon branch** — not production. Create it from the Neon console
  and apply the migration to it (see §3).
- The till should be otherwise **idle**: no one ringing up sales, so the CPU and
  responsiveness numbers describe the test and not the lunch rush.

---

## 3. Prepare the cloud branch

The cloud half writes real rows. It must never be production.

```bash
# 1. Create a branch in the Neon console, copy its connection string.
# 2. Apply the offline migration to THAT branch (never to live):
DATABASE_URL='postgresql://…ep-your-branch…/neondb?sslmode=require' \
  npx prisma migrate deploy
```

> ⚠ **Neon branches share a `system_identifier` with production**, so no
> automatic check can prove you are off live. The only reliable proof is to
> write a marker row to the branch and confirm production never sees it. Do that
> before you trust the target.

**Never edit `SERVER/.env` to switch databases.** Pass `DATABASE_URL=…` as a
per-command override — `dotenv` does not overwrite an already-set variable.

---

## 4. Prepare the local database

The harness needs its own SQLite file, separate from the till's real one.

```bash
cd SERVER

# Bash / Git Bash
LOCAL_DATABASE_PATH=./data/production-stress.db npm run db:local:setup
```

```powershell
# Windows PowerShell
$env:LOCAL_DATABASE_PATH = "./data/production-stress.db"
npm run db:local:setup
```

A fresh path has no tables until this is done; the harness will stop and tell
you so if you skip it.

---

## 5. Run it

### 5a. Local-only first (safe, no cloud, ~5 min)

Proves the till hardware itself before involving the network:

```bash
LOCAL_DATABASE_PATH=./data/production-stress.db \
  npm run stress:production -- --local-only
```

### 5b. The full run (the actual gate)

```bash
LOCAL_DATABASE_PATH=./data/production-stress.db \
DATABASE_URL='postgresql://…ep-your-branch…/neondb?sslmode=require' \
  npm run stress:production -- --i-accept-writes-to-this-database
```

`--i-accept-writes-to-this-database` is required because a Neon branch hostname
does not contain `test`/`staging`/`branch`, so the guard cannot clear it alone.
**Read the URL it prints before you type the flag.**

### Options

| Flag | Default | What it does |
|---|---|---|
| `--products` | 3000 | Catalog size — set it to the shop's real product count. |
| `--transactions` | 3000 | Sales in the simulated day. Use a busy day's real figure. |
| `--pace` | 2 | Milliseconds between sales. **Do not set 0** — see §7. |
| `--interrupt-after` | 4000 | When to cut the connection mid-sync, in ms. |
| `--local-only` | off | Skip the cloud entirely. |

Size it to the shop: if the busiest day is 800 sales over 4,000 products, run
`--products 4000 --transactions 800`, then again at 3× for headroom.

---

## 6. What it measures, and what counts as a pass

| Section | Requirement it answers |
|---|---|
| 0 | Machine identity + fsync cost — proves *which* hardware |
| 2 | Catalog load; barcode scan read latency (p50/p95/p99) |
| 3 | Throughput, checkout **write** latency, CPU, memory (RSS), database size, responsiveness |
| 4 | Queue processing at depth; idempotency-key uniqueness |
| 5 | Real sync over HTTP, **interrupted mid-flight**, then recovery and full drain |
| 6 | Reconciliation: sales, revenue, payments, inventory, customers, reports |

**Pass = the harness exits `0` and prints `✔ PASS`.** Any `✖` is a blocker.

Thresholds are "the till is unusable" lines, not targets:

| Metric | Threshold |
|---|---|
| Checkout write latency p95 | < 250 ms |
| Barcode scan p95 | < 50 ms |
| Event-loop delay p99 | < 500 ms |
| RSS peak | < 1024 MB |
| Database size | < 2048 MB |

A number inside its threshold but far worse than the dev baseline below is still
worth a conversation — it will show as a warning, not a failure.

### Dev-laptop baseline (i5-12450H, NVMe, 16 GB) — for comparison only

| Metric | Value |
|---|---|
| fsync | 1.4 ms |
| Checkout write latency | p50 7.8 ms · p95 12.0 ms · p99 21.8 ms |
| Throughput | ~126 sales/s (at 2 ms pace) |
| Barcode scan | p50 0.26 ms · p95 0.70 ms |
| Event-loop delay | p50 14.3 ms · p99 29.0 ms |
| RSS peak | 300 MB |

**Expect the till to be slower.** That is the point of measuring it there.

---

## 7. Reading the results honestly

**`--pace 0` disables the responsiveness measurement.** A back-to-back `await`
loop never yields to the macrotask queue, so Node's event-loop monitor records
nothing at all. The harness will print `NOT MEASURED` rather than a fake pass —
if you see that, raise `--transactions` or leave `--pace` at its default.

**Event-loop delay has a floor of roughly one timer tick** (~15 ms on Windows).
A p99 in the tens of milliseconds is the measurement floor, not a stall. What
matters is that it stays far below 500 ms.

**CPU can exceed 100% of one core.** It is CPU-time over wall-time, and the
native SQLite addon uses more than one thread. The "% of machine" figure next to
it is the one that matches Task Manager.

**Throughput excludes the injected think-time**, so `--pace` makes the run take
longer in wall-clock without making throughput look worse.

---

## 8. If it fails

| Symptom | Meaning | Action |
|---|---|---|
| `no sync_queue table` | Schema never pushed to this path | §4 |
| `REFUSING TO RUN` | `DATABASE_URL` is not obviously disposable | Confirm the target; do **not** add the flag reflexively |
| `sale COUNT` / `REVENUE` mismatch | **Data loss or double-apply.** | **Blocker.** Keep the report and the `.db` file; do not enable Offline Mode. |
| `DUPLICATE sales in the cloud` | Retry after the interruption double-applied | **Blocker** — this is what the interruption test exists to catch |
| `items stranded in flight` | Recovery did not reclaim the batch | **Blocker** — that work is invisible to the next drain |
| Checkout p95 far above the baseline | Usually the disk | Compare the fsync figure in §0 of the report |

Every run writes `SERVER/reports/production-stress-<host>-<timestamp>.json`
containing the machine profile and every measurement. **Attach it to the Phase 6
sign-off**; it is the evidence, and it names the machine that produced it.

---

## 9. Cleaning up

```bash
# The stress SQLite file — safe to delete, it is not the till's real database.
rm SERVER/data/production-stress.db*
```

The `PSTRESS-…` rows live in the disposable Neon branch. Delete the whole
branch when you are done — that is cleaner than deleting rows.

> ⛔ Never run `npm run db:local:setup` against `data/pos-local.db` to "clean
> up". That destroys every un-uploaded sale on the till.

---

## 10. Sign-off

Phase 6 passes when **all** of these are true:

- [ ] The run happened **on the till**, and the report's `hostname` proves it.
- [ ] Exit code `0`, `✔ PASS`, zero `✖` checks.
- [ ] Workload was sized to the shop's real catalog and a busy day's sales.
- [ ] The interrupted-sync section shows recovery with **no items stranded** and
      **no queue item lost**.
- [ ] Reconciliation shows revenue matching **to the paisa** and **no duplicates**.
- [ ] Warnings reviewed and accepted by a human.
- [ ] The JSON report is attached to the sign-off.

Only then: merge `feature/offline-first-sync`, and enable
`OFFLINE_MODE_ENABLED=true` on the cut-over deployment.
