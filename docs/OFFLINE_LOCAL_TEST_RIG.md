# Testing Offline Mode On This Machine

A two-node rig that runs the whole offline architecture locally, so you can pull
the plug and watch the POS keep selling.

**Nothing here touches production.** The rig reads `SERVER/.env.offline-test`
and never your real `.env`. Its cloud is the **test** Neon branch
(`ep-lingering-bonus`), proven isolated from production (`ep-frosty-moon`) by a
marker-table check. Sales you ring up here upload *there*.

---

## The shape of it

```
   EDGE NODE  :4401          <- THE TILL. Use this one.
   SQLite mirror                 Keeps selling when the cloud is down.
        |
        |  signed HTTP
        v
   CLOUD NODE :4400          <- Head office. Stop it to simulate an outage.
        |
        v
   Test Neon branch
```

Both are the same code with different env vars — exactly as in production.

---

## First run

```powershell
cd SERVER
.\scripts\offline-test.ps1 provision   # build + verify the till's mirror (~50s)
.\scripts\offline-test.ps1 start       # start both nodes
```

`provision` refuses rather than hands you a bad till. It checks 15 things,
including that cursors point at rows the mirror actually holds — a cursor
written ahead of its data means tomorrow's sync silently skips rows forever.

Then open **http://localhost:4401** and log in:

| Role | Email | Password |
|---|---|---|
| Cashier | `cashier@cexpos.local` | `Cashier@123` |
| Manager | `manager@cexpos.local` | `Manager@123` |
| Owner | `owner@cexpos.local` | `Owner@123` |

---

## The actual test — a day without internet

```powershell
.\scripts\offline-test.ps1 offline     # kill the cloud. This is the outage.
```

Now go and use the POS at :4401. Open a register, scan, take payments, create
customers, process a return. **Everything must keep working.**

Watch the queue grow:

```powershell
.\scripts\offline-test.ps1 status
```

Then close the day:

```powershell
.\scripts\offline-test.ps1 online      # link restored
# wait ~20s - connectivity needs two good probes before it trusts the link
.\scripts\offline-test.ps1 sync        # the night sync
.\scripts\offline-test.ps1 verify      # did everything arrive, to the paisa?
```

A clean result ends with:

```
  ✔ The till and the cloud agree. The offline day reconciled.
```

### Verified on 2026-08-06

5 sales rung up with the cloud process stopped, then drained:

```
  ✔ sale count                   local 5  cloud 5
  ✔ sale revenue                 local 4056.00  cloud 4056.00
  ✔ payment total                local 4056.48  cloud 4056.48
  ✔ inventory movements          local 5  cloud 5
  ✔ no duplicate sales in cloud  0
```

---

## Commands

| Command | What it does |
|---|---|
| `provision` | Builds a fresh, verified mirror. Refuses if the queue holds unsent sales. |
| `start` | Starts both nodes. |
| `offline` | Stops the cloud. The outage. |
| `online` | Restarts the cloud. Does **not** sync. |
| `sync` | Runs the night sync (upload, then download). |
| `status` | Queue depth, connectivity, mirror size. |
| `verify` | Reconciles the till against the cloud. |
| `logs` | Last lines of both nodes. |
| `stop` | Stops both. |
| `reset` | Deletes the mirror. **Un-uploaded sales are lost.** |

---

## Things that will confuse you

**`sync` says "no connection to the cloud" right after `online`.** Correct
behaviour. Connectivity uses hysteresis — two consecutive good probes at 10s
intervals — so a flapping link cannot start a sync it can't finish. Wait ~20s
and check `status` shows `online`.

**The queue has items before you sell anything.** Logging in writes an audit
row, and audit rows sync. Capture is working.

**Sync takes ~50 seconds for a handful of items.** The test branch is in
`us-east-1`; from India that is ~270 ms per round trip. Your *production*
database has the same latency (~253 ms measured), so this is realistic, not a
rig artifact. Budget ~570 ms per queue item: a 3,000-sale day is roughly two
hours to drain overnight.

