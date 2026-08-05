# Phase 4 — Offline Mode Gate Audit

**Date:** 2026-08-05
**Scope:** Read-only audit of the Offline Mode enable/disable gate on branch `feature/offline-first-sync`.
**Method:** Static review of every flag reference in `SERVER/src`, `CLIENT/src`, `prisma/`, deployment
files and docs. **No code, configuration, `.env`, database or deployment setting was modified.**

---

## 1. Executive Summary

Offline Mode is gated by a **single environment variable, `OFFLINE_MODE_ENABLED`**, resolved in exactly
one module ([config.ts](../SERVER/src/offline/config.ts)) and defaulting to **false**. The gate is
**startup-controlled**, not build-time: the same compiled artifact runs enabled or disabled, so rollback
is a config change plus a process restart — **no rebuild, no redeploy, no migration reversal**.

The design is sound and the safety posture is genuinely good — better than most feature flags of this
blast radius. Confirmed by inspection:

- The default is false, is fail-safe against typos (`ture` → disabled), and is **pinned by a test suite**
  ([defaultDisabled.test.ts](../SERVER/src/offline/__tests__/defaultDisabled.test.ts)) that also asserts
  `.env.example`, the Dockerfile, the compose file and every CI workflow do not enable it.
- Nothing committed to the repo turns it on. The live `SERVER/.env` contains **no offline variables at all**.
- The four cloud tables are purely additive and referenced by nothing in the existing schema, so disabling
  leaves no dangling constraint.
- Disabling **does not delete queued data**. The queue lives in a SQLite file that the disabled path never
  opens, let alone writes.

Three findings qualify that verdict. One is a real correctness gap:

| # | Finding | Severity |
|---|---|---|
| **F1** | Two endpoints (`/sync/status`, `/sync/health`) gate on `role`, **not** on `enabled`. With `OFFLINE_MODE_ENABLED=false` and a leftover `OFFLINE_ROLE=edge`, they open SQLite anyway — the one path where "disabled" is not fully inert. | **Medium** |
| **F2** | Rollback on an **edge** node is not symmetric with rollback on a cloud node: a disabled edge node silently switches its operational database from SQLite to Neon, stranding (not deleting) the queue. This is correct behaviour but is **undocumented**, and is the scenario most likely to be mishandled under pressure. | **Medium** |
| **F3** | `docs/OFFLINE_FIRST.md` §9 documents `SYNC_UPLOAD_BATCH_SIZE` as `200`; the code default is `50`, deliberately lowered to fit Neon's transaction budget. A deployment following the doc reintroduces a known-fixed failure. | **Low** |

**Verdict: Offline Mode can be safely enabled and rolled back in production on a *cloud* node today.**
Edge-node rollback is safe but requires the drain-first procedure in §4.3 to be followed, and F1 should be
closed before the first edge cutover. Details in §10.

---

## 2. Offline Mode Source of Truth

### 2.1 The single source

**[`SERVER/src/offline/config.ts`](../SERVER/src/offline/config.ts)** is the sole reader of the flag:

```
config.ts:152    enabled: readBool("OFFLINE_MODE_ENABLED", false)
```

`resolveOfflineConfig()` reads the environment once; `offlineConfig()` memoizes the result for the process
lifetime. The module header states the invariant explicitly: *"Nothing else in `src/offline/` reads
`process.env` directly."* **Verified — that claim holds.** A repository-wide search for
`OFFLINE_MODE_ENABLED` returns only this one functional read; every other occurrence is documentation,
a test, or a `.env.example` comment.

Two derived helpers are the intended consumption points, and both correctly conjoin the master switch:

```
config.ts:268    isEdgeNode()  → config.enabled && config.role === "edge"
config.ts:274    isCloudNode() → config.enabled && config.role === "cloud"
```

### 2.2 Consumers of the gate

