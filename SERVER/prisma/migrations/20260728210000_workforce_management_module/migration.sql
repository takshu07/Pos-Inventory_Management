-- =============================================================================
-- WORKFORCE MANAGEMENT MODULE
--
-- Additive only. Every new Employee/LoginHistory column is nullable or has a
-- default, so existing rows and every existing query keep working untouched.
--
-- Three new tables (shifts, attendance, leave_requests) are the ONLY new
-- workforce storage. Activity, login history and performance are read from the
-- existing employee_actions, login_history, audit_logs and sales tables — the
-- module deliberately does not duplicate them.
-- =============================================================================

-- ── ENUMS ────────────────────────────────────────────────────────────────────

CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'PROBATION', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED');
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEK_OFF');
CREATE TYPE "AttendanceSource" AS ENUM ('SYSTEM', 'MANUAL', 'LOGIN_DERIVED', 'BIOMETRIC', 'GEO_FENCE');
CREATE TYPE "LeaveType" AS ENUM ('CASUAL', 'SICK', 'PAID', 'UNPAID', 'COMP_OFF');
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- New ActionType values. ALTER TYPE ... ADD VALUE cannot run inside a
-- transaction block in older PostgreSQL, but Prisma migrations on PG 12+
-- handle this fine; each is idempotent via IF NOT EXISTS.
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'PASSWORD_RESET';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'ROLE_CHANGED';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'PERMISSION_CHANGED';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'EMPLOYEE_DEACTIVATED';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'EMPLOYEE_REACTIVATED';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'CLOCK_IN';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'CLOCK_OUT';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'ATTENDANCE_ADJUSTED';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'SHIFT_ASSIGNED';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'LEAVE_REQUESTED';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'LEAVE_REVIEWED';

ALTER TYPE "ReferenceType" ADD VALUE IF NOT EXISTS 'EMPLOYEE';
ALTER TYPE "ReferenceType" ADD VALUE IF NOT EXISTS 'ATTENDANCE';
ALTER TYPE "ReferenceType" ADD VALUE IF NOT EXISTS 'SHIFT';
ALTER TYPE "ReferenceType" ADD VALUE IF NOT EXISTS 'LEAVE_REQUEST';

-- ── SHIFTS ───────────────────────────────────────────────────────────────────
-- Times are minutes-from-midnight integers, not timestamps: a shift is a
-- recurring wall-clock rule, not an instant. Avoids all DST/date arithmetic.

CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "graceMinutes" INTEGER NOT NULL DEFAULT 10,
    "expectedMinutes" INTEGER NOT NULL DEFAULT 480,
    "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "colorHex" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "storeCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shifts_name_key" ON "shifts"("name");
CREATE UNIQUE INDEX "shifts_code_key" ON "shifts"("code");
CREATE INDEX "shifts_isActive_idx" ON "shifts"("isActive");
CREATE INDEX "shifts_storeCode_idx" ON "shifts"("storeCode");

-- ── EMPLOYEE WORKFORCE COLUMNS ───────────────────────────────────────────────

ALTER TABLE "employees" ADD COLUMN "photoUrl" TEXT;
ALTER TABLE "employees" ADD COLUMN "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "employees" ADD COLUMN "emergencyContactName" TEXT;
ALTER TABLE "employees" ADD COLUMN "emergencyContactPhone" TEXT;
ALTER TABLE "employees" ADD COLUMN "emergencyContactRelation" TEXT;
ALTER TABLE "employees" ADD COLUMN "shiftId" TEXT;
ALTER TABLE "employees" ADD COLUMN "storeCode" TEXT;
ALTER TABLE "employees" ADD COLUMN "exitDate" TIMESTAMP(3);

ALTER TABLE "employees" ADD CONSTRAINT "employees_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Roster hot path: active staff of a given role.
CREATE INDEX "employees_role_isactive_idx" ON "employees"("role", "isActive");
CREATE INDEX "employees_employmentStatus_idx" ON "employees"("employmentStatus");
CREATE INDEX "employees_storeCode_idx" ON "employees"("storeCode");
CREATE INDEX "employees_shiftId_idx" ON "employees"("shiftId");

-- ── LOGIN HISTORY SESSION TRACKING ───────────────────────────────────────────
-- This table becomes the presence source of truth: an open session with a
-- recent heartbeat means "online". Presence is derived, never a mutable
-- boolean on employees that desyncs when a process dies.

ALTER TABLE "login_history" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "login_history" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "login_history" ADD COLUMN "durationMinutes" INTEGER;
ALTER TABLE "login_history" ADD COLUMN "endReason" TEXT;
ALTER TABLE "login_history" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "login_history" ADD COLUMN "storeCode" TEXT;

CREATE INDEX "login_history_employeeid_loginat_idx" ON "login_history"("employeeId", "loginAt" DESC);
CREATE INDEX "login_history_presence_idx" ON "login_history"("logoutAt", "lastSeenAt");

-- ── ATTENDANCE ───────────────────────────────────────────────────────────────
-- One row per employee per calendar day. The unique constraint is what makes
-- clock-in idempotent and "did X work on day D?" a single indexed lookup
-- instead of a scan over punch events.

CREATE TABLE "attendance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clockInAt" TIMESTAMP(3),
    "clockOutAt" TIMESTAMP(3),
    "shiftId" TEXT,
    "shiftStartMinute" INTEGER,
    "shiftEndMinute" INTEGER,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "source" "AttendanceSource" NOT NULL DEFAULT 'SYSTEM',
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyExitMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "markedById" TEXT,
    "storeCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- The module's core invariant: one attendance row per employee per day.
CREATE UNIQUE INDEX "attendance_employeeId_date_key" ON "attendance"("employeeId", "date");
CREATE INDEX "attendance_employeeid_date_idx" ON "attendance"("employeeId", "date" DESC);
CREATE INDEX "attendance_date_status_idx" ON "attendance"("date", "status");
CREATE INDEX "attendance_status_idx" ON "attendance"("status");
CREATE INDEX "attendance_storeCode_idx" ON "attendance"("storeCode");

ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_markedById_fkey"
    FOREIGN KEY ("markedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── LEAVE REQUESTS ───────────────────────────────────────────────────────────
-- Present now so Attendance can mark ON_LEAVE days from an authoritative
-- source. The request/approval UI is a later phase needing no schema change.

CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "totalDays" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewerNotes" TEXT,
    "storeCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leave_requests_employeeid_startdate_idx" ON "leave_requests"("employeeId", "startDate" DESC);
CREATE INDEX "leave_requests_status_idx" ON "leave_requests"("status");
CREATE INDEX "leave_requests_startDate_endDate_idx" ON "leave_requests"("startDate", "endDate");

ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── SEED: DEFAULT SHIFTS ─────────────────────────────────────────────────────
-- Every install needs at least one working shift or attendance cannot evaluate
-- late/early. These are data, so they are seeded here rather than in code.

INSERT INTO "shifts" ("id", "name", "code", "startMinute", "endMinute", "breakMinutes", "graceMinutes", "expectedMinutes", "colorHex", "updatedAt")
VALUES
    ('shift_morning_default', 'Morning (09:00 - 18:00)', 'MORNING', 540, 1080, 60, 10, 480, '#3b82f6', CURRENT_TIMESTAMP),
    ('shift_evening_default', 'Evening (13:00 - 22:00)', 'EVENING', 780, 1320, 60, 10, 480, '#8b5cf6', CURRENT_TIMESTAMP),
    ('shift_general_default', 'General (10:00 - 19:00)', 'GENERAL', 600, 1140, 60, 15, 480, '#10b981', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
