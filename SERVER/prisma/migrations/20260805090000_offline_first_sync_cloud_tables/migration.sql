-- =============================================================================
-- OFFLINE-FIRST SYNC — CLOUD-SIDE TABLES
--
-- Purely additive: four new tables, no column added to or removed from any
-- existing table, no data backfilled, no constraint changed. An existing
-- deployment can apply this with the offline feature switched off and observe
-- no behavioral difference whatsoever.
--
-- Hand-written because this project applies migrations with `prisma migrate
-- deploy`; `migrate dev` is unusable here (the historical _perf migration fails
-- shadow-database replay). See README.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- sync_receipts — the idempotency ledger.
--
-- The UNIQUE index on idempotency_key is the actual guarantee behind "no
-- duplicate uploads"; the application check is an optimization on top of it, so
-- that a race between two concurrent uploads of the same batch still cannot
-- book a sale twice.
-- -----------------------------------------------------------------------------
CREATE TABLE "sync_receipts" (
    "id"             TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "deviceId"       TEXT NOT NULL,
    "entity"         TEXT NOT NULL,
    "entityId"       TEXT NOT NULL,
    "operation"      TEXT NOT NULL,
    "result"         TEXT NOT NULL,
    "reason"         TEXT,
    "batchId"        TEXT NOT NULL,
    "appliedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sync_receipts_idempotencyKey_key" ON "sync_receipts"("idempotencyKey");
CREATE INDEX "sync_receipts_deviceId_appliedAt_idx" ON "sync_receipts"("deviceId", "appliedAt");
CREATE INDEX "sync_receipts_entity_entityId_idx" ON "sync_receipts"("entity", "entityId");
CREATE INDEX "sync_receipts_batchId_idx" ON "sync_receipts"("batchId");

-- -----------------------------------------------------------------------------
-- sync_nonces — single-use request nonces.
--
-- Only ever holds one replay window (minutes) of rows; the expiresAt index
-- supports the prune.
-- -----------------------------------------------------------------------------
CREATE TABLE "sync_nonces" (
    "nonce"     TEXT NOT NULL,
    "deviceId"  TEXT NOT NULL,
    "usedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_nonces_pkey" PRIMARY KEY ("nonce")
);

CREATE INDEX "sync_nonces_expiresAt_idx" ON "sync_nonces"("expiresAt");

-- -----------------------------------------------------------------------------
-- sync_devices — the fleet view.
-- -----------------------------------------------------------------------------
CREATE TABLE "sync_devices" (
    "deviceId"       TEXT NOT NULL,
    "label"          TEXT,
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUploadAt"   TIMESTAMP(3),
    "lastDownloadAt" TIMESTAMP(3),
    "itemsAccepted"  INTEGER NOT NULL DEFAULT 0,
    "itemsRejected"  INTEGER NOT NULL DEFAULT 0,
    "conflicts"      INTEGER NOT NULL DEFAULT 0,
    "lastQueueId"    INTEGER,

    CONSTRAINT "sync_devices_pkey" PRIMARY KEY ("deviceId")
);

-- -----------------------------------------------------------------------------
-- sync_conflict_records — cloud-side conflict audit.
--
-- localData is NOT NULL on purpose: a CLOUD_WINS resolution discards what the
-- shop recorded, and a row here without the discarded payload would make that
-- loss permanent and unexplainable.
-- -----------------------------------------------------------------------------
CREATE TABLE "sync_conflict_records" (
    "id"         TEXT NOT NULL,
    "deviceId"   TEXT NOT NULL,
    "entity"     TEXT NOT NULL,
    "entityId"   TEXT NOT NULL,
    "resolution" TEXT NOT NULL,
    "reason"     TEXT NOT NULL,
    "localData"  TEXT NOT NULL,
    "cloudData"  TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_conflict_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sync_conflict_records_deviceId_detectedAt_idx" ON "sync_conflict_records"("deviceId", "detectedAt");
CREATE INDEX "sync_conflict_records_entity_entityId_idx" ON "sync_conflict_records"("entity", "entityId");