| Consumer | File | Gate used | Correct? |
|---|---|---|---|
| Datasource routing | `offline/datasource/router.ts:162` | `isEdgeNode()` | ✅ |
| `DATABASE_URL` requirement waiver | `config/prisma.ts:48` | `isEdgeNode()` | ✅ |
| Runtime startup | `offline/runtime.ts:51` | `config.enabled` | ✅ |
| Runtime shutdown | `offline/runtime.ts:107` | `config.enabled` | ✅ |
| Sync engine start | `offline/sync/engine.ts:386` | `isEdgeNode()` | ✅ |
| Device auth (`/download`, `/upload`) | `offline/api/deviceAuth.middleware.ts:155` | `config.enabled` → 404 | ✅ |
| **`GET /sync/status`** | `offline/api/sync.controller.ts:182` | **`config.role !== "edge"`** | ❌ **F1** |
| **`GET /sync/health`** | `offline/api/sync.controller.ts:300` | **`config.role !== "edge"`** | ❌ **F1** |

### 2.3 Duplicate or conflicting gates

**No duplicate source of truth exists.** There is no second flag, no database-stored toggle, no client-side
flag, and no build-time define. `OFFLINE_ROLE` is a *selector*, not a second gate — it is meaningless while
`enabled` is false, **except** in the two F1 endpoints, which is precisely why F1 matters.

One adjacent flag deserves mention for rollback purposes: **`SYNC_AUTO_ENABLED`** (default `true`,
`config.ts:189`) controls only the background drain loop on an already-enabled edge node. It is a useful
*partial* rollback lever (§4.4) but is not a master switch — capture triggers keep firing and the queue
keeps growing when it is false.

---

## 3. Runtime vs Build-Time Analysis

**Offline Mode is STARTUP-controlled.** Precisely:

| Property | Answer | Evidence |
|---|---|---|
| Build-time controlled? | **No.** | No `VITE_*` offline flag, no `process.env` inlining, no conditional import. The client bundle contains the sync feature unconditionally; `CLIENT/src/config/env.ts` has no offline key. |
| Runtime (hot) toggleable? | **No.** | `offlineConfig()` memoizes into module-scope `cached` (`config.ts:252-258`). No endpoint or admin screen mutates it. `resetOfflineConfigCache()` exists **for tests only**. |
| Startup controlled? | **Yes.** | `initializeOfflineRuntime()` reads the config once, before `app.listen()` (`server.ts:42`). The value is fixed for the process lifetime. |

**Consequences for operations:**

- The **same build artifact** is valid enabled or disabled. There is no "offline build" and no "online build".
  Rollback never requires recompiling or re-publishing an image.
- A change to `OFFLINE_MODE_ENABLED` takes effect **only on full process restart**. `tsx watch` reloads do
  *not* re-read it reliably, because the memoized config and the `globalThis`-parked SQLite handle both
  survive module re-evaluation (`localClient.ts:143-148`). This matches the previously-recorded project
  gotcha that Prisma/config changes need a full server restart, and it applies here with more force.
- Because the datasource is resolved at *module import* (`prisma.ts:224`,
  `export const prisma = resolvePrimaryClient(getCloudClient)`), the database a process talks to is frozen
  before any request is served. There is no window in which half the app is on SQLite and half on Neon.

---

## 4. Rollback Procedure

### 4.1 What rollback does and does not require

| Action | Required? |
|---|---|
| Config change (`OFFLINE_MODE_ENABLED=false` or unset) | ✅ **Yes** |
| Full process restart | ✅ **Yes** |
| Rebuild / recompile | ❌ No |
| Redeploy a new artifact | ❌ No |
| Reverse the Prisma migration | ❌ No — and it should **not** be reversed (§5.3) |
| Delete the local SQLite file | ❌ No — and it must **not** be (§5.1) |
| Client rebuild or cache purge | ❌ No |

### 4.2 Cloud node rollback (low risk)

```bash
# 1. Set OFFLINE_MODE_ENABLED=false (or remove the offline block entirely)
# 2. Full restart
```

