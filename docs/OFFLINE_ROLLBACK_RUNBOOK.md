# Offline Mode — Rollback Runbook

**Audience:** whoever is turning Offline Mode off, possibly at 6am, possibly
because something is wrong.
**Scope:** disabling Offline Mode on a cloud node, an edge node (till), or a
whole fleet — and re-enabling it afterwards.

---

## 0. Read this first (30 seconds)

| | |
|---|---|
| **Is queued data lost when I disable Offline Mode?** | **No.** The queue lives in a SQLite file that the disabled server never opens. It is preserved in full and uploads when you re-enable. |
| **Do I need to rebuild or redeploy?** | **No.** The same build runs enabled or disabled. |
| **Do I need to reverse the migration?** | **No — and you must not.** See §7. |
| **Do I need to restart?** | **Yes. A full restart.** A watch-reload does *not* re-read the flag. |
| **What actually changes?** | One environment variable, `OFFLINE_MODE_ENABLED=false`. |
| **The single most dangerous mistake** | Running `npm run db:local:setup` or deleting `data/pos-local.db` to "clean up". Either **destroys every un-uploaded sale.** Neither is ever part of a rollback. |

> ⛔ **If you remember one thing:** rollback never deletes anything. If a step
> you are about to take deletes something, you are not following this runbook.

---

## 1. Decide which rollback you need

| Situation | Go to |
|---|---|
| Sync is misbehaving, but the till is selling fine | **§2 — partial rollback.** Try this first. |
| One till must come off Offline Mode | §4 — edge node |
| The central server must come off Offline Mode | §5 — cloud node |
| The whole fleet comes off Offline Mode | §6 — ordering matters |
| Something has already gone wrong | §8 — troubleshooting |

---

## 2. Partial rollback (prefer this)

If the **sync engine** is the problem but local operation is healthy, do not do
a full rollback. This stops the background drain while leaving capture running,
so nothing stops being recorded:

```bash
SYNC_AUTO_ENABLED=false     # full restart required
```

The queue keeps filling safely and can be drained by hand with
`POST /api/v1/sync/run` whenever you are ready. **Nothing is at risk in this
state** — it is the lowest-blast-radius lever available, and it is reversible by
flipping the variable back.

Escalate to a full rollback only if the problem is the local data path itself.

---

## 3. Configuration reference

These are the only variables a rollback touches.

| Variable | Rollback value | Why |
|---|---|---|
| `OFFLINE_MODE_ENABLED` | `false` (or remove the line) | The master switch. This alone is sufficient to disable. |
| `OFFLINE_ROLE` | **unset**, or `cloud` | Not required, but leaving `edge` behind is the classic rollback-hygiene mistake. Clear it. |
| `DATABASE_URL` | **must be set and valid** | ⚠ **Edge nodes only.** A till has none by design — see §4, step 3. |
| `SYNC_DEVICE_SECRET`, `SYNC_CLOUD_URL`, `OFFLINE_DEVICE_ID` | leave as they are | Inert while disabled. Keeping them makes re-enabling a one-variable change. |

**Do not change anything else.** In particular, do not touch
`LOCAL_DATABASE_PATH` — the disabled server ignores it, and changing it is how
you lose track of which file holds the queue.

---

## 4. Edge node (till) rollback

> ⚠ **The important asymmetry:** a disabled till stops using local SQLite and
> starts using the cloud database directly. Its queued sales are **not deleted**,
> but they become invisible to the application and will not upload until Offline
> Mode is switched back on. Drain first and this never matters.

### Step 1 — Drain the queue, while still enabled

```bash
curl -X POST localhost:3000/api/v1/sync/run \
     -H 'Content-Type: application/json' \
     -d '{"direction":"UPLOAD"}'
```

### Step 2 — Confirm the queue is empty. Do not skip this.

```bash
curl localhost:3000/api/v1/sync/status
```

Require **both**:

```
queue.pending  == 0
queue.inFlight == 0
```

If they do not reach zero, go to §8.1 before continuing. Rolling back with a
non-empty queue is *not* data loss, but those sales then exist **only on that
machine** until Offline Mode is re-enabled.

### Step 3 — Confirm `DATABASE_URL` is present and valid

⚠ **This is the trap that makes a rollback look like a broken till.** A till
normally has no `DATABASE_URL` at all — Offline Mode waives the requirement,
because production database credentials do not belong on shop-floor hardware.
Disable Offline Mode without adding one and the server **refuses to boot**:

```
Missing required environment variables: DATABASE_URL.
```

That refusal is deliberate — the alternative is a till that starts and then
fails at the first sale. The server now prints the full explanation and the fix
alongside that message. Set `DATABASE_URL` to the store's cloud connection
string before restarting.

### Step 4 — Apply the change and restart

```bash
OFFLINE_MODE_ENABLED=false
# and unset OFFLINE_ROLE
```

Then perform a **full process restart**. Not a watch-reload — the config is
memoized for the process lifetime and the SQLite handle is parked on
`globalThis`, so a reload leaves the old value live and the rollback silently
does not happen.

### Step 5 — Verify (§9)

---

## 5. Cloud node rollback

Low risk, and no drain step — a cloud node has no queue of its own.

```bash
OFFLINE_MODE_ENABLED=false      # or remove the offline block entirely
# full restart
```

On restart the server is byte-for-byte the pre-feature server: the offline
runtime returns immediately, and `/sync/download` and `/sync/upload` return
**404**. The four sync tables remain, populated and inert.

⚠ **Do not do this while tills are still enabled** — see §6.

---

## 6. Fleet ordering — edge first, cloud second

**Roll back every edge node before the cloud node.**

