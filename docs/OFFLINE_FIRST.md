# Offline-First Architecture

How this POS operates for a full business day without internet, and how it
reconciles with the cloud afterwards.

**Everything here is additive and OFF by default.** With `OFFLINE_MODE_ENABLED`
unset, the datasource router resolves to the existing Neon client, no SQLite
file is opened, no trigger is installed, and the server is byte-for-byte the one
that existed before this feature. An existing deployment can take this code
without changing a single environment variable.

---

## 1. The shape of it

Two roles run the same image; only `OFFLINE_ROLE` differs.

```
   ┌──────────────────────────────┐                ┌──────────────────────────────┐
   │  EDGE NODE (the shop)        │                │  CLOUD NODE                  │
   │                              │                │                              │
   │  React client                │                │  React client (head office)  │
   │       ↓                      │                │       ↓                      │
   │  Express + 43 services       │                │  Express + 43 services       │
   │       ↓                      │                │       ↓                      │
   │  prisma  ──router──▶ SQLite  │                │  prisma ──router──▶ Neon     │
   │                    │         │                │                      ▲       │
   │              triggers        │                │                      │       │
   │                    ↓         │                │                      │       │
   │              sync_queue      │                │                      │       │
   │                    │         │   signed HTTP  │                      │       │
   │              sync engine ────┼───────────────▶│  /api/v1/sync/*  ────┘       │
   └──────────────────────────────┘                └──────────────────────────────┘
```

The client, the routes, the services, the engines and the repositories are
**identical on both sides**. The only thing that differs is which database
`src/config/prisma.ts` hands out.

### The one decision everything follows from

**An edge node uses SQLite for the whole business day, online or not.**
Connectivity does *not* select the database; it only decides whether the sync
engine may run.

The tempting alternative — "use Neon when online, fall back to SQLite when the
link drops" — is wrong in a way that costs money. A store that flips at 3pm
writes the morning's sales to Neon and the afternoon's to SQLite. The day's
takings then live in two places, the register never reconciles, a return
processed against a sale in the other database fails, and stock counts diverge
because each database saw half the movements. Nothing errors; it is discovered
at close of business.

Making SQLite the permanent operational database also means the offline path is
the *normal* path — which is the only way it stays tested.

---

## 2. Layer map

| Layer | Location | What it does |
|---|---|---|
| Config | `SERVER/src/offline/config.ts` | Every env knob, resolved once. Nothing else reads `process.env`. |
| Mirror generator | `SERVER/scripts/generate-local-schema.ts` | Derives the SQLite schema + manifest from `prisma/schema.prisma`. |
| Local client | `src/offline/datasource/localClient.ts` | better-sqlite3 + Prisma, with the durability PRAGMAs. |
| Router | `src/offline/datasource/router.ts` | Decides what `prisma` resolves to. The seam. |
| Scalar-list bridge | `src/offline/datasource/scalarListBridge.ts` | Keeps `imageUrls`/`workingDays` as arrays. |
| SQL dialect | `src/offline/datasource/sqlDialect.ts`, `rawSqlBridge.ts` | Makes the 63 raw queries run on SQLite. |
| Connectivity | `src/offline/datasource/connectivity.ts` | Probes the cloud, with hysteresis. |
| Policy | `src/offline/sync/policy.ts` | Direction + conflict winner for all 55 models. |
| Change capture | `src/offline/sync/changeCapture.ts` | 102 SQLite triggers → `sync_queue`. |
| Engine | `src/offline/sync/{engine,download,upload,conflicts}.ts` | Runs, batching, retries, resolution. |
| Cloud side | `src/offline/sync/{cloudApply,cloudServe}.ts` | Applies uploads, serves downloads. |
| Security | `src/offline/security/requestSignature.ts` | HMAC signing + replay window. |
| API | `src/offline/api/*` | Routes, device auth, status service. |
| Client | `CLIENT/src/features/sync/**` | Indicator, status screen, hooks. |

---

## 3. The local database

`prisma/local/schema.prisma` is **generated**, never hand-edited. One source of
truth means the two databases cannot drift; a hand-written mirror is wrong the
first time somebody adds a column and forgets it, and the failure is silent — a
price or a tax rate quietly becomes null on the till.