On restart: `initializeOfflineRuntime()` returns immediately (`runtime.ts:51`), `/sync/download` and
`/sync/upload` return **404** (`deviceAuth.middleware.ts:155`), and the server is byte-for-byte the
pre-feature server. The four sync tables remain, populated and inert.

⚠ **Fleet consideration:** disabling the cloud node while edge nodes are still enabled makes every till's
upload fail with 404. That is *survivable* — the queue is preserved and retries — but each item burns
retry attempts toward `SYNC_MAX_ATTEMPTS` (default 8) and will park as `FAILED`, requiring an explicit
`POST /sync/retry` after re-enabling. **Roll back edge nodes before the cloud node**, or accept a manual
requeue step.

### 4.3 Edge node rollback (requires care — F2)

A disabled edge node **stops using SQLite and starts using Neon directly** (`router.ts:162` falls through
to `createCloudClient()`). The queued data is not lost, but it becomes invisible to the application and
will not upload while disabled.

**Correct procedure:**

```bash
# 1. Drain first — while still enabled:
curl -X POST localhost:3000/api/v1/sync/run -d '{"direction":"UPLOAD"}'

# 2. Confirm the queue is empty before changing anything:
curl localhost:3000/api/v1/sync/status     # require queue.pending == 0 AND queue.inFlight == 0

# 3. Ensure DATABASE_URL is present and valid — a till normally has none by design
#    (prisma.ts:48 waives the requirement only while isEdgeNode() is true).

# 4. Set OFFLINE_MODE_ENABLED=false, then FULL restart.
```

⚠ **Step 3 is the trap.** `validateEnvironment()` waives `DATABASE_URL` *only* for an enabled edge node.
Disabling a till that has no `DATABASE_URL` causes the server to **refuse to boot** with
`Missing required environment variables: DATABASE_URL`. This is fail-safe (it fails loudly at startup, not
silently at the first sale) but it will read as "the rollback broke the till" to whoever performs it at 6am.

⚠ **Do not skip step 1.** Rolling back with a non-empty queue is *not* data loss (§5.1), but the sales in
that queue exist only on that machine until Offline Mode is re-enabled and the drain completes.

### 4.4 Partial rollback (sync misbehaving, data path fine)

If the *sync engine* is the problem but SQLite operation is healthy, prefer this over a full rollback — it
keeps capture running so nothing is lost:

```bash
SYNC_AUTO_ENABLED=false     # stops the background drain; restart required
```

The queue continues to fill and can be drained manually via `POST /sync/run`.

---

## 5. Queue Safety

### 5.1 Disabling does not delete or corrupt queued data — **verified**

| Question | Finding |
|---|---|
| Does the disabled path write to SQLite? | **No.** `initializeOfflineRuntime()` returns before `prepareLocalDatabase()` (`runtime.ts:51`). |
| Does it open the file at all? | **No** on a correctly-configured node — `getLocalClient()` is lazy (`localClient.ts:157`) and reached only via `isEdgeNode()`. **Yes** in the F1 edge case (`OFFLINE_ROLE=edge` left set); even then it only *reads*. |
| Does it drop triggers? | **No.** `installChangeCapture()` is only ever called on an enabled edge node. Triggers persist in the file untouched. |
| Does shutdown destroy anything? | **No.** `shutdownOfflineRuntime()` returns early when disabled (`runtime.ts:107`); when enabled it stops work *before* closing the handle so WAL is checkpointed cleanly. |
| Is the queue durable across a hard kill? | **Yes.** Capture triggers fire inside the same SQLite transaction as the write (`changeCapture.ts:11-16`), and `PRAGMA synchronous=FULL` is verified at boot (`localClient.ts:243`). |

**Conclusion: disabling Offline Mode is non-destructive to the queue.** The queue file is simply orphaned —
present, complete, and ignored.