Disabling the cloud while tills are still enabled makes every upload 404. That
is survivable (the queue is preserved and retries) but each attempt counts
toward `SYNC_MAX_ATTEMPTS`, default 8. Items that exhaust it park as `FAILED`
and need an explicit `POST /api/v1/sync/retry` after you re-enable — manual toil
across every till, for no benefit.

```
1. Drain + disable each till          (§4)
2. Confirm all tills report role: "cloud"
3. Disable the cloud node             (§5)
```

If you must disable the cloud first, accept that a `POST /sync/retry` per till
is part of the recovery.

---

## 7. What a rollback must never do

| Action | Why not |
|---|---|
| `npm run db:local:setup` | Runs `prisma db push --accept-data-loss`. Against a live mirror this **can drop the queue**. It is the *install* step, never a rollback step. |
| Delete `data/pos-local.db` | Destroys every sale taken since the last successful upload. This is the only true data-loss path in the whole feature. |
| Reverse the Prisma migration | Dropping `sync_receipts` discards the idempotency ledger. A later re-enable would then **double-book every replayed sale**. The tables are additive and inert; leave them. |
| Rebuild or redeploy | Unnecessary. The flag is read at startup, not compiled in. Adds risk and downtime for nothing. |
| Purge the client cache | Unnecessary. The client holds no copy of the flag — it asks the server. |

**Retain `data/pos-local.db` untouched** until you have confirmed the queue
reached the cloud.

---

## 8. Troubleshooting

### 8.1 The queue will not drain

`GET /api/v1/sync/status` → check `connectivity.state`.

- **offline** — the till cannot reach the cloud. Fix connectivity, or postpone
  the rollback. Do **not** roll back to "fix" this; disabling strands the queue.
- **online, items FAILED** — `GET /api/v1/sync/queue?status=FAILED`, read
  `lastError`, then `POST /api/v1/sync/retry`.
- **online, still not draining** — check the cloud node is enabled and
  `/sync/upload` is not 404ing. A cloud node disabled ahead of its tills (§6) is
  the usual cause.

If the queue genuinely cannot be drained, you may still roll back — the data is
preserved. Record that the till has an undrained queue, and **do not** rebuild
or wipe its local database. Re-enable later and it will upload with its original
idempotency keys, so nothing double-books.

### 8.2 The server will not start after rollback

```
Missing required environment variables: DATABASE_URL.
```

You disabled Offline Mode on an edge node that has no cloud connection string.
See §4 step 3. The message now includes the full fix. **Do not** clear the error
by deleting the local database.

### 8.3 The rollback does not seem to have taken effect

The flag is only read at startup. Confirm with the boot log line:

```
offline: disabled — this node runs entirely on the cloud database
```

If you instead see `offline: initializing`, the process did not fully restart,
or the environment change did not reach it. A `tsx watch` reload is **not** a
restart.

### 8.4 The sync indicator is still visible on a rolled-back till

Confirm the boot line above, then `GET /api/v1/sync/status` — a disabled node
must return `role: "cloud"` and an empty queue regardless of what `OFFLINE_ROLE`
is set to. If it returns live queue counts, the process is still running the
enabled build; restart it properly.

---

## 9. Verification checklist

After any rollback:

- [ ] Boot log shows `offline: disabled — this node runs entirely on the cloud database`
- [ ] `GET /api/v1/sync/status` returns `role: "cloud"`, `queue.pending: 0`
- [ ] `GET /api/v1/sync/health` returns **200** with `healthy: true`
- [ ] The sync indicator is absent from the cashier UI
- [ ] Edge node: a test sale writes to the cloud database and is visible from another node
- [ ] `data/pos-local.db` still exists and has not been modified
- [ ] `OFFLINE_ROLE` is unset or `cloud` — no stale edge config left behind

---

## 10. Re-enabling after a rollback

Re-enabling restores the previous state by design, not by luck.

```bash
OFFLINE_MODE_ENABLED=true
OFFLINE_ROLE=edge                 # edge nodes only
# full restart
```

What happens automatically on that boot:

- Runs left in `RUNNING` → `INTERRUPTED`; items left `IN_FLIGHT` → `PENDING`.
- Capture triggers are reinstalled (every boot, not just the first).
- A capture-disabled flag is re-enabled and logged at ERROR.
- The preserved queue uploads with its **original idempotency keys**, and the
  cloud's receipt ledger answers a repeat key with the original outcome — so a
  queue that sat disabled for a week uploads exactly once. **No duplicates.**

### ⚠ The one real hazard: sales taken while disabled

If the node ran against the cloud database while disabled and **took sales
there**, re-enabling returns it to a local mirror that does not contain them.
Those sales are safe in the cloud, and arrive on the next download only if their
entities are in the download policy.

After re-enabling following any period of live cloud trading:

1. Force a download: `POST /api/v1/sync/run -d '{"direction":"DOWNLOAD"}'`
2. Check `GET /api/v1/sync/health` returns 200 with `captureTriggers.missing == 0`
3. Spot-check that sales taken during the disabled window are visible locally

### Re-enable ordering

**Cloud first, edges second** — the reverse of rollback. A till that comes up
before its cloud node will 404 its uploads and burn retry attempts.

---

## 11. Related documents

- [OFFLINE_FIRST.md](OFFLINE_FIRST.md) — architecture, configuration, monitoring
- [PHASE4_OFFLINE_MODE_GATE_AUDIT.md](PHASE4_OFFLINE_MODE_GATE_AUDIT.md) — the audit behind this runbook
- [PHASE5_DEPLOYMENT_READINESS_REPORT.md](PHASE5_DEPLOYMENT_READINESS_REPORT.md) — the fixes that closed its findings