```bash
cd SERVER
npm run db:local:setup          # generate schema + client, push to SQLite
npm run db:local:schema:check   # CI: fails if the mirror is stale
```

### What actually differs between the dialects

This was **checked against the bundled SQLite (3.53), not assumed**. Modern
SQLite supports far more than its reputation suggests:

| Construct | SQLite | Action |
|---|---|---|
| Enums, `Json`, `Decimal` | supported | none |
| `FILTER (WHERE …)` on aggregates | supported | none |
| Window functions, `OVER (…)` | supported | none |
| `NULLS LAST` | supported | none |
| `CAST(x AS …)` | supported | none |
| `LIKE` | case-insensitive (ASCII) | `ILIKE` → `LIKE` |
| Scalar lists (`String[]`) | **not supported** | stored as JSON text + runtime bridge |
| `Json @default("{}")` | DDL emits it **unquoted** | re-spelled as `dbgenerated("'{}'")` |
| Trigram/GIN indexes | not supported | dropped |
| `x::type` | not supported | `CAST(x AS type)` |
| `GREATEST`/`LEAST` | `max()`/`min()` | translated |
| `DATE_TRUNC` | not supported | `strftime()` |
| `EXTRACT(EPOCH FROM (a-b))` | not supported | `(julianday(a)-julianday(b))*86400` |
| `X - INTERVAL 'n unit'` | not supported | `datetime(X, '-n unit')` |
| `DISTINCT ON` | not supported | **rewritten at source** to `ROW_NUMBER()` |
| `= ANY(${array})` | not supported | **rewritten at source** to `IN (${Prisma.join(…)})` |

The last two are converted in the repositories rather than translated at
runtime, because the rewritten forms run on **both** engines — so there is one
copy of each query to maintain, not two.

### Durability

Set on every connection and **verified at startup** — the node refuses to serve
if `foreign_keys` did not take:

- `journal_mode = WAL` — the sync engine can drain while the cashier sells.
- `synchronous = FULL` — fsync on every commit. Slower than `NORMAL`, but
  `NORMAL` can lose the most recent transactions on a power cut. For money that
  is not a trade worth making.
- `foreign_keys = ON` — SQLite does **not** enforce FKs unless asked, per
  connection. Without it the till accepts a sale line pointing at a product that
  does not exist, and Postgres rejects the same data at upload time — after the
  customer has left with the goods.

---

## 4. Change capture

Every write to an uploadable table is recorded in `sync_queue` by an **AFTER
trigger**, not by application code. 102 triggers over 34 tables, generated from
the schema manifest so the payload shape is reviewable in a diff.

**Why the database and not a hook.** Three reasons, in order of importance:

1. **Atomicity.** A trigger fires inside the same transaction as the write. A
   sale and its queue entry commit together or not at all. An application hook
   cannot promise that: if the process dies between "sale committed" and "queue
   row written", the sale exists locally, is invisible to the sync engine
   forever, and nobody finds out until the books do not balance.
2. **It cannot be bypassed.** 43 services, 26 repositories and ten files using
   `$executeRaw` write to this database. Capture built on "remember to call
   `recordChange()`" is one new code path away from a hole.
3. It requires no change to business logic, which is the brief.

**The echo problem.** Applying downloaded cloud rows is itself a local write, so
it would queue the cloud's own data straight back up. Capture is suppressed
during a download by `sync_node_state.captureEnabled` — and `withCaptureSuppressed`
only ever runs **inside a transaction**, so SQLite's write lock is held the whole
time and no concurrent sale can slip through uncaptured. Suppressing across an
async loop instead would silently lose every sale rung up in that window.

Triggers are reinstalled on **every boot**: `db push` recreates tables and SQLite
drops their triggers with them, so a node that came up after a schema refresh
would otherwise run all day capturing nothing — silently, with a healthy-looking
empty queue.

---

## 5. Sync protocol

### Morning — download

`GET /api/v1/sync/download?entity=…&since=…&sinceId=…&limit=…`

Keyset-paginated on `(updatedAt, id)`, **not** LIMIT/OFFSET. Offset paging over
a table being written to skips rows: insert a product between page 3 and page 4
and everything shifts, so one existing product is never returned — and a skipped
product is a barcode that does not scan at the till. The `id` half of the cursor
is what makes it correct when thousands of rows share a timestamp, which they do
after any bulk import.

