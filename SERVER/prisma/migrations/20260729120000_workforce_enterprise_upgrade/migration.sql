-- =============================================================================
-- WORKFORCE ENTERPRISE UPGRADE
--
-- Additive only. Every new column is nullable or defaulted, and the one new
-- table is independent, so existing rows and every existing query keep working
-- untouched. Nothing is dropped or renamed.
--
-- What this adds and why:
--   1. employee_notes  — OWNER-only internal HR notes (drawer Notes tab).
--   2. attendance      — real break tracking, distinct from the shift's
--                        nominal break allowance.
--   3. employees       — assigned register/counter + monthly sales target,
--                        the denominator of Target Achievement.
--   4. login_history   — parsed OS and force-termination attribution for the
--                        security dashboard.
-- =============================================================================

-- ── ENUMS ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "EmployeeNoteCategory" AS ENUM ('GENERAL', 'PRAISE', 'TRAINING', 'PROMOTION', 'WARNING');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── EMPLOYEE NOTES ───────────────────────────────────────────────────────────
-- OWNER-only by service enforcement. Deliberately NO per-note visibility flag:
-- a per-row toggle invites a bug that leaks one note, so the whole table is
-- private and the service is the single gate.

CREATE TABLE IF NOT EXISTS "employee_notes" (
  "id"         TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "authorId"   TEXT NOT NULL,
  "category"   "EmployeeNoteCategory" NOT NULL DEFAULT 'GENERAL',
  "body"       TEXT NOT NULL,
  "isPinned"   BOOLEAN NOT NULL DEFAULT false,
  "storeCode"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "employee_notes_pkey" PRIMARY KEY ("id")
);

-- Cascade on the subject: deleting an employee removes notes about them.
-- Restrict on the author: an owner who wrote notes cannot be hard-deleted out
-- from under the audit trail.
ALTER TABLE "employee_notes"
  ADD CONSTRAINT "employee_notes_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_notes"
  ADD CONSTRAINT "employee_notes_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The drawer's Notes tab reads exactly this order: pinned first, then newest.
CREATE INDEX IF NOT EXISTS "employee_notes_employeeid_pinned_createdat_idx"
  ON "employee_notes"("employeeId", "isPinned", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "employee_notes_category_idx"
  ON "employee_notes"("category");

-- ── ATTENDANCE: BREAK TRACKING ───────────────────────────────────────────────
-- `breakMinutes` here is the ACTUAL break taken, as opposed to shifts.breakMinutes
-- which is the nominal allowance. `breakStartedAt` is non-null only while a
-- break is open, making "on break" a derived state rather than a stored flag
-- that can desync when a process dies.

ALTER TABLE "attendance" ADD COLUMN IF NOT EXISTS "breakMinutes"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "attendance" ADD COLUMN IF NOT EXISTS "breakStartedAt" TIMESTAMP(3);

-- ── EMPLOYEES: REGISTER + TARGET ─────────────────────────────────────────────
-- assignedRegister is free text, not a FK to cash_registers: a cash_registers
-- row is one OPENING SESSION of a till, not the till itself, so a FK would bind
-- an employee to a single shift's drawer rather than the physical counter.
--
-- monthlyTarget is NULLABLE on purpose. NULL means "no target set" and must
-- render as such — a 0 default would read as total failure rather than as an
-- unconfigured value.

ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "assignedRegister" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "monthlyTarget"    DECIMAL(12,2);

-- ── LOGIN HISTORY: OS + FORCED TERMINATION ───────────────────────────────────
-- operatingSystem is stored rather than parsed on read so the security table
-- can filter and group by it in SQL. terminatedById attributes an OWNER-forced
-- logout; together with endReason = 'TERMINATED' it is the audit trail.

ALTER TABLE "login_history" ADD COLUMN IF NOT EXISTS "operatingSystem" TEXT;
ALTER TABLE "login_history" ADD COLUMN IF NOT EXISTS "terminatedById"  TEXT;

-- Failed-login forensics: "which IPs failed, most recent first". Partial index
-- because successful logins vastly outnumber failures and are never this query.
CREATE INDEX IF NOT EXISTS "login_history_failed_attempts_idx"
  ON "login_history"("ipAddress", "loginAt" DESC)
  WHERE "isSuccessful" = false;
