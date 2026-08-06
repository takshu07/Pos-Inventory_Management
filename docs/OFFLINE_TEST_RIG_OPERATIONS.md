# Offline Test Rig — Startup, Failure Modes, Recovery

Operational companion to [OFFLINE_LOCAL_TEST_RIG.md](OFFLINE_LOCAL_TEST_RIG.md).
That document explains *what the rig proves*; this one explains *how it starts,
what goes wrong, and how to get back to a known-good state*.

Everything here is driven by `SERVER/scripts/offline-test.ps1`, which reads
`SERVER/.env.offline-test` and never your real `.env`.

---

## Driving it from the browser

The rig's nodes are API servers; they do **not** serve the React build. So the
UI is `npm run dev` in `CLIENT/`, and the only thing that decides whether you are
using the till or an ordinary online server is **which port the client talks to**.

`CLIENT/.env.local` (gitignored, machine-local) pins it to the till:

```
VITE_API_URL="http://localhost:4401/api/v1"
```

⚠ **Without this file the client falls back to `http://localhost:3000/api/v1`** —
the normal dev server, talking straight to Neon. Everything appears to work, the
rig's `offline` command appears to change nothing, and the test proves nothing at
all. Delete the file to go back to normal development; restart Vite after either
change, because Vite reads env only at startup.

| You want | Run | Client points at |
|---|---|---|
| The offline till | `offline-test.ps1 start` + `npm run dev` | `4401` (SQLite) |
| Head office / cloud | same, but `VITE_API_URL=…:4400/api/v1` | `4400` (Neon) |
| Ordinary development | `npm run dev` in `SERVER/` | `3000` (Neon, no rig) |

A full offline day, start to finish:

```powershell
cd SERVER
.\scripts\offline-test.ps1 start      # both nodes up
.\scripts\offline-test.ps1 offline    # cut the link — the shop's router "dies"
#   ... sell in the browser at localhost:5173: scan, take payment, print ...
.\scripts\offline-test.ps1 status     # queue growing, connectivity: offline
.\scripts\offline-test.ps1 online     # link restored (wait ~20s for hysteresis)
.\scripts\offline-test.ps1 sync       # drain the queue
.\scripts\offline-test.ps1 verify     # till and cloud must agree
```

`verify` is the one that matters — it reconciles sale counts, revenue, payments,
inventory movements and the receipt ledger across both databases independently of
whatever the sync run reported about itself.

---

## The startup sequence

The order below is not arbitrary. Each step exists because skipping it produced
a failure that looked like something else.

```
provision ─┬─ 1. stop the edge node, wait for the port to be FREE
           ├─ 2. wake the test Neon branch  (warm-test-branch.mjs)
           ├─ 3. start the cloud node
           ├─ 4. wait for /health/ready     (not just the port)
           ├─ 5. snapshot existing .superseded- mirrors
           └─ 6. run provision-till.ts in a CHILD shell

start ─────┬─ 1. stop BOTH nodes, wait for both ports to be free
           ├─ 2. warn if a non-empty WAL is present
           ├─ 3. wake the branch
           ├─ 4. cloud up → /health/ready
           └─ 5. edge up

offline ───┬─ 1. stop the cloud, wait for the port to be FREE
           └─ 2. refuse if the till is not running

online ────┬─ 1. wake the branch (it idled through the whole outage)
           ├─ 2. cloud up → /health/ready
           └─ 3. remind that connectivity needs two good probes
```

### Why each wait exists

| Step | Without it |
|---|---|
| Wait for the port to be **free**, not just signalled | `Stop-Process` returns before Windows releases the handle. Provisioning then cannot rename the mirror, because a dying process still holds it. |
| Wake the Neon branch first | A suspended branch refuses connections rather than answering slowly. The cloud node fails at boot and the rig looks flaky. |
| `/health/ready`, not the port | Express binds the port before the Postgres pool is usable. Provisioning that starts too early fails at DOWNLOAD and rolls back a mirror that was never at fault. |
| Stop the edge during provisioning | The edge holds an open handle to the file being quarantined, and `provision-till.ts` can only close its own. It also stops a sale landing in a mirror that is midway through being replaced. |