**`verify` compares only this till's sales.** The cloud legitimately holds rows
the till never had. An early version compared raw totals and reported six
failures when the sync was perfect — the difference was one pre-existing
28-July sale.

---

## If something breaks

```powershell
.\scripts\offline-test.ps1 logs
```

**"Walk-In customer not initialized."** The singleton `isWalkIn` customer is
missing — every anonymous checkout needs it. Restore it:

```powershell
$env:DATABASE_URL="<test branch url>"
npx tsx scripts/ensure-walkin.ts
.\scripts\offline-test.ps1 provision    # re-download so the till gets it
```

**Provisioning refuses with "no stress-test data".** The *cloud* holds `E2E-`
rows from an earlier harness run, and it will not build a till from
contaminated data. Clean it:

```powershell
$env:DATABASE_URL="<test branch url>"
npx tsx scripts/clean-test-branch.ts --dry-run   # look first
npx tsx scripts/clean-test-branch.ts
```

**Cloud node won't start, `DatabaseNotReachable`.** Neon auto-suspends idle
branches. Run `start` again; the second attempt wakes it.

---

## Two real bugs this rig found

Worth knowing, because both were invisible to the automated harnesses.

### 1. Every sale on a till was impossible

`scalarListBridge.ts` walks Prisma's arguments to rewrite `imageUrls` /
`workingDays`, rebuilding objects with `{ ...source }`. A `Prisma.Decimal`
keeps its digits in own *enumerable* properties — `Object.keys()` on one gives
`["constructor","s","e","d"]` — so the copy produced a plain object and Prisma
rejected the write:

```
Invalid value for argument `constructor`: We could not serialize
[object Function] value.
```

Opening a cash register carries a Decimal, and no register means no sale. **The
till could not sell at all.** `sync:validate` missed it because it writes
through repositories directly rather than through the HTTP checkout path.

Fixed with an `isOpaqueValue` guard. It matches Decimals by *shape*
(`s`/`e`/`toFixed`), not by `constructor.name` — the bundled client minifies the
class to `Decimal2`, so a name check silently fails and the bug returns. Locked
in by `src/offline/__tests__/scalarListBridge.test.ts` (8 tests).

### 2. `--with-cloud` measured nothing

`sync:stress --with-cloud` printed `cloud: yes` and produced a green run with no
cloud section. The flag's only effect was to **suppress the "NOT measured"
warning** — turning an honest gap into a run that looked like it had covered the
upload path. It now refuses with exit 2. See
[PHASE8 §5](PHASE8_NEON_BRANCH_VALIDATION_REPORT.md).

---

## What this rig does *not* prove

It runs on a **development laptop**. It cannot tell you how the software behaves
on the shop's actual till, and that is still the blocking gate before Offline
Mode goes live:

- **fsync cost** — `synchronous = FULL` fsyncs on every commit. A cheap eMMC
  cashier PC can be many times slower than this laptop's NVMe, and that sets the
  floor under every checkout.
- **Peripherals** — no receipt printer, barcode scanner or cash drawer here.
- **Real catalog volume** — the test branch holds 3 products. Yours will hold
  far more, and provisioning time scales with it.

Run `npm run sync:stress` on the real till and fill in
[PHASE6_REAL_TILL_STRESS_REPORT.md](PHASE6_REAL_TILL_STRESS_REPORT.md) before
enabling Offline Mode in the shop.

---

## Related

- [OFFLINE_FIRST.md](OFFLINE_FIRST.md) — the architecture
- [PHASE8_NEON_BRANCH_VALIDATION_REPORT.md](PHASE8_NEON_BRANCH_VALIDATION_REPORT.md) — the Neon-branch validation
- [TILL_PROVISIONING_RUNBOOK.md](TILL_PROVISIONING_RUNBOOK.md) — provisioning a real till