Cursors are **per entity**, so a Customers pull that failed on page 9 does not
force Products to be re-downloaded tomorrow.

Each page is applied in one transaction, and the cursor advances only **after**
it commits — so an interrupted download re-fetches that page rather than skipping
it.

Entities are pulled in dependency order (Category → Product → ProductVariant),
because local FK enforcement is deliberately on and a variant arriving before its
product would be rejected.

### Night — upload

`POST /api/v1/sync/upload`

The queue is drained in **ascending id**, which reproduces the exact order the
writes happened at the till — that is what keeps a Sale ahead of its SaleItems
and a CashRegister ahead of the transactions posted against it.

Items move `PENDING → IN_FLIGHT → SYNCED` and are **never deleted**. Status is
written *before* the request, not after: if the process dies mid-flight the items
are `IN_FLIGHT` and get retried (possibly a duplicate send, which the ledger
absorbs). Marking them `SYNCED` optimistically would strand real sales as
"already uploaded" and they would never be sent.

### Full sync

Upload first, then download. The till's un-uploaded sales are the only copy of
that data anywhere in the world; a catalog refresh can be repeated any time. If
only one leg completes before the link drops again, it must be the one that
protects data.

---

## 6. Conflict resolution

Deterministic, and deliberately **not** last-write-wins. LWW compares two clocks,
one of which is a shop-floor PC set to whatever someone typed. Letting that
arbitrate whether head office's new price survives is a coin toss, and the losing
value simply disappears.

The winner is decided by **what a row is**, not when it was written:

| | Wins | Why |
|---|---|---|
| Products, prices, categories, brands, suppliers, settings, discounts, promotions | **Cloud** | Head office sets these. A till has no authority to overrule a company-wide price change. |
| Employees, shifts, permissions | **Cloud** | A till that could author these could mint itself an OWNER account and sync it up. |
| Customers | **Cloud** on an existing row | Head office may have merged duplicates. A row the cloud has never seen is inserted as-is, so a walk-in signed up at the counter still reaches the cloud. |
| Sales, returns, exchanges, payments, invoices | **Local** | The cloud cannot have a better opinion about whether a customer walked out with a shirt. |
| Inventory movements, adjustments, cycle counts | **Local** | Same: these record what physically happened. |
| Attendance, expenses, cash drawer, salaries | **Local** | Same. |
| Audit log | **Local** | A trail with the offline day missing is not a trail. |
| Print jobs, assets, snapshots | never sync | Device-local, or derived and recomputed centrally. |

A useful summary: **the cloud owns intent, the till owns events.**

Every conflict is logged with **both** versions (`sync_conflicts` locally,
`sync_conflict_records` centrally). A resolution that discards data without
keeping it is indistinguishable from a bug.

⚠ Numeric comparison is by **value**, not spelling. Postgres serializes NUMERIC
as `"12.50"`; SQLite returns `12.5`. Compared as text, every row with a price,
tax rate or quantity would be logged as a conflict on every sync — thousands of
false entries a day, which is the same as having no conflict log at all.

---

## 7. Data integrity

| Guarantee | Mechanism |
|---|---|
| No duplicate uploads | Idempotency key minted once by the capture trigger, enforced by a **UNIQUE index** on `sync_receipts`. The index — not the lookup — is what makes concurrent retries safe: two copies of a replayed batch both pass a SELECT, and exactly one can win the insert. |
| No lost transactions | Trigger atomicity + `IN_FLIGHT` recovery at the start of every run. Nothing is deleted from the queue. |
| Atomic uploads | A batch applies in one Postgres transaction **together with its receipts**, so neither can exist without the other. |
| Resume | Progress is per item, not per run. A sync killed at item 4,000 of 10,000 resumes at 4,001. |
| Poison records | A single bad row is rejected individually rather than rolling back the batch, so it cannot block every good sale behind it. |
| Inventory consistency | Movements upload; `ProductVariant.currentStock` does **not** — the cloud rebuilds it from the movements, so it cannot double-count. |

---

## 8. Security