### 5.2 Re-enabling later is safe — **verified**

Re-enabling restores the exact prior state, by design rather than by luck:

- `recoverAndBootstrap()` (`engine.ts:328`) repairs everything a stop-mid-flight leaves behind: runs stuck
  `RUNNING` → `INTERRUPTED`; items stuck `IN_FLIGHT` → `PENDING`; `captureEnabled=0` → re-enabled and logged
  at ERROR; missing triggers → reinstalled.
- Idempotency keys are generated **once at capture time and never regenerated** (`changeCapture.ts:103`), and
  the cloud's `SyncReceipt` ledger answers a repeat key with the original outcome. So a queue that sat
  disabled for a week uploads exactly once, no duplicates.
- Triggers are reinstalled on **every** boot, not just the first (`runtime.ts:73-77`), which covers a
  `db push` having dropped them during the disabled window.

⚠ **One real hazard during the disabled window:** if the node ran on **Neon** while disabled (§4.3) and took
sales there, then is re-enabled, it returns to a SQLite mirror that does not contain them. Those sales are
safe in Neon and will arrive on the next download **only if their entities are in the download policy**.
Re-enabling after a period of live cloud trading should be followed by a verification download and a
`GET /sync/health` check.

### 5.3 The destructive commands — do not confuse with rollback

Neither of these is part of any rollback path, and both must be kept away from it:

- **`npm run db:local:setup`** runs `prisma db push --accept-data-loss` (`package.json:20-21`). Against an
  existing mirror this **can drop the queue**. It is the *install/rebuild* step, never a rollback step.
- **Deleting `data/pos-local.db`** destroys every un-uploaded sale. `OFFLINE_FIRST.md:409` already carries
  this warning; it deserves to be repeated in the rollback runbook.

**Reverse migration is likewise not a rollback step.** Dropping `sync_receipts` would discard the
idempotency ledger and make a future re-enable capable of double-booking every replayed sale.

---

## 6. Client / Server Consistency

### 6.1 How each side evaluates Offline Mode

| Side | How it decides | Source |
|---|---|---|
| **Server** | Reads `OFFLINE_MODE_ENABLED` from its own environment. | `config.ts:152` |
| **Client** | **Does not evaluate it at all.** It asks the server via `GET /sync/status` and branches on the returned `role`. | `SyncIndicator.tsx:124` — `if (status?.role === "cloud") return null;` |

**This is the correct architecture and the audit's strongest positive finding.** The client holds no copy of
the flag, so client and server **cannot disagree** about whether Offline Mode is on. There is one build, and
it adapts to whichever deployment it is talking to. A whole class of flag-drift failure is structurally
absent.

### 6.2 Consistency assessment

| Check | Result |
|---|---|
| Client has an independent offline flag? | ✅ No — searched `CLIENT/src` for `VITE_*OFFLINE`/`VITE_*SYNC`; none exist. |
| Client build differs between modes? | ✅ No. `SyncStatusPage` is lazy-loaded; `SyncIndicator` is in the main bundle but renders `null` for `role: "cloud"`. |
| Server answers the client when disabled? | ⚠️ **Partially — see below.** |

### 6.3 The gap (F1, client-visible consequence)

`/sync/status` branches on `config.role`, not `config.enabled` (`sync.controller.ts:182`). Two behaviours follow:

**Disabled + `OFFLINE_ROLE=cloud` (the default, and the current repo state) — correct.**
The endpoint returns the degenerate cloud payload: `role: "cloud"`, empty queue, `captureHealthy: true`.
The indicator renders nothing. Exactly right.

**Disabled + `OFFLINE_ROLE=edge` (a stale variable after rollback) — wrong.**
The endpoint takes the edge branch and calls `syncStatus.getSyncStatus()`, which calls `getLocalClient()`
unconditionally (`syncStatus.service.ts:67`). On a server where Offline Mode is *off*:

- SQLite is opened despite the master switch being false — the "no file is opened" guarantee in the module
  header and in `OFFLINE_FIRST.md` is broken for this path;
- if the file or `sync_queue` table is absent, the endpoint **throws** — and the client polls it every 10s
  (`useSync.ts:36`), so this becomes a recurring 500 in the logs of a server that is supposed to be inert;
- if the file *is* present (e.g. a rolled-back till), the cashier sees a **live sync indicator with a real
  pending count on a server that will never sync**, because the engine is not running. This is the most
  misleading state the UI can enter: it reports data as queued-and-pending when nothing will drain it.

`POST /sync/run` and `POST /sync/retry` have no `enabled` guard either; on a disabled edge-role node they
would reach the engine and fail at the local-client call rather than returning a clean "not enabled".

**Assessment:** requires a stale `OFFLINE_ROLE`, so it is a rollback-hygiene bug rather than a
steady-state one. But rollback is exactly when someone flips `OFFLINE_MODE_ENABLED=false` and leaves the
rest of the block in place — which is the *natural* way to disable a flag.

---

## 7. Failure Scenario Analysis

| # | Scenario | Behaviour | Data safe? | Severity |
|---|---|---|---|---|
| **S1** | **Client/server flag mismatch** | Structurally impossible — the client has no flag (§6.1). | ✅ | None |
| **S2** | **Cloud disabled, edges still enabled** | Uploads 404. Queue preserved and retried with backoff, but attempts accumulate; items park as `FAILED` after 8 tries and need `POST /sync/retry`. | ✅ Preserved | **Medium** — operational toil, no loss |
| **S3** | **Edge disabled with a pending queue** | Node switches to Neon. Queue orphaned in SQLite: intact, invisible, not uploading. Recovered in full on re-enable. | ✅ Preserved | **Medium** — mitigated by §4.3 drain-first |
| **S4** | **Restart during an active sync** | `recoverAndBootstrap()` reconciles on next boot: `RUNNING`→`INTERRUPTED`, `IN_FLIGHT`→`PENDING`. Idempotency ledger prevents double-apply of anything the cloud already accepted. | ✅ | **Low** — explicitly designed for; validated in Phase 3 |
| **S5** | **Disabled, then re-enabled weeks later** | Queue drains with original idempotency keys; receipts deduplicate. Triggers reinstalled at boot. | ✅ | **Low** |
| **S6** | **Rollback leaves `OFFLINE_ROLE=edge` set** | **F1 fires.** SQLite opened on a disabled server; either recurring 500s on a 10s poll, or a misleading live indicator on a node that cannot sync. | ✅ (read-only) | **Medium** |
| **S7** | **Edge rolled back without `DATABASE_URL`** | Server refuses to boot (`validateEnvironment()`). Fail-safe but reads as a broken till. | ✅ | **Medium** — procedural |
| **S8** | **Typo, e.g. `OFFLINE_MODE_ENABLED=ture`** | Parsed as **disabled**. Fail-safe, and pinned by test. | ✅ | None |
| **S9** | **Flag flipped without full restart** | No effect. Memoized config + `globalThis`-parked SQLite handle survive `tsx watch` reloads. Operator may believe rollback succeeded when it did not. | ✅ | **Medium** — procedural |
| **S10** | **`db:local:setup` run during rollback** | `--accept-data-loss` can **drop the queue**. Only true data-loss path found in this audit. | ❌ **LOSS** | **High if performed** — not part of any documented rollback |
| **S11** | **Two tills share `OFFLINE_DEVICE_ID`** | Colliding idempotency keys; cloud silently discards one store's sales as duplicates. Not a gate failure, but the highest-consequence misconfiguration in the feature. | ❌ **LOSS** | **High** — guarded only by documentation |
| **S12** | **Enabled with `SYNC_UPLOAD_BATCH_SIZE=200` per doc (F3)** | Batch cannot finish inside the cloud's 120s transaction budget against Neon; whole batch rolls back and the till retries the same doomed payload. | ✅ Preserved | **Medium** — known-fixed regression, reachable by following the docs |