---

## Environment isolation — why the rig uses a child shell

`dotenv` **does not overwrite a variable that is already set.** That single fact
caused the rig's most confusing class of bug.

If the rig set `OFFLINE_ROLE=edge` in your shell, it stayed set. The next
`npm run dev` in that same terminal then:

- resolved as an **edge till**, not your normal dev server,
- served from the **test SQLite mirror** instead of your database,
- ignored `DATABASE_URL` from `.env` entirely — and after `provision`, which
  removed that variable, booted with **no database at all**.

Both symptoms look like application bugs. Neither is.

So every command that needs rig variables runs in a **child** PowerShell
(`Invoke-InRigEnv`), whose environment dies with it. The shell you typed into is
never modified.

Provisioning additionally sets `DOTENV_CONFIG_PATH` to `.env.offline-test`, because
removing `DATABASE_URL` from the child is not enough on its own — `provision-till.ts`
imports `dotenv/config`, which would re-inject it straight back from the real `.env`.

**To confirm isolation at any time**, run a rig command and then:

```powershell
'OFFLINE_ROLE','OFFLINE_MODE_ENABLED','LOCAL_DATABASE_PATH','DATABASE_URL' |
    ForEach-Object { "$_ = " + [Environment]::GetEnvironmentVariable($_) }
```

All four must be empty.

---

## Neon cold starts

An idle Neon branch auto-suspends. The first connection afterwards does not wait
— it **errors**. That is why the old runbook said "run `start` again; the second
attempt wakes it".

`scripts/warm-test-branch.mjs` makes the wait explicit and bounded:

```powershell
node scripts/warm-test-branch.mjs --timeout 90
```

- Retries through `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `57P03` and similar
  "still resuming" errors.
- **Fails immediately** on `28P01` (bad password) and `3D000` (no such database).
  These never clear by waiting, and burning 90s before reporting a wrong
  credential helps nobody.
- Refuses outright if `TEST_DATABASE_URL` points at production.

Typical cold start observed on this rig: **2.5–7s, 1–2 attempts.**

---

## Failure modes

### `PENDING_UPLOADS` — provisioning refused

```
✖ BLOCKING [PENDING_UPLOADS]
    The existing mirror holds N un-uploaded queue item(s).
```

**This is the system working.** Those rows are the only copy of that money.
`-Force` does **not** override it, and no flag at any level does.

Recovery — drain, then rebuild:

```powershell
.\scripts\offline-test.ps1 start
# wait ~20s for connectivity hysteresis
.\scripts\offline-test.ps1 sync
.\scripts\offline-test.ps1 status      # pending must be 0
.\scripts\offline-test.ps1 provision -Force
```

### `DATABASE_NOT_EMPTY` — provisioning refused

The mirror exists and holds data, but its queue is clean, so nothing is at risk.
On a real till this demands a deliberate confirmation. On this rig it is just a
rebuild of test data:

```powershell
.\scripts\offline-test.ps1 provision -Force
```

### `Walk-In customer not initialized.` — the till cannot sell

Every anonymous checkout resolves to the singleton `customers` row with
`isWalkIn = true`. Without it, checkout throws and **no sale can be rung at all**.
It is easy to lose, because it is an ordinary customer row that name-keyed
cleanup can take with the test data.

Recovery — restore it in the **cloud**, then bring it to the till:

```powershell
$cfg = @{}; Get-Content .env.offline-test | ForEach-Object {
    if ($_ -notmatch '^\s*#' -and $_ -match '=') { $k,$v = $_ -split '=',2; $cfg[$k.Trim()] = $v.Trim().Trim('"') } }
