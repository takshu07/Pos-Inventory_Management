# Till Provisioning Runbook

How to take a brand-new cashier PC from "nothing installed" to a till that is
proven ready for Offline Mode — and how to recover when it goes wrong.

> **The one rule.** A till's `sync_queue` can hold sales that exist **nowhere
> else in the world** — not in Neon, not on paper. Provisioning destroys the
> local database. Everything in this document exists to keep those two facts
> from meeting.

---

## 1. What provisioning does

One command (`npm run till:provision`) runs six stages in order. Each is a gate:
a failure at any stage stops the run and restores what was there before.

| Stage | What happens | If it fails |
|---|---|---|
| **PREFLIGHT** | May we destroy what is here? Reads the existing database read-only. | Refuses. Nothing is written. |
| **QUARANTINE** | Existing mirror is **renamed**, never deleted. | Refuses. Nothing is written. |
| **BUILD** | `prisma db push` materializes the generated mirror into a new file. | Rolls back. |
| **IDENTITY** | Seeds device id, node state, capture flag; installs 102 triggers. | Rolls back. |
| **DOWNLOAD** | Pulls the complete master data from the cloud over signed HTTP. | Rolls back. |
| **VERIFY** | Proves the mirror is fit to sell from. | Rolls back. **The mirror is rejected, not handed to a cashier.** |

The command is **idempotent and safe to retry**. A failed run leaves the till
exactly as it was.

### What it never does

- **Never writes to the production database.** An edge node reaches the cloud
  only through the signed `/api/v1/sync/*` API. Provisioning reads; it does not
  write centrally.
- **Never deletes an existing mirror.** It renames it to
  `pos-local.db.superseded-<timestamp>` and restores it on any failure.
- **Never proceeds past pending uploads.** No flag overrides this.

---

## 2. Provisioning a new till — the operational steps

### A. Before you touch the machine

| # | Check | How |
|---|---|---|
| A1 | You know this till's **unique** device id | e.g. `store-01-till-03`. ⚠ Two tills sharing one id silently deduplicate each other's sales at the cloud. |
| A2 | The cloud node is up and serving `/api/v1/sync/*` | `curl https://cloud.example.com/api/v1/sync/health` |
| A3 | You hold the shared `SYNC_DEVICE_SECRET` (32+ chars) | Same value as the cloud node's. |
| A4 | The cloud sync tables exist | `npm run sync:verify-migration` |
| A5 | This machine is **not** already trading | If it is, see §3 — drain first. |

### B. Set the environment

An edge till's environment. Note what is **absent**: no `DATABASE_URL`. A till
holds no production database credentials by design.

```bash
export OFFLINE_MODE_ENABLED=true
export OFFLINE_ROLE=edge
export OFFLINE_DEVICE_ID=store-01-till-03          # ⚠ unique per till
export SYNC_CLOUD_URL=https://cloud.example.com
export SYNC_DEVICE_SECRET=<the shared 32+ char secret>
export LOCAL_DATABASE_PATH=./data/pos-local.db
unset DATABASE_URL
```

PowerShell:

```powershell
$env:OFFLINE_MODE_ENABLED = "true"
$env:OFFLINE_ROLE         = "edge"
$env:OFFLINE_DEVICE_ID    = "store-01-till-03"
$env:SYNC_CLOUD_URL       = "https://cloud.example.com"
$env:SYNC_DEVICE_SECRET   = "<the shared 32+ char secret>"
Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
```

### C. Build the local schema (once per machine)

```bash
cd SERVER
npm ci
npm run db:local:setup
```

### D. Dry run first

Always. It runs every preflight check and writes nothing.

```bash
npm run till:provision:check
```

Read the PREFLIGHT section of the output before continuing. See §5 for what
each finding means.

### E. Provision

```bash
# First-time provisioning on a clean machine:
npm run till:provision

# For the FIRST till of a rollout, also reconcile row counts against the cloud.
# This re-pages every entity — slower, and worth it once per deployment:
npm run till:provision -- --verify-against-cloud
```

Expect `RESULT: PROVISIONED` and every verification check ticked.

### F. Enable Offline Mode

Only after `RESULT: PROVISIONED`.

```bash
# OFFLINE_MODE_ENABLED=true is already set; restart the service fully.
# ⚠ A full restart, not a watch-reload — the config is memoized.
npm start
```

Then confirm the node came up as an edge till:

```bash
curl localhost:3000/api/v1/sync/status     # queue depth 0, mode "local"
curl localhost:3000/api/v1/sync/health     # 200, not 503
```

### G. Post-provisioning validation

| # | Check | Expected |
|---|---|---|
| G1 | `/api/v1/sync/health` | `200` |
| G2 | Scan a known barcode at the till | Product resolves |
| G3 | Ring up one test sale, then void it | Appears in `/api/v1/sync/queue` |
| G4 | `POST /api/v1/sync/run` `{"direction":"UPLOAD"}` | Queue drains to 0 |
| G5 | The test sale appears in the cloud | Confirms identity + signing end-to-end |
| G6 | Delete the `.superseded-` file | Only after G4 passes |

