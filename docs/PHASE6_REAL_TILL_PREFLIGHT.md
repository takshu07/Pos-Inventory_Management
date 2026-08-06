# Phase 6 — Real Till Pre-Flight Package

**Status: NOT RUN. Go/No-Go = ⏳ PENDING.**

This document is the operator's package for executing the Phase 6 production
stress test on the **shop's actual till hardware**. It contains no results and no
estimates. The gate is not passed until [`PHASE6_REAL_TILL_STRESS_REPORT.md`](PHASE6_REAL_TILL_STRESS_REPORT.md)
is filled in with measured values from a real till run.

**Companion documents**
- [`PHASE6_PRODUCTION_STRESS_RUNBOOK.md`](PHASE6_PRODUCTION_STRESS_RUNBOOK.md) — the reference runbook (why, options, how to read results).
- [`PHASE6_REAL_TILL_STRESS_REPORT.md`](PHASE6_REAL_TILL_STRESS_REPORT.md) — the report template to fill in during/after the run.

This package is the **execution checklist**; the runbook is the **explanation**.
Where they overlap, this document wins, because it is written for the till.

---

## ⛔ The three unrecoverable mistakes

Read these before anything else. Each is one flag or one variable away.

| # | Mistake | Consequence |
|---|---|---|
| 1 | `LOCAL_DATABASE_PATH` pointing at `data/pos-local.db` | The harness **wipes** the mirror it is given. On a live till this destroys **every sale not yet uploaded**. The harness hard-refuses this exact basename — do not defeat it. |
| 2 | `DATABASE_URL` pointing at live Neon (`ep-frosty-moon-at71qpbs`) | Inserts thousands of `PSTRESS-…` sales into the real books. |
| 3 | Running `npm run db:local:setup` without `LOCAL_DATABASE_PATH` set | Pushes schema over the default path and can drop the till's real tables. Always set the variable **in the same command**. |

> A `data/pos-local.db` already exists in this checkout, so mistake #1 is live,
> not hypothetical. Verify the path every time — §C step 3.

---

## A. Deployment checklist for the till

Complete every row before touching a command in §B. This is about getting the
right code and the right hardware into the right state.