- Sync is machine-to-machine and signed with **HMAC-SHA256**, not a staff JWT —
  an edge node drains its queue at 2am with nobody logged in, and a long-lived
  staff token on a shop-floor PC would be a worse credential.
- The signature covers `device ‖ timestamp ‖ nonce ‖ method ‖ path ‖ sha256(body)`.
  Binding the method and path stops an upload signature being replayed against
  another endpoint; binding the body hash stops the amounts being rewritten in
  flight.
- Replay protection is two independent mechanisms: a **freshness window**
  (default 5 min, both directions — a future-dated signature would otherwise
  never expire) and a **single-use nonce** enforced by a PRIMARY KEY.
- Signatures compare in **constant time**. A plain `===` leaks the signature one
  byte at a time through response timing.
- Every auth failure returns one identical response, so an attacker learns
  nothing about which half of the credential was wrong.
- An **unknown** device may enroll on first sync (it already had to hold the
  secret); a **deactivated** one is refused even with a valid signature — the
  kill switch for a stolen till.
- An edge node has **no `DATABASE_URL`**. It never opens a connection to Neon and
  holds no production database credentials.
- The download endpoint refuses any entity that is not `DOWN`/`BIDIRECTIONAL`,
  which is also an access control: without it a device could name `employees` and
  read password hashes wholesale.
- Existing RBAC is untouched. The operator endpoints sit behind the normal
  `authenticate` + `requireRole` guards.

---

## 9. Configuration

| Variable | Default | Notes |
|---|---|---|
| `OFFLINE_MODE_ENABLED` | `false` | Master switch. Everything is inert without it. |
| `OFFLINE_ROLE` | `cloud` | `cloud` or `edge`. |
| `OFFLINE_DEVICE_ID` | — | **Required on edge.** Namespaces every idempotency key. |
| `LOCAL_DATABASE_PATH` | `./data/pos-local.db` | |
| `SYNC_CLOUD_URL` | — | **Required on edge.** |
| `SYNC_DEVICE_SECRET` | — | **Required.** Min 32 chars. |
| `SYNC_DOWNLOAD_BATCH_SIZE` | `500` | |
| `SYNC_UPLOAD_BATCH_SIZE` | `50` | ⚠ Do not raise. See below. |
| `SYNC_COMPRESSION_THRESHOLD` | `4096` | Gzip bodies above this. |
| `SYNC_MAX_ATTEMPTS` | `8` | Then the item parks as FAILED. |
| `SYNC_BASE_BACKOFF_MS` / `SYNC_MAX_BACKOFF_MS` | `2000` / `300000` | Full jitter. |
| `SYNC_PROBE_INTERVAL_MS` | `15000` | |
| `SYNC_PROBE_FAIL_THRESHOLD` / `_OK_THRESHOLD` | `2` / `2` | Hysteresis. |
| `SYNC_AUTO_ENABLED` / `SYNC_AUTO_INTERVAL_MS` | `true` / `60000` | |
| `SYNC_SIGNATURE_TOLERANCE_MS` | `300000` | Replay window. |

⚠ Two stores must never share an `OFFLINE_DEVICE_ID`. They would produce
colliding idempotency keys and the cloud would silently discard one store's
sales as duplicates.

⚠ **`SYNC_UPLOAD_BATCH_SIZE` is 50, and raising it breaks uploads.** The cloud
applies a batch in ONE interactive transaction budgeted at 120s
(`cloudApply.ts`). Against Neon a round trip costs ~330ms — **measured at 253ms
p50 to production and 270ms to a branch, from India to `us-east-1`, on
2026-08-06** — so 200 items cannot
finish inside that window: the transaction expires, the **whole batch rolls
back**, and the till retries the same doomed payload forever — a queue that
never drains while every individual item is perfectly valid. 50 leaves
comfortable headroom. A day's queue simply uploads as several batches, which the
receipt ledger already makes idempotent, so there is no cost to the smaller
size. This table previously documented `200`; that was doc/code drift, corrected
after validation confirmed 50.

---

## 10. Deployment

> **Status: implementation-complete, one gate remaining** (updated 2026-08-06).
> The Neon-branch steps are **done** — migration applied, `sync:validate` passed
> 64/64, till provisioned and verified
> ([PHASE8](PHASE8_NEON_BRANCH_VALIDATION_REPORT.md)). **The remaining gate is
> `sync:stress` on the real till hardware**, which cannot be satisfied from a
> laptop. Offline Mode stays disabled until that passes.