$env:DATABASE_URL = $cfg["TEST_DATABASE_URL"]
npx tsx scripts/ensure-walkin.ts
```

Then either `sync` (it arrives as a downloaded Customer row) or
`provision -Force`. `sync` is faster and does not disturb the queue.

### The cloud node will not start

Check `/health/ready` rather than guessing:

```powershell
Invoke-RestMethod http://localhost:4400/health/ready
```

- No response at all → see `SERVER/logs/offline-test-cloud.log`.
- `not_ready` → the Postgres pool is down; run `warm-test-branch.mjs` by hand.
- `28P01` in the log → the branch's credentials are wrong. A branch that was
  deleted and recreated reports this even though the password never changed;
  `.env.offline-test` needs the new URL.

### `sync` says there is no connection right after `online`

Correct behaviour. Connectivity uses hysteresis — two consecutive good probes at
10s intervals — so a flapping link cannot start a sync it cannot finish. Wait
~20s and confirm `status` shows `connectivity : online`.

### A node is running that you did not start

`start` now stops both nodes and waits for both ports before launching. If it
still reports a port in use, a stray process survived:

```powershell
Get-NetTCPConnection -LocalPort 4400,4401 -State Listen |
    Select-Object LocalPort, OwningProcess
```

### PowerShell parse errors after editing the script

`offline-test.ps1` must stay **CRLF with a UTF-8 BOM**. Windows PowerShell 5.1
only recognises a here-string's closing `"@` when it is followed by CRLF, and it
decodes a BOM-less file as ANSI — mangling the box-drawing characters and
em-dashes into bytes that can break the parse. Both faults report a missing brace
hundreds of lines from the real cause.

`.gitattributes` pins `*.ps1` to `eol=crlf`. To check a file before running it:

```powershell
$e=$null
[System.Management.Automation.Language.Parser]::ParseFile("$PWD\scripts\offline-test.ps1",[ref]$null,[ref]$e)
$e   # empty means it parses
```

---

## Mirror preservation

An existing mirror is **never deleted**. It is renamed to
`pos-local.db.superseded-<timestamp>` — all three WAL files (`.db`, `-wal`,
`-shm`), because moving only the `.db` hands the next process a WAL belonging to
a database that is no longer there, which SQLite reports as corruption.

Two layers restore it:

1. **`provision-till.ts`** rolls back its own quarantine whenever a stage fails.
2. **`offline-test.ps1`** covers the case the provisioner cannot: an outright
   crash (exit 2) that leaves no live mirror. It snapshots the `.superseded-`
   files before the run and restores the one this run created.

The superseded copies are kept on purpose. Delete them once the till has
completed a successful sync:

```powershell
Remove-Item .\data\offline-test-till.db.superseded-* -Force
```

---

## A clean-slate reset

When the rig is in an unknown state and nothing on the till is worth keeping:

```powershell
.\scripts\offline-test.ps1 stop
Remove-Item .\data\offline-test-till.db* -Force      # includes -wal/-shm
.\scripts\offline-test.ps1 provision
.\scripts\offline-test.ps1 start
```

`reset` does the same with a confirmation prompt. **Un-uploaded sales in the
mirror are lost either way** — run `status` first and drain if `pending > 0`.

---

## The audit-log queue

Logging in writes an audit row, and audit rows sync. So the queue is
**expected to be non-zero before you sell anything** — usually 1 item after a
`status` or `sync` call, which each log in.

This is capture working, not a leak, and the behaviour is deliberately
unchanged. When reading queue depth, subtract the audit rows your own commands
generated before concluding that something is stuck.

---

## Related

- [OFFLINE_LOCAL_TEST_RIG.md](OFFLINE_LOCAL_TEST_RIG.md) — what the rig is and what it proves
- [OFFLINE_FIRST.md](OFFLINE_FIRST.md) — the architecture
- [TILL_PROVISIONING_RUNBOOK.md](TILL_PROVISIONING_RUNBOOK.md) — provisioning a real till
- [OFFLINE_ROLLBACK_RUNBOOK.md](OFFLINE_ROLLBACK_RUNBOOK.md) — backing Offline Mode out in production
