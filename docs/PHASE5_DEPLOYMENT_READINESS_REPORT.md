# Phase 5 — Deployment Readiness Fixes

**Date:** 2026-08-05
**Branch:** `feature/offline-first-sync`
**Scope:** Implement the deployment-readiness findings from
[PHASE4_OFFLINE_MODE_GATE_AUDIT.md](PHASE4_OFFLINE_MODE_GATE_AUDIT.md).
**Constraint honoured:** no new features, and **no change to the sync protocol,
database schema, migrations, or Offline Mode functionality.**

---

## 1. Executive Summary

All four Phase 5 tasks are complete, plus the two audit recommendations that
directly serve them (R6 boot-state logging, and the diagnostic endpoints that
shared F1's root cause). Verification is green: **tsc clean on both server and
client, 626 server tests passing, 0 failing.**

| Task | Audit ref | Status |
|---|---|---|
| Gate `/sync/status` + `/sync/health` on `enabled` before role | F1 / R1 / S6 | ✅ Done |
| Update `OFFLINE_FIRST.md` to the validated `SYNC_UPLOAD_BATCH_SIZE=50` | F3 / R2 / S12 | ✅ Done |
| Offline Mode Rollback Runbook | F2 / R3 | ✅ Done |
| Clear startup message for a missing `DATABASE_URL` during rollback | S7 | ✅ Done |
| Tests: rollback path, disabled status/health, startup validation | R1 | ✅ Done |

**The audit's blocking conditions are closed.** Its verdict was "recommend
proceeding to production enablement after R1 and R2 are addressed, with R3
written before the first edge-node cutover." R1, R2 and R3 are all addressed
here.

Nothing in the sync protocol, schema, migrations or Offline Mode behaviour was
touched. Every change is confined to the **disabled** path, documentation, and
tests — so the enabled behaviour validated in Phase 3 is byte-for-byte
unchanged.

---

## 2. Changes

### 2.1 F1 — the disabled path is now genuinely inert

**Problem.** `/sync/status` and `/sync/health` gated on `config.role`, not
`config.enabled`. Rollback is done by setting `OFFLINE_MODE_ENABLED=false`,
which naturally leaves `OFFLINE_ROLE=edge` in place — so a rolled-back till
still took the edge branch and opened SQLite. Either the endpoint threw (and the
client polls it every 10s, so an inert server logged a 500 six times a minute),
or it returned a **live sync indicator with a real pending count on a node whose
sync engine was not running** — data reported as queued that nothing would drain.

**Fix.** One named helper in
[sync.controller.ts](../SERVER/src/offline/api/sync.controller.ts), checking the
master switch first:

```ts
function servesCloudPayload(): boolean {
  const config = offlineConfig();
  return !config.enabled || config.role !== "edge";
}
```

Applied to every edge-side handler. The audit scoped F1 to the two polled
endpoints and noted `/run` and `/retry` had no guard either; the same root cause
extended to the four MANAGER-gated diagnostic reads, which all reach
`getLocalClient()` too. All are closed together rather than leaving the same bug
behind a role check:

| Endpoint | Disabled-node behaviour |
|---|---|
| `GET /sync/status` | Degenerate cloud payload — `role: "cloud"`, empty queue |
| `GET /sync/health` | **200 healthy**, not 503 |
| `POST /sync/run` | `{ skipped: true, reason: "…not enabled…" }` |
| `POST /sync/retry` | `{ requeued: 0 }` |
| `GET /sync/history`, `/conflicts`, `/events` | Empty array |
| `GET /sync/queue` | Empty page, `meta.total: 0` |

`/sync/health` returning **200 rather than 503** is deliberate: a rolled-back
node has no capture to be broken, and an uptime monitor left pointed at it must
not page anyone because a node was taken out of Offline Mode on purpose.

**Result:** with the fix, a disabled node answers identically whether
`OFFLINE_ROLE` is `cloud`, `edge`, or unset. S6 is eliminated rather than
mitigated — rollback hygiene is no longer load-bearing.

### 2.2 S7 — the startup error now explains itself

**Problem.** A till has no `DATABASE_URL` by design. Disabling Offline Mode
revokes that waiver, so the node refuses to boot with:

```
Missing required environment variables: DATABASE_URL. Server cannot start without them.
```

Failing closed is correct — the alternative is a till that boots and then fails
at the first sale. But that message gives whoever is doing the rollback at 6am
no way to connect the error to the change they just made, and the intuitive fix
("rebuild the local database") is the one action that **destroys every
un-uploaded sale.**

**Fix.** [prisma.ts](../SERVER/src/config/prisma.ts) now detects the rollback
signature — `DATABASE_URL` missing, master switch off, but `OFFLINE_ROLE=edge`
or `OFFLINE_DEVICE_ID` still set — and appends actionable guidance:

```
Missing required environment variables: DATABASE_URL. Server cannot start without them.

This node still has Offline Mode variables set (OFFLINE_ROLE / OFFLINE_DEVICE_ID)
but OFFLINE_MODE_ENABLED is not enabled, so this looks like an edge-node
rollback in progress.

An edge node runs on local SQLite and has no DATABASE_URL by design. Disabling
Offline Mode moves it back onto the cloud database, which requires one.

To finish the rollback:
  1. Set DATABASE_URL to the cloud (Neon) connection string for this store.
  2. Unset OFFLINE_ROLE, or set it to `cloud`, so no stale edge config remains.
  3. Start the server again (a full restart — a watch-reload will not re-read this).

To cancel the rollback and keep running offline instead:
  Set OFFLINE_MODE_ENABLED=true and restart.

⚠ Queued sales are NOT lost either way. They remain in the local SQLite file
  and upload once Offline Mode is enabled again. Do NOT delete that file and
  do NOT run `npm run db:local:setup` to clear this error — that destroys the
  queue. See docs/OFFLINE_ROLLBACK_RUNBOOK.md.
```

Scoped precisely: it fires only for `DATABASE_URL`, only when offline variables
are actually present. A plain cloud server with a missing variable, or a missing
`JWT_SECRET`, still gets the plain message. **The validation logic itself is
unchanged** — same variables required, same failure, better explanation.

### 2.3 R6 — the boot log states the resolved gate

The disabled path previously logged nothing at all, which made S9 (flag flipped
without a real restart) impossible to confirm from the logs. It now emits one
line ([runtime.ts](../SERVER/src/offline/runtime.ts)):

```
offline: disabled — this node runs entirely on the cloud database
    { enabled: false, role: "cloud", dataSource: "cloud" }
```

`staleRole: true` appears when offline is off but an edge role was left behind —
harmless now, still worth clearing. This is the line §8.3 of the runbook tells
operators to grep for. It is a log statement only; no behaviour changes.

### 2.4 F3 — the batch-size doc drift

[OFFLINE_FIRST.md](OFFLINE_FIRST.md) §9 documented `SYNC_UPLOAD_BATCH_SIZE` as
`200`; the code default is `50`. A deployment following the doc would reintroduce
a known-fixed failure (S12): 200 items cannot finish inside the cloud's 120s
transaction budget against Neon at ~330ms per round trip, so the whole batch
rolls back and the till retries the same doomed payload forever.

Corrected to `50`, with the code's rationale carried into the doc so the value
cannot quietly drift back. **Documentation only — the code default was already
correct and is untouched.**

### 2.5 R3 — the Rollback Runbook

New: **[OFFLINE_ROLLBACK_RUNBOOK.md](OFFLINE_ROLLBACK_RUNBOOK.md)**, written to
be usable under pressure rather than read in advance. Covers every element
required:

| Required | Section |
|---|---|
| How to disable Offline Mode | §4 edge, §5 cloud, §6 fleet ordering |
| Required configuration changes | §3 — the complete variable table |
| Restart procedure | §4 step 4 — full restart, and why a watch-reload is not one |
| Expected behavior | §9 verification checklist |
| Queue preservation | §0, §7 — and the three actions that would destroy it |
| Re-enabling process | §10 — including the sales-taken-while-disabled hazard |

Design choices worth noting:

- **§0 answers the panic questions in 30 seconds** — is data lost, do I need to
  redeploy, do I need to restart — before any procedure.
- **§2 leads with partial rollback** (`SYNC_AUTO_ENABLED=false`), the
  lowest-blast-radius lever, so the full rollback is not reached for problems
  that do not need it.
- **§7 is a dedicated "must never do" table.** The audit found exactly one true
  data-loss path (`db:local:setup` / deleting the mirror). It is called out in
  §0, §7 and §8.2, because it is what someone reaches for when a till will not
  start.
- **Edge-before-cloud ordering** (§6) is stated with its consequence, closing R7's
  documentation half.

A condensed "Rolling back" section was added to `OFFLINE_FIRST.md` §10, linking
to the runbook — the audit's R3 asked for §4.3 to live where an operator would
find it.

---

## 3. Tests

Two new suites, **37 tests**, both registered in `vitest.unit.config.ts` (pure
logic, no database).

### 3.1 `src/offline/__tests__/rollback.test.ts` — 12 tests

Companion to `defaultDisabled.test.ts`. That suite pins "a server that never
enabled Offline Mode is unchanged"; this one pins the harder property: **a
server that had it enabled and turned it off is unchanged too.**

Every test deliberately configures the **stale-role** state — switch off, all
other offline variables still present — because that is what a real rollback
leaves behind.

The load-bearing design choice: `syncStatus.service` is mocked to **throw on
every call**, with a message naming the regression. The assertion is therefore
not "the handler returned the right shape" but "the handler returned *without
reaching the local client*" — which is the actual property F1 violated.

Coverage: gate helpers (`isEdgeNode`/`isCloudNode` false despite
`role === "edge"`), datasource routing to cloud, all 8 endpoints, plus a plain
disabled node with no offline variables.

### 3.2 `src/config/__tests__/startupValidation.test.ts` — 13 tests

Baseline validation, the edge-node `DATABASE_URL` waiver (present when enabled,
absent on cloud nodes), and the rollback diagnostic: that it still refuses to
start, names the rollback, gives the fix, offers the cancel path, and warns
against `db:local:setup`. Two negative tests pin the scoping — a plain cloud
server and a missing `JWT_SECRET` must *not* get the rollback lecture.

### 3.3 The tests were confirmed to fail against the old behaviour

A guard test that cannot fail is worthless, so the fix was temporarily reverted
(`servesCloudPayload` restored to `config.role !== "edge"`) and the suite re-run:

```
× GET /sync/status answers as a cloud node, never opening SQLite
× GET /sync/health returns 200 healthy, not 503
× POST /sync/run reports 'nothing to sync' instead of failing in the engine
  … 9 failed

Error: syncStatus.getSyncStatus() was called on a DISABLED node — this is the
regression this suite exists to catch.
```

The fix was then restored and all 12 pass. The suite demonstrably detects the
exact defect, at the exact call it should.

---

## 4. Verification Results

Full suite, run after implementation.

| Check | Command | Result |
|---|---|---|
| Server typecheck | `npx tsc --noEmit` | ✅ **Clean**, 0 errors |
| Client typecheck | `npx tsc --noEmit` (CLIENT) | ✅ **Clean**, 0 errors |
| Unit suite | `npm run test:unit` | ✅ **557 passed**, 27 files, 0 failed |
| SQL dialect + default-disabled safety | `vitest run …sqlDialect …defaultDisabled` | ✅ **54 passed** |
| Offline operation integration | `vitest run …offlineOperation.integration` | ✅ **15 passed** |
| **Total** | | ✅ **626 passed, 0 failed** |

The client typecheck matters here specifically: `SyncIndicator` consumes
`/sync/status`, and the disabled payload had to stay shape-compatible. It does —
the degenerate cloud payload was already the contract, and it is now returned in
strictly more cases.

The pre-existing offline safety suites (`defaultDisabled`, `sqlDialect`,
`offlineOperation`) pass **unchanged**, which is the evidence that Offline Mode
functionality was not altered.

### Not run

`sync:validate` and `sync:stress` require a live Neon branch and real till
hardware. They were unaffected by this work — nothing in the sync protocol,
schema or enabled path changed — and Phase 3 recorded them as PASSED on the
backup branch on 2026-08-05.

---

## 5. Deployment Readiness

**Confirmed: ready to deploy.**

The Phase 4 audit's verdict was *"recommend proceeding to production enablement
after R1 and R2 are addressed, with R3 (rollback runbook) written before the
first edge-node cutover."* All three are now closed:

| Audit finding | Severity | Status |
|---|---|---|
| F1 / R1 — endpoints gate on role, not enabled | Medium | ✅ **Fixed and test-pinned** |
| F2 / R3 — edge rollback semantics undocumented | Medium | ✅ **Documented** (runbook + OFFLINE_FIRST §10) |
| F3 / R2 — batch-size doc drift | Low | ✅ **Corrected** |
| S7 — confusing boot failure on edge rollback | Medium | ✅ **Now self-explaining** |
| S9 / R6 — no restart-required signal | Medium | ✅ **Boot line added** |
| S6 — stale `OFFLINE_ROLE` after rollback | Medium | ✅ **Eliminated by F1 fix** |

**Rollback safety is now structural rather than procedural.** Before this phase,
a clean rollback depended on the operator remembering to unset `OFFLINE_ROLE`.
It no longer does — the disabled path is inert regardless, and the one remaining
failure mode (missing `DATABASE_URL`) explains itself and points at the runbook.

### Risk assessment of this change set

**Low.** Every code change is confined to the **disabled** path or to an error
message:

- `servesCloudPayload()` only adds a `!config.enabled ||` disjunct. On an
  **enabled** node it evaluates exactly as before, so no enabled behaviour moves.
- `validateEnvironment()` throws on exactly the same conditions; only the
  message text differs.
- The runtime change is a log line on a path that previously returned silently.

No schema, migration, protocol or sync-engine code was touched.

### Outstanding — not in Phase 5 scope

These remain open from the audit and are **not** blockers for a cloud-node
enablement or a single-till pilot, but the audit flagged R4 and R5 before a
multi-till rollout:

| ID | Item | Note |
|---|---|---|
| **R4** | `db:local:setup` should refuse to run against a non-empty queue | Currently prevented by documentation alone (now in three places). A code guard is the real fix. |
| **R5** | Duplicate `OFFLINE_DEVICE_ID` detection server-side | Highest-consequence misconfiguration in the feature; `SyncDevice.lastQueueId` already exists to support it. |
| **R7** | A 404 from `/sync/upload` should not count toward `SYNC_MAX_ATTEMPTS` | Documentation half closed (§6 ordering); the code half is a sync-engine change, excluded by Phase 5 scope. |
| **R8** | Confirm `SERVER/data/` is excluded from the Docker build context | One-line check, unrelated to rollback. |
| §8.1 | Till-hardware `sync:stress` run | The MODULE_STATUS §0.4 gate item neither Phase 4 nor Phase 5 could verify from the repository. |

R4, R5 and R7 are all **feature/engine changes**, correctly excluded by the
"do not change the sync engine" constraint on this phase.

---

## 6. Files Changed

**Modified**

| File | Change |
|---|---|
| `SERVER/src/offline/api/sync.controller.ts` | `servesCloudPayload()` gate on 8 handlers |
| `SERVER/src/config/prisma.ts` | Rollback-aware `validateEnvironment()` message |
| `SERVER/src/offline/runtime.ts` | Boot log line for the disabled path |
| `SERVER/vitest.unit.config.ts` | Registered the two new suites |
| `docs/OFFLINE_FIRST.md` | Batch size `200`→`50` + rationale; "Rolling back" section |

**Added**

| File | Purpose |
|---|---|
| `docs/OFFLINE_ROLLBACK_RUNBOOK.md` | The runbook |
| `SERVER/src/offline/__tests__/rollback.test.ts` | 12 tests — disabled path is inert |
| `SERVER/src/config/__tests__/startupValidation.test.ts` | 13 tests — startup validation |

---

*Phase 5 complete. No sync protocol, schema, migration or Offline Mode
functional change was made.*