⚠ **Plan the overnight window against measured throughput, not hope.** Upload is
latency-bound at ~574 ms per queue item against `us-east-1` from India
(measured). A 3,000-sale day is ~12,000 items ≈ **2 hours** to drain; a
1,000-sale day ≈ 41 min. This fits a normal overnight close, but if the shop
runs bigger days or the window is short, **move the cloud node to a nearer
region** — it is the largest available speedup and needs no code change.

### Cloud node

```bash
npx prisma migrate deploy      # adds the four sync tables — purely additive
OFFLINE_MODE_ENABLED=true OFFLINE_ROLE=cloud SYNC_DEVICE_SECRET=<32+ chars> npm start
```

### Edge node

```bash
npm run db:local:setup         # build the local mirror
OFFLINE_MODE_ENABLED=true \
OFFLINE_ROLE=edge \
OFFLINE_DEVICE_ID=store-01-till-01 \
SYNC_CLOUD_URL=https://cloud.example.com \
SYNC_DEVICE_SECRET=<same secret> \
npm start
```

On first boot the mirror is empty, so the node runs an initial download
automatically and logs loudly that it cannot sell until it succeeds.

**For a new till, provision explicitly rather than relying on that first-boot
download.** The automatic path gets a catalog onto the machine; it does not
prove the mirror is one you can sell from, and it will happily build on top of
an inherited database — a mirror cloned from another till, or one left behind by
a stress run. `npm run till:provision` refuses those, guarantees a brand-new
SQLite file, and verifies the result before the till is declared ready:

```bash
npm run till:provision:check    # dry run — every safety check, nothing written
npm run till:provision          # build and verify the mirror
```

It refuses outright, with no override, if the local queue holds un-uploaded
sales. 📖 **[TILL_PROVISIONING_RUNBOOK.md](TILL_PROVISIONING_RUNBOOK.md).**

### Rolling back

Offline Mode is **startup-controlled**: the same build runs enabled or disabled,
so turning it off is a config change plus a full restart — no rebuild, no
redeploy, **no migration reversal, and no data deletion**.

```bash
# 1. Drain first, while still enabled (edge nodes):
curl -X POST localhost:3000/api/v1/sync/run -d '{"direction":"UPLOAD"}'
curl localhost:3000/api/v1/sync/status    # require pending == 0 AND inFlight == 0

# 2. Set OFFLINE_MODE_ENABLED=false, and unset OFFLINE_ROLE.
# 3. Ensure DATABASE_URL is set — a till normally has none by design.
# 4. FULL restart (not a watch-reload; the config is memoized).
```

Three things worth knowing before you do it:

- **Roll back edge nodes before the cloud node.** Disabling the cloud first
  makes every till's upload 404, burning retry attempts until items park as
  `FAILED` and need an explicit `POST /sync/retry`.
- **A disabled edge node switches from SQLite to Neon**, so it needs a
  `DATABASE_URL` it has never had. Without one it refuses to boot — fail-safe,
  and the error now says exactly this.
- **Never** run `npm run db:local:setup`, delete `data/pos-local.db`, or reverse
  the migration as part of a rollback. Those are the only ways to actually lose
  the queue.

📖 **Full procedure, including verification steps and re-enabling:
[OFFLINE_ROLLBACK_RUNBOOK.md](OFFLINE_ROLLBACK_RUNBOOK.md).**

---

## 11. Monitoring

| Endpoint | Role | Purpose |
|---|---|---|
| `GET /api/v1/sync/status` | any staff | Indicator data: queue depth, oldest item, last runs. |
| `GET /api/v1/sync/health` | any staff | Consistency check. **503 when unhealthy.** |
| `GET /api/v1/sync/history` | any staff | Past runs. |
| `POST /api/v1/sync/run` | any staff | "Sync Now". |
| `GET /api/v1/sync/queue` | MANAGER+ | The queue itself. |
| `GET /api/v1/sync/conflicts` | MANAGER+ | Local conflict log. |
| `GET /api/v1/sync/events` | MANAGER+ | Append-only breadcrumbs. |
| `POST /api/v1/sync/retry` | MANAGER+ | Requeue failed items. |
| `GET /api/v1/sync/devices` | OWNER | Fleet view. |
| `GET /api/v1/sync/cloud-conflicts` | OWNER | Central conflict audit. |