---

## 3. Re-provisioning a till that has been trading

This is the dangerous case. **Drain first.**

```bash
# 1. Upload everything, while Offline Mode is still enabled.
curl -X POST localhost:3000/api/v1/sync/run -d '{"direction":"UPLOAD"}'

# 2. REQUIRE both to be zero. Do not proceed otherwise.
curl localhost:3000/api/v1/sync/status
#    → pending == 0  AND  inFlight == 0

# 3. Items parked FAILED need a root-cause fix, then:
curl -X POST localhost:3000/api/v1/sync/retry
#    …and repeat from step 1.

# 4. Stop the service.
# 5. Only now:
npm run till:provision -- --i-understand-this-destroys-the-mirror
```

The confirmation flag means **"I accept that the local database will be
destroyed."** It does *not* override pending uploads — nothing does.

---

## 4. Recovery procedures

### The run failed and rolled back

Normal. The previous mirror is back at its original path and the till is exactly
as it was. Fix the cause (see §6) and re-run — the command is safe to retry.

### The run failed and the rollback ALSO failed (exit code 2)

The only case needing manual work. The old mirror is intact under its
`.superseded-` name.

```bash
cd SERVER/data
ls -la pos-local.db*

# Remove the partial mirror (all three SQLite files):
rm -f pos-local.db pos-local.db-wal pos-local.db-shm

# Restore the superseded one — all three files, same base name:
mv pos-local.db.superseded-<timestamp>      pos-local.db
mv pos-local.db.superseded-<timestamp>-wal  pos-local.db-wal   # if present
mv pos-local.db.superseded-<timestamp>-shm  pos-local.db-shm   # if present
```

> ⚠ A WAL-mode SQLite database is **three files**. Moving only the `.db` leaves
> a `-wal` belonging to a database that is no longer there, which SQLite reports
> as corruption.

Then restart and confirm the queue is intact before doing anything else:

```bash
npm start
curl localhost:3000/api/v1/sync/status
```

### The till was provisioned but cannot sell

Symptom: barcodes do not scan, or the catalog is empty.

```bash
# Is the mirror actually populated?
curl localhost:3000/api/v1/sync/status

# Force a download:
curl -X POST localhost:3000/api/v1/sync/run -d '{"direction":"DOWNLOAD"}'
```

If the catalog is still short, the download completed against a cloud that does
not hold the expected data. Re-provision with `--verify-against-cloud`, which
reconciles counts entity by entity and names the short ones.

### A till was accidentally provisioned with pending uploads

This cannot happen through the command — the check is BLOCKING with no override.
If a mirror was destroyed by other means, the `.superseded-` file is the only
copy. Restore it as above, then drain before doing anything else.

---

## 5. Preflight findings

Three severities. The distinction is the whole design.

| Severity | Meaning | Override |
|---|---|---|
| **BLOCKING** | Data would be destroyed that exists nowhere else, or the run is meaningless. | **None.** |
| **CONFIRMABLE** | Legitimate during re-provisioning, but must be stated aloud. | `--i-understand-this-destroys-the-mirror` |
| **ADVISORY** | Worth knowing. Never gates the run. | n/a — informational. |

### BLOCKING

| Code | Meaning | Fix |
|---|---|---|
| `PENDING_UPLOADS` | The mirror holds un-uploaded sales. **The only copy.** | Drain (§3). Never override. |
| `NOT_EDGE_ROLE` | `OFFLINE_ROLE` is not `edge`. | Run this on the till. |
| `OFFLINE_DISABLED` | `OFFLINE_MODE_ENABLED` is unset. | Set it for this command. |
| `NO_DEVICE_ID` | `OFFLINE_DEVICE_ID` is empty. | Set a unique id. |
| `NO_CLOUD_URL` | `SYNC_CLOUD_URL` is empty. | Set it. |

### CONFIRMABLE

| Code | Meaning |
|---|---|
| `DATABASE_NOT_EMPTY` | An existing mirror will be destroyed. Its queue is clean, so nothing unsent is lost. |
| `FOREIGN_MIRROR` | This mirror belongs to **another till**. Someone cloned a working machine. Provisioning is the correct fix. |
| `STRESS_DATABASE` | Built by a test harness. Contains synthetic sales that must never reach the cloud as real. |
| `SYNTHETIC_DEVICE_ID` | This till is configured with a harness-pattern device id (`e2e-`, `stress-`, `test-`). Its sales would collide with harness idempotency keys. |
| `EXISTING_DB_UNREADABLE` | The file will not open. Its queue **cannot be read**, so unsent sales cannot be ruled out. Preserve a copy first. |
| `QUEUE_UNREADABLE` / `NODE_STATE_UNREADABLE` / `SCHEMA_UNREADABLE` | A stale or partially initialized mirror. |

### ADVISORY

| Code | Meaning |
|---|---|
| `EDGE_HAS_DATABASE_URL` | This node holds Neon credentials. A real till has none by design. Harmless to provisioning; worth fixing before the till goes live. |
| `SYNTHETIC_DB_PATH` | `LOCAL_DATABASE_PATH` is a harness filename. |