| # | Item | How to confirm | Done |
|---|---|---|---|
| A1 | Physical till computer, not a laptop or VM | You are sitting at the machine that runs the shop | ☐ |
| A2 | Shop is **closed** / no trading during the run | No one ringing up sales — otherwise CPU and responsiveness numbers describe the lunch rush, not the test | ☐ |
| A3 | Till otherwise idle | Close the POS client, browsers, backup agents, Windows Update not mid-install | ☐ |
| A4 | Mains power, not battery | A power-saving CPU governor invalidates every latency number | ☐ |
| A5 | Repo checked out on the till | `git -C <repo> rev-parse --show-toplevel` | ☐ |
| A6 | Branch is `feature/offline-first-sync` | §C step 1 | ☐ |
| A7 | Working tree clean at a known commit | `git status --short` empty; record the SHA in the report | ☐ |
| A8 | Node.js installed, version recorded | `node --version` | ☐ |
| A9 | `npm ci` completed **on the till** | §C step 2 — native SQLite binding must be built for *this* machine | ☐ |
| A10 | Free disk space ≥ 5 GB on the volume holding `SERVER/data/` | The stress `.db` + WAL grows with transaction count | ☐ |
| A11 | Network reachable (for the cloud half) | `ping` / browser to the Neon host | ☐ |
| A12 | Neon account access to create a branch | Console login or `neonctl` authenticated | ☐ |
| A13 | Receipt **printer** connected and powered | §C step 6 | ☐ |
| A14 | Barcode **scanner** connected | §C step 6 | ☐ |
| A15 | **Cash drawer** connected (usually via the printer's RJ11 kick port) | §C step 6 | ☐ |
| A16 | Somebody who can authorise a No-Go is reachable | The decision in §H is a human's, not the harness's | ☐ |

> **On A13–A15:** the stress harness itself does **not** drive the printer,
> scanner or drawer — it exercises the database, sync engine and machine.
> They are on this checklist because Phase 6 is the last gate before Offline
> Mode is enabled on this hardware, and a till that passes the stress test but
> cannot open its drawer is still not deployable. Verify them as peripherals of
> the machine under test, and record the result in the report.

---

## B. Setup commands

All commands run from the `SERVER` directory:

```powershell
cd <repo>\Pos-Inventory_Management\SERVER
```

Two shells are shown throughout. **Use one consistently** — mixing them is how
an environment variable silently fails to apply.

> **Never edit `SERVER/.env` to switch databases.** Line 12 is LIVE. Pass
> `DATABASE_URL=…` as a per-command override; `dotenv` does not overwrite an
> already-set variable. This is a verified property of this codebase, not a
> convention.

### B1. Create a fresh temporary Neon branch

**Option 1 — Neon CLI (`neonctl`)**

```bash
# Confirm you are authenticated and see which project you are about to branch
neonctl auth
neonctl projects list

# Create a disposable branch off production, named for this run
neonctl branches create \
  --project-id <NEON_PROJECT_ID> \
  --name phase6-stress-$(date +%Y%m%d) \
  --parent production

# Print the pooled connection string for the new branch
neonctl connection-string phase6-stress-$(date +%Y%m%d) \
  --project-id <NEON_PROJECT_ID> \
  --pooled
```

PowerShell equivalent for the branch name:

```powershell
$branch = "phase6-stress-$(Get-Date -Format yyyyMMdd)"
neonctl branches create --project-id <NEON_PROJECT_ID> --name $branch --parent production
neonctl connection-string $branch --project-id <NEON_PROJECT_ID> --pooled
```

**Option 2 — Neon console (fallback if `neonctl` is not installed/authed)**

1. Open the Neon console → select the POS project.
2. **Branches** → **Create branch**.
3. Name it `phase6-stress-<YYYYMMDD>`.
4. Parent: the production branch. Include data: **from parent (current state)**.
5. Create, then open the new branch → **Connection details**.
6. Copy the **pooled** connection string (`?sslmode=require`).

**Record it once, in the shell only — never in a file:**

```bash
# Bash / Git Bash
export STRESS_DATABASE_URL='postgresql://…ep-<your-branch>-pooler…/neondb?sslmode=require'
```

```powershell
# Windows PowerShell
$env:STRESS_DATABASE_URL = 'postgresql://…ep-<your-branch>-pooler…/neondb?sslmode=require'
```

> ⚠ **The branch host must NOT be `ep-frosty-moon-at71qpbs`.** That is live.
> Read the host in the string you just pasted, out loud, before continuing.

### B2. Apply migrations to the branch

```bash
# Bash / Git Bash
DATABASE_URL="$STRESS_DATABASE_URL" npx prisma migrate deploy --config prisma.config.ts
```

```powershell
# Windows PowerShell
$env:DATABASE_URL = $env:STRESS_DATABASE_URL
npx prisma migrate deploy --config prisma.config.ts
Remove-Item Env:\DATABASE_URL   # unset again so nothing inherits it by accident
```

Confirm the offline tables arrived — this migration is what the cloud half needs:

```bash
DATABASE_URL="$STRESS_DATABASE_URL" npm run sync:verify-migration
```

Expected: the migration `20260805090000_offline_first_sync_cloud_tables` is
applied and the four sync tables exist. If it reports drift, **stop** and resolve
before running the gate.

### B3. Configure a dedicated local SQLite database

The harness truncates whatever mirror it is given, so it gets its own file.

```bash
# Bash / Git Bash
LOCAL_DATABASE_PATH=./data/phase6-real-till.db npm run db:local:setup
```

```powershell
# Windows PowerShell
$env:LOCAL_DATABASE_PATH = "./data/phase6-real-till.db"
npm run db:local:setup
```

> A path is **safe** only if its basename is neither `pos-local.db` nor any file
> holding real un-uploaded sales. `phase6-real-till.db` is a fresh name chosen so
> it cannot collide with the existing `pos-local.db`, `pos-stress.db` or
> `e2e-validation.db` in `SERVER/data/`.
>
> A fresh path has **no tables** until `db:local:setup` runs. Skipping this gives
> a "no sync_queue table" failure.

### B4. Verify isolation with a marker-row write

**This is the only reliable proof you are off production.** Neon branches are
copy-on-write forks and **share a `system_identifier` with production**, so that
value can never prove isolation. Write a marker to the branch, then confirm live
cannot see it.

```bash
# 1. Write a marker row to the BRANCH
DATABASE_URL="$STRESS_DATABASE_URL" npx tsx -e "
  import { PrismaClient } from '@prisma/client';
  const db = new PrismaClient();
  const marker = 'PHASE6-MARKER-' + Date.now().toString(36);
  await db.\$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS phase6_isolation_marker (id text primary key, created_at timestamptz default now())'
  );
  await db.\$executeRawUnsafe('INSERT INTO phase6_isolation_marker (id) VALUES (\$1)', marker);
  console.log('MARKER WRITTEN TO BRANCH:', marker);
  await db.\$disconnect();
"
```

Record the printed marker value. Then, **read-only**, against live:

```bash
# 2. Confirm LIVE cannot see it. Uses the .env DATABASE_URL — no override.
npx tsx -e "
  import { PrismaClient } from '@prisma/client';
  const db = new PrismaClient();
  const rows = await db.\$queryRawUnsafe(
    \"SELECT to_regclass('public.phase6_isolation_marker') AS table_exists\"
  );
  console.log('LIVE sees marker table:', rows);
  await db.\$disconnect();
"
```

**Interpretation — this is a hard gate:**

| Result on live | Meaning | Action |
|---|---|---|
| `table_exists: null` | The marker table does not exist on live. **Isolation proven.** | ✅ Proceed |
| `table_exists: 'phase6_isolation_marker'` | You wrote to production, or both strings point at the same database | ⛔ **STOP.** Do not run the gate. Drop the table from live, re-derive the branch string. |

Record both the marker value and the live result in the report — they are the
evidence that the run did not touch the real books.

### B5. Determine the shop's real workload size

The gate must be sized to the shop, not to the harness defaults. Read the real
figures from live, **read-only**:

```bash
# Catalog size and busiest-day sales count — READ ONLY against live
npx tsx -e "
  import { PrismaClient } from '@prisma/client';
  const db = new PrismaClient();
  const catalog = await db.\$queryRawUnsafe(
    'SELECT (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM product_variants) AS variants'
  );
  const busiest = await db.\$queryRawUnsafe(
    \"SELECT DATE(\\\"saleDate\\\") AS day, COUNT(*) AS sales FROM sales GROUP BY 1 ORDER BY sales DESC LIMIT 5\"
  );
  console.log('CATALOG:', catalog);
  console.log('BUSIEST DAYS:', busiest);
  await db.\$disconnect();
"
```

> Table names are lowercase because Prisma `@@map` renames them — `products`,
> `product_variants`, `sales`. Raw SQL against the Prisma-managed schema must use
> these, not the model names.

Fill in and carry forward:

| Symbol | Meaning | Value |
|---|---|---|
| `<PRODUCT_COUNT>` | Real catalog size (products) | ________ |
| `<TXN_COUNT>` | Busiest single day's sales count | ________ |
| `<TXN_COUNT_3X>` | `<TXN_COUNT>` × 3 — the headroom run | ________ |

---

## C. Pre-run checklist

Run these **on the till, in order, immediately before the gate**. Every one is a
command with an expected output — do not tick from memory.

**1. Correct branch**

```bash
git rev-parse --abbrev-ref HEAD     # expect: feature/offline-first-sync
git rev-parse --short HEAD          # record this SHA in the report
git status --short                  # expect: empty
```
☐ On `feature/offline-first-sync`, clean tree, SHA recorded.

**2. Dependencies installed**

```bash
npm ci                              # on the till itself
node --version
npx tsc --noEmit                    # expect: no output
```
☐ `npm ci` completed on this machine, TypeScript clean.

**3. Local database path is safe** ← *the highest-risk check*

```bash
# Bash / Git Bash
echo "$LOCAL_DATABASE_PATH"
```
```powershell
# Windows PowerShell
$env:LOCAL_DATABASE_PATH
```
☐ Prints `./data/phase6-real-till.db`.
☐ It is **not** `pos-local.db`, and not any path holding real sales.
☐ `SERVER/data/pos-local.db` still exists and is untouched (check its timestamp
   now, and again after the run).

**4. Temporary Neon branch is in use**

```bash
echo "$STRESS_DATABASE_URL" | sed -E 's#:[^:@]*@#:****@#'
```
☐ Host is the `phase6-stress-*` branch.
☐ Isolation marker (§B4) written to the branch and **not** visible on live.

**5. Production database is NOT in use**

```bash
echo "$STRESS_DATABASE_URL" | grep -c 'ep-frosty-moon-at71qpbs'   # expect: 0
```
☐ Returns `0`. If it returns `1`, **stop** — that is live.
☐ `SERVER/.env` has **not** been edited (`git diff --stat -- SERVER/.env` empty).
☐ You will pass `DATABASE_URL` per-command, never export it globally for the session.

**6. Peripherals connected**

| Device | Check | Done |
|---|---|---|
| Receipt printer | Powered, online, paper loaded; prints a test page from OS printer settings | ☐ |
| Barcode scanner | Open a text editor, scan any product barcode, characters appear | ☐ |
| Cash drawer | Connected to the printer's kick port; opens on a test kick or a POS test sale | ☐ |

☐ All three verified, results recorded in the report's peripherals section.

**7. Baseline state captured**

```bash
# Note free disk and memory before the run
node -e "const os=require('os');console.log('free mem GB', (os.freemem()/1e9).toFixed(1))"
```
☐ Free memory and disk recorded.

> **If any box in §C is unticked, do not run §D.** An unticked box is a No-Go by
> definition — see §H.

---

## D. Execution commands

### D1. Local-only rehearsal (no cloud, ~5 min)

Proves the hardware before involving the network. Safe: no cloud credentials used.

```bash
# Bash / Git Bash
LOCAL_DATABASE_PATH=./data/phase6-real-till.db \
  npm run stress:production -- --local-only \
    --products <PRODUCT_COUNT> --transactions <TXN_COUNT>
```

```powershell
# Windows PowerShell
$env:LOCAL_DATABASE_PATH = "./data/phase6-real-till.db"
npm run stress:production -- --local-only --products <PRODUCT_COUNT> --transactions <TXN_COUNT>
```

> This run **skips** sync, reconciliation and duplicate detection. It is a
> rehearsal, **not** the gate. It cannot produce a Go.

### D2. The full production gate (real catalog, busiest day)

```bash
# Bash / Git Bash
LOCAL_DATABASE_PATH=./data/phase6-real-till.db \
DATABASE_URL="$STRESS_DATABASE_URL" \
  npm run stress:production -- \
    --i-accept-writes-to-this-database \
    --products <PRODUCT_COUNT> \
    --transactions <TXN_COUNT>
```

```powershell
# Windows PowerShell
$env:LOCAL_DATABASE_PATH = "./data/phase6-real-till.db"
$env:DATABASE_URL = $env:STRESS_DATABASE_URL
npm run stress:production -- --i-accept-writes-to-this-database --products <PRODUCT_COUNT> --transactions <TXN_COUNT>
Remove-Item Env:\DATABASE_URL
```

**`--i-accept-writes-to-this-database` is required** because a Neon branch
hostname contains no `test`/`staging`/`branch` token, so the automatic guard
cannot clear it. **Read the URL the harness prints before you type that flag.**
Typing it reflexively is how mistake #2 happens.

### D3. Headroom run (3× the busiest day)

Answers "does it still hold when the shop grows or has a record day?"

```bash
LOCAL_DATABASE_PATH=./data/phase6-real-till.db \
DATABASE_URL="$STRESS_DATABASE_URL" \
  npm run stress:production -- \
    --i-accept-writes-to-this-database \
    --products <PRODUCT_COUNT> \
    --transactions <TXN_COUNT_3X>
```

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--products` | 3000 | Catalog size — set to `<PRODUCT_COUNT>` |
| `--transactions` | 3000 | Sales in the simulated day — set to `<TXN_COUNT>` |
| `--pace` | 2 | Milliseconds between sales. **Do not set 0** — it disables the responsiveness measurement entirely |
| `--interrupt-after` | 4000 | When to cut the socket mid-sync, in ms |
| `--local-only` | off | Skip the cloud half (rehearsal only) |
| `--i-accept-writes-to-this-database` | off | Required for a Neon branch target |

> **Capture the console output**, not just the JSON:
> ```bash
> … npm run stress:production -- … 2>&1 | tee reports/phase6-real-till-console.log
> ```
> On PowerShell use `| Tee-Object -FilePath reports\phase6-real-till-console.log`.

Each run writes `SERVER/reports/production-stress-<hostname>-<timestamp>.json`.
That file names the machine that produced it — it is the evidence.

---

## E. Acceptance thresholds

Two tiers. **Blocking thresholds** are enforced by the harness and fail the run.
**Review thresholds** are judgement calls a human signs off.

### E1. Blocking — harness-enforced

| # | Category | Metric | Threshold | Source |
|---|---|---|---|---|
| T1 | Latency | Checkout **write** latency p95 | **< 250 ms** | `THRESHOLDS.checkoutP95Ms` |
| T2 | Latency | Barcode scan (read) p95 | **< 50 ms** | `THRESHOLDS.scanP95Ms` |
| T3 | CPU / responsiveness | Event-loop delay p99 | **< 500 ms** | `THRESHOLDS.loopDelayP99Ms` |
| T4 | Memory | RSS peak | **< 1024 MB** | `THRESHOLDS.rssPeakMb` |
| T5 | Storage | Local database size on disk | **< 2048 MB** | `THRESHOLDS.databaseMb` |
| T6 | Queue | Every write captured | queue depth **== transactions × 4** exactly | hard assert |
| T7 | Queue | Idempotency keys unique across queue | distinct == total | hard assert |
| T8 | Recovery | Nothing stranded in flight after recovery | `IN_FLIGHT == 0` | hard assert |
| T9 | Recovery | No queue item lost to the interruption | survived == pre-cut total | hard assert |
| T10 | Sync | Queue fully drained | `PENDING == 0` | hard assert |
| T11 | Sync | No item failed permanently | `FAILED == 0` | hard assert |
| T12 | Reconciliation | Sale count matches local ↔ cloud | equal | hard assert |
| T13 | Reconciliation | **Revenue matches to the paisa** | \|Δ\| < ₹0.005 | hard assert |
| T14 | Reconciliation | No sale left behind | 0 missing | hard assert |
| T15 | Duplicates | **No duplicate sales in the cloud** | distinct sale numbers == row count | hard assert |
| T16 | Reconciliation | Payment count and total match | equal / \|Δ\| < ₹0.005 | hard assert |
| T17 | Reconciliation | Inventory movement count + net stock match | equal | hard assert |
| T18 | Reconciliation | Stock ledger agrees with the day's trade | net == −units sold | hard assert |
| T19 | Reconciliation | Sale item count matches | equal | hard assert |
| T20 | Reconciliation | Customers reached the cloud | equal | hard assert |
| T21 | Reconciliation | Report aggregate agrees across both databases | count + total equal | hard assert |
| T22 | Overall | Harness exit code | **`0`**, prints `✔ PASS`, zero `✖` | — |

**Any `✖` is a blocker. There is no "mostly passed".**

### E2. Review — human judgement

| # | Category | Metric | Guidance |
|---|---|---|---|
| R1 | Storage | fsync cost on the database volume | Harness warns ≥ 20 ms. This is the floor under every checkout. A high value predicts everything else being slow. |
| R2 | Throughput | Sales/second | Must comfortably exceed the shop's real peak rate. A busy day of `<TXN_COUNT>` sales over ~10 trading hours is a *low* average rate; what matters is the burst at the counter. Record the number and judge it against the queue at the till, not against the dev laptop. |
| R3 | CPU | CPU during trade | Harness warns at ≥ 90% of machine. Sustained near-100% means no headroom for the POS UI, printing, or a background sync. |
| R4 | Queue | Status aggregate p95 (polled by every till screen) | Harness warns ≥ 100 ms |
| R5 | Queue | Batch claim (50 items) p95 | Harness warns ≥ 200 ms |
| R6 | Sync | Synchronisation duration + projected full-day drain | Must fit comfortably inside the overnight window. If the projected drain approaches the hours the shop is closed, that is a No-Go regardless of the harness verdict. |
| R7 | Responsiveness | Event-loop delay reported as `NOT MEASURED` | **Not a pass.** Means the run was too short or `--pace 0` was used. Re-run. |
| R8 | Sync | Responsiveness *during* sync | The till must stay usable while the queue drains |
| R9 | Peripherals | Printer / scanner / drawer | All three functional on this machine |

**Reading the numbers honestly**

- **Event-loop delay has a floor of ~1 timer tick (~15 ms on Windows).** A p99 in
  the tens of milliseconds is the measurement floor, not a stall.
- **CPU can exceed 100% of one core** — it is CPU-time over wall-time and the
  native SQLite addon uses multiple threads. The "% of machine" figure is the one
  that matches Task Manager.
- **Throughput excludes injected think-time**, so `--pace` lengthens wall-clock
  without depressing throughput.
- **Expect the till to be materially slower than any dev laptop.** The local
  database runs `synchronous = FULL` and fsyncs four times per sale; eMMC or a
  spinning disk is commonly 5–20 ms against an NVMe's ~1.5 ms. That gap is the
  entire reason this run must happen here.

---

## F. Post-run verification checklist

| # | Check | Command / where | Done |
|---|---|---|---|
| F1 | Harness exit code was `0` | `echo $?` / `$LASTEXITCODE` immediately after the run | ☐ |
| F2 | Console printed `✔ PASS`, zero `✖` lines | Console log | ☐ |
| F3 | JSON report exists and `verdict` is `PASS` | `SERVER/reports/production-stress-*.json` | ☐ |
| F4 | Report `hostname` is the **till**, not a laptop | §0 of the report / JSON `machine.hostname` | ☐ |
| F5 | Report `workload` matches `<PRODUCT_COUNT>` / `<TXN_COUNT>` | JSON `workload` | ☐ |
| F6 | `localOnly` is `false` on the gate run | JSON `workload.localOnly` | ☐ |
| F7 | Every warning (`!`) reviewed and consciously accepted | Console log | ☐ |
| F8 | Interruption section shows recovery: 0 stranded, 0 lost | Console §5b | ☐ |
| F9 | Reconciliation shows revenue matching **to the paisa** | Console §6 | ☐ |
| F10 | Zero duplicate sales in the cloud | Console §6 | ☐ |
| F11 | **The till's real `data/pos-local.db` is untouched** — same size and mtime as before the run | `ls -l SERVER/data/pos-local.db` | ☐ |
| F12 | Live production has **no** `PSTRESS-` residue | §F-verify below | ☐ |
| F13 | Live production has no `phase6_isolation_marker` table | §B4 step 2, re-run | ☐ |
| F14 | Measured values transcribed into `PHASE6_REAL_TILL_STRESS_REPORT.md` | The report | ☐ |
| F15 | JSON report + console log attached to the sign-off | — | ☐ |
| F16 | Peripherals still functional after the run | Re-test printer / scanner / drawer | ☐ |
| F17 | Go/No-Go decision recorded with a named human | §H + report | ☐ |

**F12 — prove live is clean (read-only):**

```bash
npx tsx -e "
  import { PrismaClient } from '@prisma/client';
  const db = new PrismaClient();
  const sales = await db.sale.count({ where: { saleNumber: { startsWith: 'PSTRESS-' } } });
  console.log('LIVE PSTRESS sales (must be 0):', sales);
  await db.\$disconnect();
"
```

### Cleanup (only after F1–F17)

```bash
# The stress SQLite file — safe to delete, it is NOT the till's real database.
rm SERVER/data/phase6-real-till.db*
```

```powershell
Remove-Item SERVER\data\phase6-real-till.db*
```

Then delete the whole temporary Neon branch — cleaner than deleting rows:

```bash
neonctl branches delete phase6-stress-<YYYYMMDD> --project-id <NEON_PROJECT_ID>
```

> ⛔ Never run `npm run db:local:setup` against `data/pos-local.db` to "clean up".
> That destroys every un-uploaded sale on the till.
>
> **Keep the JSON report and console log** — they are the sign-off evidence, and
> the `.db` file should be kept too if the run **failed**, for diagnosis.

---

## G. Go/No-Go decision matrix

The decision is a **human's**, informed by the harness. The harness can produce a
No-Go on its own; it can never produce a Go on its own.

### G1. Conditions

| Condition | Result |
|---|---|
| Any §C pre-run box unticked | ⛔ **NO-GO** — the run is not valid; fix and re-run |
| Run did not happen on the till (`hostname` is a laptop) | ⛔ **NO-GO** — laptop numbers do not count |
| Run was `--local-only` only | ⛔ **NO-GO** — sync, reconciliation and duplicate detection uncovered |
| Harness exit code ≠ 0, or any `✖` | ⛔ **NO-GO** |
| **T13 revenue mismatch** | ⛔ **NO-GO — HARD STOP.** The books do not balance. Keep the report and `.db`; escalate. |
| **T15 duplicate sales** | ⛔ **NO-GO — HARD STOP.** Retry after interruption double-applied. |
| **T9 queue item lost** or **T8 items stranded** | ⛔ **NO-GO — HARD STOP.** Money-losing defect. |
| T12/T14/T16–T21 any reconciliation mismatch | ⛔ **NO-GO** — data loss or double-apply |
| T6 queue depth ≠ transactions × 4 | ⛔ **NO-GO** — change capture is dropping writes |
| T7 duplicate idempotency keys | ⛔ **NO-GO** — the anti-duplicate mechanism itself is broken |
| T10/T11 queue not drained / permanent failures | ⛔ **NO-GO** |
| T1–T5 any blocking threshold exceeded | ⛔ **NO-GO** — hardware or code cannot carry this shop |
| R7 responsiveness `NOT MEASURED` | ⚠ **NO-GO until re-run** — absence of data is not a pass |
| R6 projected drain does not fit the overnight window | ⛔ **NO-GO** — the queue would still be draining at open |
| Peripheral (printer / scanner / drawer) not functional | ⛔ **NO-GO for deployment** — the till is not usable even if the software passes |
| All blocking thresholds pass, but review items (R1–R6, R8) are materially worse than expected | ⚠ **CONDITIONAL GO** — named human accepts each, in writing, in the report. Consider a lower-risk cut-over (single till, close monitoring). |
| All T1–T22 pass, warnings reviewed and accepted, peripherals functional, run on the till at real workload, live proven clean | ✅ **GO** |

### G2. What a GO authorises

Only on ✅ **GO**:

1. Merge `feature/offline-first-sync`.
2. Set `OFFLINE_MODE_ENABLED=true` **on the cut-over deployment only** —
   it must remain `false` in `.env.example`, the Dockerfile and compose,
   permanently. Enabling is a per-deployment decision, and
   `src/offline/__tests__/defaultDisabled.test.ts` fails if that changes.

On ⛔ **NO-GO**: do **not** merge, do **not** enable Offline Mode anywhere.
Preserve the JSON report, console log and the stress `.db` file for diagnosis.

### G3. Current decision

> **⏳ PENDING — the stress test has not been executed on the till.**
>
> No measurement exists. No threshold has been evaluated. This package prepares
> the run; it does not constitute a result. The decision stays PENDING until
> `PHASE6_REAL_TILL_STRESS_REPORT.md` carries measured values from real till
> hardware and a named human records the outcome.

**Attempt of 2026-08-06 — blocked at §C, gate not run.** Six §C preconditions
failed on the attempting machine (`Tanishk-PC`, a development laptop): no till
hardware, no Neon branch tooling or credentials, `DATABASE_URL` resolving to
live production, and none of the three peripherals present. Full log:
[`PHASE6_REAL_TILL_STRESS_REPORT.md` §0](PHASE6_REAL_TILL_STRESS_REPORT.md).
Nothing was run against production and the till's `pos-local.db` was not touched.

---

## H. Escalation

| Situation | Action |
|---|---|
| Marker test shows live sees the marker | Stop everything. Drop `phase6_isolation_marker` from live. Re-derive the branch connection string. Do not re-run until isolation is proven. |
| Harness refuses to run (`REFUSING TO RUN`) | It is protecting you. Read which guard fired. **Do not add flags reflexively.** |
| Revenue / duplicate / lost-item failure | Hard stop. Preserve report + `.db` + console log. Escalate before any retry — a retry can mask the evidence. |
| Run crashed mid-way | Note the phase it died in, preserve artefacts, re-run from §C. A crash is not a pass and not a fail — it is an incomplete run. |
| Till's `pos-local.db` timestamp changed | Stop. Assume un-uploaded sales may be affected. Escalate before further runs. |