`/sync/health` returning **503** is the alarm to wire an uptime monitor to. A
till whose capture has broken is still selling perfectly — it has just stopped
recording anything that survives.

**The number that matters is `oldestPendingAgeSeconds`, not the pending count.**
200 items queued during a two-hour outage is the feature working exactly as
designed. Six items queued since Tuesday means sync has been broken for three
days and nobody noticed.

---

## 12. Recovery

Handled automatically at startup (`recoverAndBootstrap`):

| Symptom | Cause | Automatic repair |
|---|---|---|
| Run stuck in `RUNNING` | Process killed mid-sync | Marked `INTERRUPTED`. Without this, status reports "syncing" forever and the lock blocks every future run. |
| Items stuck `IN_FLIGHT` | Crash mid-batch | Returned to `PENDING`. |
| `captureEnabled = 0` | Download interrupted | Re-enabled, logged at ERROR. **Writes during that window were not captured** — run a consistency check. |
| Triggers missing | `db push` since last boot | Reinstalled. |
| Mirror empty | First boot | Initial download attempted. |

### Manual procedures

**Queue not draining.** `GET /sync/status` → check `connectivity.state`. If
online, `GET /sync/queue?status=FAILED` and read `lastError`. `POST /sync/retry`
requeues (deliberately without resetting `attempts` — the count is the record of
how much trouble an item has been).

**Suspected data loss after a crash.** `GET /sync/health`. A `captureTriggers.missing > 0`
or a capture-disabled finding means writes in that window were never queued.
Those rows still exist locally and can be replayed by touching them (any UPDATE
re-fires the trigger).

**Rebuild a corrupted local database.** The mirror is a disposable cache of the
cloud **plus an un-uploaded queue**. Drain the queue first if the file is
readable at all:

```bash
curl -X POST localhost:3000/api/v1/sync/run -d '{"direction":"UPLOAD"}'
# confirm pending = 0 before doing anything destructive
npm run db:local:setup
```

⚠ Never delete the local database file with a non-empty queue. That queue is the
only copy of every sale taken since the last successful upload.

---

## 13. Troubleshooting

**`The local SQLite mirror has no sync_queue table`** — run `npm run db:local:setup`.

**`Local SQLite refused PRAGMA foreign_keys=ON`** — the driver opened a second
connection or ran the pragma inside a transaction. The node refuses to serve
rather than accept orphan rows Postgres will later reject.

**`This raw SQL uses <construct>, which has no safe SQLite translation`** — a
report query used a Postgres-only construct. The message names the fix. It
throws rather than approximating because these queries compute money.

**`SQLite translation changed the parameter count of a raw query`** — a defensive
refusal. Mismatched placeholders would bind every value one position out.

**`Expected first argument to be a string`, from better-sqlite3** — a raw query
reached the driver without being translated. Prisma hands a query extension the
`Sql` object **wrapped in a single-element array**, and `rawSqlBridge` originally
recognized only the bare object and the positional `[sql, ...params]` form, so
`[Sql]` matched neither and fell through to the untranslated path. Fixed
2026-08-06; `rawSqlBridge.test.ts` pins all three shapes.

Two properties make this worth knowing rather than merely fixed. The bridge
already logged `raw query arrived in an unrecognized shape` — at **WARN**, so a
till running at `info` showed nothing. And the call site users hit constantly
(`closeOpenSessions`, on every login) is **fire-and-forget**, so logins kept
succeeding while `login_history` was silently never written: presence and session
history were empty on the till and nobody noticed. If that warning appears in a
log, treat it as an error — it means a query is running as Postgres against
SQLite.

**Sync 401s** — clock skew beyond `SYNC_SIGNATURE_TOLERANCE_MS`, a mismatched
`SYNC_DEVICE_SECRET`, or a deactivated device. The response is deliberately
identical for all three; check the cloud's logs, which record the real reason.