---

## 6. Verification checklist

Every check the VERIFY stage runs. A non-advisory failure **rejects the mirror**.

| Check | What it catches |
|---|---|
| queue is empty | The download echoed cloud rows back into the queue (a capture-suppression failure), or the mirror is not fresh. |
| database integrity | `PRAGMA integrity_check`. Corruption from an interrupted write or a failing disk. |
| foreign key enforcement is ON | FKs silently not enforced → the till accepts orphans that Postgres rejects at upload, after the goods have left. |
| no foreign key violations | The download landed a child before its parent; part of the catalog is unreachable. |
| change-capture triggers installed | **The worst failure.** The till works perfectly and uploads nothing, forever. |
| device identity is initialized | The mirror carries another till's identity. |
| device identity is not a harness id | *(advisory)* Sales would collide with harness keys. |
| change capture is enabled | An interrupted download left capture off; every local write would go unqueued. |
| no fake idempotency keys | Keys not minted by the capture trigger. The cloud's UNIQUE index would misbehave in either direction. |
| no stress-test data | Synthetic sales, or — more seriously — stress data in the **cloud**. |
| download cursors initialized | No high-water marks; every night re-downloads the whole catalog. |
| cursors point at rows the mirror holds | **The silent killer.** A cursor ahead of its data means the rows between are never fetched by any future sync. Permanent, invisible gap. |
| cursor state matches downloaded data | Fewer local rows than were downloaded. |
| row counts match cloud expectations | *(`--verify-against-cloud`)* The download stopped early but wrote a plausible cursor. Only the cloud knows. |
| mirror holds no rows the cloud has not seen | *(advisory)* Residue survived the rebuild. |

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `RESULT: REFUSED`, `PENDING_UPLOADS` | The till has unsent sales. | Drain (§3). **Never** work around this. |
| `RESULT: REFUSED`, `DATABASE_NOT_EMPTY` | Re-provisioning a drained till. | Re-run with `--i-understand-this-destroys-the-mirror`. |
| Refused with `FOREIGN_MIRROR` | The mirror was copied from another till. | This is what provisioning fixes. Drain, then confirm. |
| Stage `BUILD` fails | `npm run db:local:setup` was never run, or Prisma CLI is missing. | `npm ci && npm run db:local:setup`. |
| Stage `DOWNLOAD` fails, `401` | `SYNC_DEVICE_SECRET` differs from the cloud's, or the device is deactivated. | Compare secrets. Check `/api/v1/sync/devices`. |
| Stage `DOWNLOAD` fails, connection refused | Cloud unreachable from the shop. | Check network, `SYNC_CLOUD_URL`, firewall. |
| Stage `DOWNLOAD` reports failed entities | A partial catalog. **Correctly rejected** — a till with half a catalog has barcodes that do not scan. | Fix connectivity and re-run. |
| Stage `VERIFY` fails, triggers missing | The schema was pushed after triggers were installed. | Re-run; provisioning reinstalls them. |
| Stage `VERIFY` fails, cursor points past data | A download was interrupted between write and commit. | Re-run. If it recurs, escalate — this indicates a real engine bug. |
| Stage `VERIFY` fails, stress data found | The **cloud** holds stress data. | Clean the cloud first. Do not provision tills from it. |
| Exit code 2 | Rollback failed. | §4, manual restore. Do not enable Offline Mode. |
| Till provisions but `/sync/health` is 503 | Capture broken or queue inconsistent. | Check `/api/v1/sync/events`. Re-provision. |

---

## 8. Command reference

```bash
# Dry run — every preflight check, nothing written. Always do this first.
npm run till:provision:check

# Provision a clean machine.
npm run till:provision

# Re-provision a drained till (destroys the existing mirror).
npm run till:provision -- --i-understand-this-destroys-the-mirror

# Also reconcile row counts against the cloud. Slower; do it for the first
# till of a rollout.
npm run till:provision -- --verify-against-cloud

# Rehearse the whole workflow against a stand-in cloud, on any machine,
# touching no real database. Useful for training and for CI.
npm run till:rehearse
```

| Exit code | Meaning |
|---|---|
| `0` | Provisioned and verified, or dry run passed. |
| `1` | Refused by preflight, or a stage failed and **was rolled back**. The till is unchanged. |
| `2` | Rolled back, but the restore **also failed**. Manual recovery needed (§4). |

---

## 9. Related documents

- [OFFLINE_FIRST.md](OFFLINE_FIRST.md) — the architecture provisioning builds for.
- [OFFLINE_ROLLBACK_RUNBOOK.md](OFFLINE_ROLLBACK_RUNBOOK.md) — turning Offline Mode **off**.
- [PHASE7_TILL_PROVISIONING_REPORT.md](PHASE7_TILL_PROVISIONING_REPORT.md) — implementation and validation evidence.
- [PHASE6_REAL_TILL_PREFLIGHT.md](PHASE6_REAL_TILL_PREFLIGHT.md) — hardware/stress preflight.