---

## 8. Deployment Checklist

### 8.1 Pre-enable gate (from MODULE_STATUS §0.4 — status: **not yet signed off**)

- [ ] Neon backup branch created
- [ ] Migration `20260805090000_offline_first_sync_cloud_tables` applied to that branch
- [ ] `npm run sync:validate -- --transactions 500` passed against it
- [ ] `npm run sync:stress -- --products 2000 --transactions 3000` run on **actual till hardware**, not a laptop
- [ ] Only then enable on the deployment being cut over

*(Phase 3 validation was recorded as PASSED on the backup branch on 2026-08-05; the till-hardware stress
run is the step this audit could not verify from the repository.)*

### 8.2 Enabling — cloud node

- [ ] `npx prisma migrate deploy` (additive; adds four tables)
- [ ] `SYNC_DEVICE_SECRET` set, **≥32 chars**, generated from a CSPRNG
- [ ] `OFFLINE_ROLE=cloud`
- [ ] `OFFLINE_MODE_ENABLED=true`
- [ ] Full restart (not a watch-reload)
- [ ] Verify `GET /api/v1/sync/status` returns `role: "cloud"`
- [ ] Verify `/sync/upload` no longer 404s

### 8.3 Enabling — edge node

- [ ] `npm run db:local:setup` **before** first enable (never after, with a live queue)
- [ ] `OFFLINE_DEVICE_ID` set and **globally unique across the fleet** (S11)
- [ ] `SYNC_CLOUD_URL` set, no trailing slash issues (normalized at `config.ts:164`)
- [ ] `SYNC_DEVICE_SECRET` **identical** to the cloud node's
- [ ] Confirm `SYNC_UPLOAD_BATCH_SIZE` is unset (default 50) — **ignore the `200` in OFFLINE_FIRST §9** (F3)
- [ ] Full restart
- [ ] Confirm the initial download completed — the node cannot sell with an empty mirror
- [ ] Confirm `GET /sync/health` returns 200 and `captureTriggers.missing == 0`
- [ ] Wire an uptime monitor to `/sync/health` (503 = capture broken)
- [ ] Alert on `oldestPendingAgeSeconds`, **not** on pending count

### 8.4 Rollback

- [ ] **Edge first, cloud second** (avoids S2)
- [ ] Drain: `POST /sync/run {"direction":"UPLOAD"}`; confirm `pending == 0` **and** `inFlight == 0`
- [ ] Confirm `DATABASE_URL` is present and valid on any edge node being disabled (S7)
- [ ] Set `OFFLINE_MODE_ENABLED=false`
- [ ] **Also unset `OFFLINE_ROLE`** (or set it to `cloud`) — avoids F1/S6
- [ ] Full process restart
- [ ] Verify `GET /sync/status` returns `role: "cloud"` and the indicator is absent
- [ ] **Do not** run `db:local:setup`, delete `pos-local.db`, or reverse the migration
- [ ] Retain `data/pos-local.db` as-is until the queue is confirmed uploaded

---

## 9. Risks & Recommendations

*Analysis only — nothing below was implemented, per the read-only scope.*