**Indicator shows "Not recording"** — capture is broken. The POS still takes
payments and records nothing that survives. Restart the node (reinstalls
triggers), then `GET /sync/health`. Do not close the day until it is clear.

**Conflicts every sync on unchanged rows** — should be impossible; numeric values
are compared by value and `updatedAt`/`createdAt` are excluded. If it recurs,
something is normalizing a column differently on the two sides — check
`describeDifferences` output in the conflict record.

---

## 14. Pre-production validation

Three harnesses, in the order they must be run.

> **Status (2026-08-06):** all three have now been run against a real Neon
> branch — migration applied, **64/64 end-to-end checks passed** with revenue
> reconciling to the paisa, and a till provisioned and verified (15/15). Full
> results, including two findings that changed this document, are in
> [PHASE8_NEON_BRANCH_VALIDATION_REPORT.md](PHASE8_NEON_BRANCH_VALIDATION_REPORT.md).
>
> **The remaining blocking gate is the real till hardware** (Phase 6). That run
> was made from a development laptop, so fsync cost, storage latency,
> responsiveness under load and the peripherals are still unmeasured.

### 14.1 Migration verification — `npm run sync:verify-migration`

Read-only by default. Proves, before anything is applied:

- every statement in the migration is a bare `CREATE` (allowlist; anything
  unrecognized fails);
- it creates exactly the four expected tables and no others;
- no earlier migration is half-applied;
- the four tables do not already exist;
- **what the live database actually needs** is only those four tables — which is
  how schema drift is caught before it becomes a failed deploy;
- prints live row counts for the tables holding money, so the backup decision is
  made on real numbers.

It does **not** take the backup. Neon backups need credentials this process does
not have, and a script claiming a backup it never took is worse than none:

```bash
neonctl branches create --name pre-offline-sync-$(date +%Y%m%d)
npm run sync:verify-migration -- --apply --i-have-taken-a-backup
```

⚠ `--apply` alone refuses. The backup flag is a deliberate speed bump.

### 14.2 End-to-end validation — `npm run sync:validate`

Drives a real business day through the real code paths:

1. **Morning** — download master data from the cloud.
2. **Day** — the HTTP listener is **closed at the socket** and a full day of
   trade is rung up against SQLite only. The transport fails the way it fails
   when a shop's router dies, not because a mock was told to.
3. **Night** — the listener reopens and the queue drains.
4. **Reconcile** — sales, sale items, payments, inventory movements, customers,
   attendance, expenses, audit and the idempotency ledger are compared across
   both databases.

It also re-uploads the entire day a second time and asserts the cloud row counts
do not move — the duplicate-prevention proof.

```bash
# Against a Neon branch, NOT production:
neonctl branches create --name sync-validation
DATABASE_URL=<branch-url> npm run sync:validate -- --transactions 200
```

⚠ This **writes**. It refuses to run unless the URL looks like a
test/staging/branch database, or `--i-accept-writes-to-this-database` is passed.
It also stops before writing anything if the migration has not been applied.

It runs in one process, which works only because `cloudApply` and `cloudServe`
address the cloud through `getCloudClient()` rather than the routed `prisma`
export. The process is an edge node whose routed writes go to SQLite, while
simultaneously serving the cloud half against Postgres. The data path is
identical to two machines; only the wire is shorter.

### 14.3 Stress and recovery — `npm run sync:stress`

Runs **without a cloud** by default. The expensive, risky parts of an offline
day are all local — the write path the cashier waits on, the trigger overhead on
every one of those writes, and the queue's behaviour at a day's depth — so they
can be measured before anything is provisioned, and re-measured on the actual
till hardware, which is where the number that matters comes from.

```bash
npm run sync:stress                                        # defaults: 1k products, 2k sales
npm run sync:stress -- --products 2000 --transactions 3000
```

⚠ **There is no `--with-cloud`.** This harness is local-only by construction. The
flag used to exist and never measured anything: its only effect was to suppress
the "cloud throughput NOT measured" footer, which turned an honest gap into a
green run that looked like it had covered the upload path. It now refuses with
exit 2. For the cloud half — real signed HTTP, upload drain, reconciliation —
run `sync:validate` (§14.2). See
[PHASE8_NEON_BRANCH_VALIDATION_REPORT §5](PHASE8_NEON_BRANCH_VALIDATION_REPORT.md).

**Measured 2026-08-05** — 2,000 products (4,000 catalog rows), 3,000 sales,
12,000 captured writes, on a development laptop. Retail hardware will be slower;
treat these as an upper bound, not a promise.

| Measure | Result |
|---|---|
| Catalog load (morning download's write side) | 4,000 rows in 1.5s — **2,700 rows/s** |
| Barcode / SKU lookup — the scan path | **0.28 ms** average |
| Checkout **with** change capture | 4.64 ms per sale |
| Checkout **without** capture (control) | 4.05 ms per sale |
| **Capture overhead** | **below the harness's noise floor — see the warning below** |
| Full day: 3,000 sales | 12.9s — **233 sales/s** sustained |
| Queue depth after the day | 12,000 items (4 per sale, exactly as expected) |
| Local database size | 16.5 MB |
| Process heap | 207 MB — the queue is streamed in batches, never loaded whole |
| Status aggregate (polled by every till screen) | **0.73 ms** at 12,000 items |
| Batch claim (200 items) | 4.1 ms |
| Idempotency keys unique | 12,000 / 12,000, all device-namespaced |
| Conflict decisions | 20,000 in 5 ms |

⚠ **Do not quote the capture-overhead figure.** A 2026-08-06 re-run of the same
harness produced **−34.9% (−2.54 ms)** — capture apparently making checkouts
*faster*, which is impossible. The harness runs a single unrepeated A/B with the
with-capture arm first on a colder database, no warm-up and no interleaving, so
the two arms differ by less than the run-to-run noise and the subtraction is
meaningless. The `+0.58 ms / +14%` previously printed here was the same artifact
with a favourable sign.

**What is solidly established is the absolute number: checkout costs ~5–7 ms
either way** — two orders of magnitude under the 250 ms threshold — and that is
what the decision rests on. Capture overhead is somewhere below the noise floor;
it is not a measured quantity yet. Fixing the A/B (repeat, interleave, discard a
warm-up) would make it one.

It also verifies, at volume:

- **Interrupted sync** — 500 items stranded `IN_FLIGHT` plus a run left
  `RUNNING`; after recovery, 0 still stranded, the run closed, and the queue
  total unchanged. Nothing lost, nothing invisible to the next drain.
- **Capture failure** — a write with capture disabled is confirmed *not*
  captured (which is why a stuck flag is an alarm, not a warning), the startup
  repair re-enables it, and capture resumes.
- **Conflict rules** — cloud wins a price change and logs it; the till wins a
  recorded sale; and Postgres `"12.50"` against SQLite `12.5` is recognized as
  identical rather than logged as a false conflict on every priced row.

⚠ Cloud-side upload throughput is **not** measured without `--with-cloud`. The
harness says so explicitly at the end of every run rather than letting a green
result imply more coverage than it has.

---

## 15. Tests

```bash
cd SERVER && npx vitest run src/offline/__tests__/   # 101 tests
cd CLIENT && npm test                                # includes the sync suite
```

The integration suite runs against a **real SQLite database** with the real
schema and real triggers — the properties under test are properties of the
database, and a mock would only assert that our code calls our code. It **skips**
(rather than fails) when the mirror has not been generated.

Two suites are **permanent security tests**, alongside the notification-audience
and account-guard suites already documented in `MODULE_STATUS §4.3`:

- `requestSignature.test.ts` — tamper, replay, path/method swap, timing.
- `policy.test.ts` — a till may not author Employee, catalog, prices or settings.

A failure in either after a refactor means the refactor is wrong.

---

## 16. Known limits

- **File assets do not sync.** An `Asset` row points at a file on that machine's
  disk; syncing the row without the bytes would give the cloud a broken link.
  Deliberate — file transfer is a separate problem this channel does not solve.
- **Multi-store is still a scope change, not a feature** (`MODULE_STATUS §5`).
  This adds multi-*device*, not multi-tenancy: every edge node syncs into the
  same single-store dataset.
- **Notification channel delivery** remains a documented TODO; offline changes
  nothing there.
- **The cloud migration is not applied automatically.** Run
  `npx prisma migrate deploy` when ready.