| ID | Risk | Recommendation |
|---|---|---|
| **R1** | **F1 — `/sync/status` and `/sync/health` gate on `role`, not `enabled`.** Opens SQLite on a disabled server; produces a misleading live indicator or recurring 500s under a 10s poll (S6). | Gate both handlers on `offlineConfig().enabled` first, returning the degenerate cloud payload when disabled. Same for `/sync/run` and `/sync/retry`. Add a test: *disabled + `OFFLINE_ROLE=edge` never constructs a local client.* |
| **R2** | **F3 — doc/code drift on `SYNC_UPLOAD_BATCH_SIZE`** (`OFFLINE_FIRST.md:302` says 200; code says 50). Following the doc reintroduces the Neon transaction-budget failure (S12). | Correct the doc to `50` and carry over the code's rationale comment. |
| **R3** | **Edge rollback semantics undocumented (F2).** A disabled till silently moves to Neon; and boots-refused if it has no `DATABASE_URL` (S7). | Add a "Rolling back" section to `OFFLINE_FIRST.md` containing §4.3 of this report verbatim. |
| **R4** | **`db:local:setup` is one keystroke from destroying a live queue** (S10). | Have the script refuse to run when `sync_queue` is non-empty unless `--force` is passed. |
| **R5** | **Duplicate `OFFLINE_DEVICE_ID` causes silent, permanent sales loss** (S11) — guarded only by comments. | Register device ids server-side: have the cloud reject an upload whose `deviceId` was last seen with a conflicting `lastQueueId` progression. The `SyncDevice.lastQueueId` gap-detection field already exists for this. |
| **R6** | **No restart-required signal** (S9). An operator can change the flag and believe it took effect. | Log the resolved `{enabled, role, dataSource}` at INFO on every boot, including when disabled (currently the disabled path logs nothing at all by design), so the active gate state is always greppable in the logs. |
| **R7** | **Fleet-ordering hazard** (S2): disabling cloud first burns retry attempts across every till. | Document edge-before-cloud ordering; consider making a 404 from `/sync/upload` not count toward `SYNC_MAX_ATTEMPTS`, since it means "server disabled", not "item bad". |
| **R8** | **Stale test/dev SQLite files present** in `SERVER/data/` (`e2e-validation.db`, `pos-stress.db`, and a 7MB `pos-local.db`). Harmless locally; a risk only if `data/` is ever copied into an image. | Confirm `data/` is excluded from the Docker build context. |

---

## 10. Final Verdict

**Can Offline Mode be safely enabled in production?**
**Yes, on a cloud node — subject to the MODULE_STATUS §0.4 gate being signed off** (the till-hardware stress
run is the outstanding item this audit could not verify from the repository). The enable path is additive,
the migration is additive, and the flag has exactly one source of truth with a fail-safe default that is
pinned by tests. For an **edge node**, enabling is likewise sound, but the two configuration hazards that
cause *silent, permanent* data loss — duplicate `OFFLINE_DEVICE_ID` (S11) and `db:local:setup` against a
live queue (S10) — are currently prevented by documentation alone. R4 and R5 should be closed before a
multi-till rollout, though a single-till pilot can proceed with procedural controls.

**Can Offline Mode be safely rolled back in production?**
**Yes.** Rollback is a config change plus a restart — no rebuild, no redeploy, no migration reversal, and
**no data deletion**. This was verified rather than assumed: the disabled path never writes to SQLite, never
drops a trigger, and never touches the queue, and re-enabling recovers the full queue with original
idempotency keys so nothing double-books.

Two qualifications on rollback, neither of which is a blocker:

1. **Rollback is not fully inert if `OFFLINE_ROLE=edge` is left behind** (F1/S6). Unsetting `OFFLINE_ROLE`
   alongside `OFFLINE_MODE_ENABLED` avoids it entirely; fixing R1 removes the trap.
2. **Edge rollback strands the queue rather than draining it** (F2/S3). Data is preserved, but the
   drain-first procedure in §4.3 must be followed, and it is not yet written down anywhere the operator
   will find it at 6am.

**Overall:** the gate design is correct, minimal and defensible — one flag, one reader, fail-safe default,
test-pinned, with a client that cannot disagree with the server because it holds no copy of the flag. The
findings are concentrated in the **rollback** direction rather than the enable direction, which is the less
rehearsed path and therefore worth closing before cutover. **Recommend proceeding to production enablement
after R1 and R2 are addressed**, with R3 (rollback runbook) written before the first edge-node cutover.

---

*Read-only audit. No code, configuration, `.env`, database or deployment setting was modified.*
