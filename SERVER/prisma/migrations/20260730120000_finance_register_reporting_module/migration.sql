-- =============================================================================
-- FINANCE, CASH REGISTER & REPORTING MODULE
--
-- Additive only. Every new column on an existing table is nullable or has a
-- DEFAULT that preserves the meaning of rows written before this migration:
--   * expenses.approvalStatus defaults to APPROVED, because an expense recorded
--     before the workflow existed WAS effectively approved on entry. Defaulting
--     it to PENDING would retroactively remove historical spend from the P&L.
--   * purchases.paymentStatus defaults to UNPAID and dueAmount is backfilled
--     from totalAmount, so existing bills appear as genuinely outstanding
--     payables rather than as silently settled.
-- =============================================================================

-- ── Enums ────────────────────────────────────────────────────────────────────

ALTER TYPE "ActionModule" ADD VALUE IF NOT EXISTS 'FINANCE';
ALTER TYPE "ActionModule" ADD VALUE IF NOT EXISTS 'CASH_REGISTER';
ALTER TYPE "ActionModule" ADD VALUE IF NOT EXISTS 'SUPPLIER_PAYMENT';
ALTER TYPE "ActionModule" ADD VALUE IF NOT EXISTS 'SALARY';
ALTER TYPE "ActionModule" ADD VALUE IF NOT EXISTS 'REPORT';

ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'REGISTER_OPENED';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'REGISTER_CLOSED';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'REGISTER_RECONCILED';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'CASH_DROP_RECORDED';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'CASH_PAYOUT_RECORDED';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'EXPENSE_APPROVED';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'EXPENSE_REJECTED';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'SUPPLIER_PAYMENT_RECORDED';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'SALARY_PAID';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'SALARY_ADJUSTED';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'REPORT_EXPORTED';

ALTER TYPE "ReferenceType" ADD VALUE IF NOT EXISTS 'CASH_REGISTER';
ALTER TYPE "ReferenceType" ADD VALUE IF NOT EXISTS 'CASH_DROP';
ALTER TYPE "ReferenceType" ADD VALUE IF NOT EXISTS 'CASH_PAYOUT';
ALTER TYPE "ReferenceType" ADD VALUE IF NOT EXISTS 'SUPPLIER_PAYMENT';
ALTER TYPE "ReferenceType" ADD VALUE IF NOT EXISTS 'SALARY_PAYMENT';
ALTER TYPE "ReferenceType" ADD VALUE IF NOT EXISTS 'SALARY_ADJUSTMENT';

ALTER TYPE "RegisterStatus" ADD VALUE IF NOT EXISTS 'RECONCILED';

DO $$ BEGIN
  CREATE TYPE "PayoutCategory" AS ENUM ('TEA', 'COURIER', 'PACKAGING', 'CLEANING', 'TRANSPORT', 'STATIONERY', 'MAINTENANCE', 'UTILITIES', 'STAFF_WELFARE', 'MISCELLANEOUS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RegisterActivityType" AS ENUM ('OPENED', 'SALE', 'REFUND', 'EXCHANGE', 'CASH_DROP', 'CASH_PAYOUT', 'EXPENSE', 'ADJUSTMENT', 'NOTE', 'CLOSED', 'RECONCILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupplierPaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SalaryPaymentStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SalaryAdjustmentType" AS ENUM ('ADVANCE', 'BONUS', 'OVERTIME', 'INCENTIVE', 'DEDUCTION', 'REIMBURSEMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── cash_registers: shift identity, physical count, frozen rollups ───────────

ALTER TABLE "cash_registers"
  ADD COLUMN IF NOT EXISTS "registerNumber"    TEXT NOT NULL DEFAULT 'REG-01',
  ADD COLUMN IF NOT EXISTS "sessionNumber"     TEXT,
  ADD COLUMN IF NOT EXISTS "countedCash"       DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "discrepancyReason" TEXT,
  ADD COLUMN IF NOT EXISTS "denominations"     JSONB,
  ADD COLUMN IF NOT EXISTS "cashSales"         DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "upiSales"          DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cardSales"         DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "otherSales"        DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "splitSales"        DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "refundTotal"       DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "exchangeTotal"     DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discountTotal"     DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cashDropTotal"     DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cashPayoutTotal"   DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "transactionCount"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "durationMinutes"   INTEGER,
  ADD COLUMN IF NOT EXISTS "reconciledById"    TEXT,
  ADD COLUMN IF NOT EXISTS "reconciledAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reconcileNotes"    TEXT,
  ADD COLUMN IF NOT EXISTS "storeCode"         TEXT;

ALTER TABLE "cash_registers"
  ALTER COLUMN "openingBalance"  TYPE DECIMAL(12,2),
  ALTER COLUMN "closingBalance"  TYPE DECIMAL(12,2),
  ALTER COLUMN "expectedBalance" TYPE DECIMAL(12,2),
  ALTER COLUMN "difference"      TYPE DECIMAL(12,2);

-- Historical sessions were closed before countedCash existed; the balance the
-- cashier entered at close IS what they counted, so backfill it rather than
-- leaving a null that renders as "never counted".
UPDATE "cash_registers" SET "countedCash" = "closingBalance" WHERE "countedCash" IS NULL AND "closingBalance" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "cash_registers_sessionNumber_key" ON "cash_registers"("sessionNumber");
CREATE INDEX IF NOT EXISTS "cash_registers_number_status_idx"          ON "cash_registers"("registerNumber", "status");
CREATE INDEX IF NOT EXISTS "cash_registers_employee_openedat_idx"      ON "cash_registers"("openedById", "openedAt" DESC);
CREATE INDEX IF NOT EXISTS "cash_registers_storeCode_idx"              ON "cash_registers"("storeCode");

ALTER TABLE "cash_registers"
  DROP CONSTRAINT IF EXISTS "cash_registers_reconciledById_fkey";
ALTER TABLE "cash_registers"
  ADD CONSTRAINT "cash_registers_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── cash_transactions ────────────────────────────────────────────────────────

ALTER TABLE "cash_transactions" ALTER COLUMN "amount" TYPE DECIMAL(12,2);
CREATE INDEX IF NOT EXISTS "cash_transactions_register_type_idx" ON "cash_transactions"("registerId", "type");

-- ── cash_drops ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "cash_drops" (
    "id"              TEXT NOT NULL,
    "registerId"      TEXT NOT NULL,
    "dropNumber"      TEXT NOT NULL,
    "amount"          DECIMAL(12,2) NOT NULL,
    "reason"          TEXT NOT NULL,
    "destination"     TEXT,
    "referenceNumber" TEXT,
    "employeeId"      TEXT NOT NULL,
    "witnessedById"   TEXT,
    "storeCode"       TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_drops_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cash_drops_dropNumber_key" ON "cash_drops"("dropNumber");
CREATE INDEX IF NOT EXISTS "cash_drops_registerId_idx"  ON "cash_drops"("registerId");
CREATE INDEX IF NOT EXISTS "cash_drops_employeeId_idx"  ON "cash_drops"("employeeId");
CREATE INDEX IF NOT EXISTS "cash_drops_createdat_idx"   ON "cash_drops"("createdAt" DESC);

-- ── expenses: approval workflow, receipt, drawer link ────────────────────────

ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "approvalStatus"  "ApprovalStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS "approvedById"    TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptAssetId"  TEXT,
  ADD COLUMN IF NOT EXISTS "registerId"      TEXT,
  ADD COLUMN IF NOT EXISTS "storeCode"       TEXT;

ALTER TABLE "expenses" ALTER COLUMN "amount" TYPE DECIMAL(12,2);

CREATE INDEX IF NOT EXISTS "expenses_approvalStatus_idx"   ON "expenses"("approvalStatus");
CREATE INDEX IF NOT EXISTS "expenses_registerId_idx"       ON "expenses"("registerId");
CREATE INDEX IF NOT EXISTS "expenses_approval_date_idx"    ON "expenses"("approvalStatus", "expenseDate" DESC);

ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_approvedById_fkey";
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_registerId_fkey";
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── expense_categories: machine key, ordering, fixed-vs-variable ─────────────

ALTER TABLE "expense_categories"
  ADD COLUMN IF NOT EXISTS "code"         TEXT,
  ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "isRecurring"  BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "expense_categories_code_key"        ON "expense_categories"("code");
CREATE INDEX        IF NOT EXISTS "expense_categories_displayOrder_idx" ON "expense_categories"("displayOrder");

-- ── cash_payouts ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "cash_payouts" (
    "id"              TEXT NOT NULL,
    "registerId"      TEXT NOT NULL,
    "payoutNumber"    TEXT NOT NULL,
    "category"        "PayoutCategory" NOT NULL,
    "amount"          DECIMAL(12,2) NOT NULL,
    "reason"          TEXT NOT NULL,
    "payeeName"       TEXT,
    "receiptAssetId"  TEXT,
    "approvalStatus"  "ApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "approvedById"    TEXT,
    "approvedAt"      TIMESTAMP(3),
    "rejectionReason" TEXT,
    "employeeId"      TEXT NOT NULL,
    "expenseId"       TEXT,
    "storeCode"       TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_payouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cash_payouts_payoutNumber_key" ON "cash_payouts"("payoutNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "cash_payouts_expenseId_key"    ON "cash_payouts"("expenseId");
CREATE INDEX IF NOT EXISTS "cash_payouts_registerId_idx"     ON "cash_payouts"("registerId");
CREATE INDEX IF NOT EXISTS "cash_payouts_category_idx"       ON "cash_payouts"("category");
CREATE INDEX IF NOT EXISTS "cash_payouts_approvalStatus_idx" ON "cash_payouts"("approvalStatus");
CREATE INDEX IF NOT EXISTS "cash_payouts_createdat_idx"      ON "cash_payouts"("createdAt" DESC);

-- ── register_activities ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "register_activities" (
    "id"            TEXT NOT NULL,
    "registerId"    TEXT NOT NULL,
    "type"          "RegisterActivityType" NOT NULL,
    "description"   TEXT NOT NULL,
    "amount"        DECIMAL(12,2) NOT NULL DEFAULT 0,
    "balanceAfter"  DECIMAL(12,2),
    "referenceType" "ReferenceType",
    "referenceId"   TEXT,
    "employeeId"    TEXT NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "register_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "register_activities_register_createdat_idx" ON "register_activities"("registerId", "createdAt");
CREATE INDEX IF NOT EXISTS "register_activities_type_idx"               ON "register_activities"("type");

-- ── purchases: payables ──────────────────────────────────────────────────────

ALTER TABLE "purchases"
  ADD COLUMN IF NOT EXISTS "paidAmount"    DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "dueAmount"     DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "paymentStatus" "SupplierPaymentStatus" NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN IF NOT EXISTS "dueDate"       TIMESTAMP(3);

-- Backfill: an unpaid bill owes its full total. Cancelled purchases owe nothing.
UPDATE "purchases"
   SET "dueAmount" = CASE WHEN "status" = 'CANCELLED' THEN 0 ELSE "totalAmount" END,
       "paymentStatus" = CASE WHEN "status" = 'CANCELLED' THEN 'CANCELLED'::"SupplierPaymentStatus" ELSE 'UNPAID'::"SupplierPaymentStatus" END
 WHERE "dueAmount" = 0 AND "paidAmount" = 0;

CREATE INDEX IF NOT EXISTS "purchases_paymentstatus_duedate_idx"     ON "purchases"("paymentStatus", "dueDate");
CREATE INDEX IF NOT EXISTS "purchases_supplier_paymentstatus_idx"    ON "purchases"("supplierId", "paymentStatus");

-- ── supplier_payments ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "supplier_payments" (
    "id"              TEXT NOT NULL,
    "paymentNumber"   TEXT NOT NULL,
    "supplierId"      TEXT NOT NULL,
    "purchaseId"      TEXT,
    "amount"          DECIMAL(12,2) NOT NULL,
    "paymentMethod"   "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "referenceNumber" TEXT,
    "notes"           TEXT,
    "paidAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registerId"      TEXT,
    "createdById"     TEXT NOT NULL,
    "storeCode"       TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "supplier_payments_paymentNumber_key" ON "supplier_payments"("paymentNumber");
CREATE INDEX IF NOT EXISTS "supplier_payments_supplier_paidat_idx" ON "supplier_payments"("supplierId", "paidAt" DESC);
CREATE INDEX IF NOT EXISTS "supplier_payments_purchaseId_idx"      ON "supplier_payments"("purchaseId");
CREATE INDEX IF NOT EXISTS "supplier_payments_paidat_idx"          ON "supplier_payments"("paidAt" DESC);

-- ── salary_payments ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "salary_payments" (
    "id"              TEXT NOT NULL,
    "paymentNumber"   TEXT NOT NULL,
    "employeeId"      TEXT NOT NULL,
    "periodYear"      INTEGER NOT NULL,
    "periodMonth"     INTEGER NOT NULL,
    "baseSalary"      DECIMAL(12,2) NOT NULL,
    "totalBonus"      DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalOvertime"   DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalIncentive"  DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAdvance"    DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalDeduction"  DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netPayable"      DECIMAL(12,2) NOT NULL,
    "paidAmount"      DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dueAmount"       DECIMAL(12,2) NOT NULL,
    "status"          "SalaryPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod"   "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "paidAt"          TIMESTAMP(3),
    "referenceNumber" TEXT,
    "notes"           TEXT,
    "registerId"      TEXT,
    "createdById"     TEXT NOT NULL,
    "paidById"        TEXT,
    "storeCode"       TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "salary_payments_paymentNumber_key" ON "salary_payments"("paymentNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "salary_payments_employeeId_periodYear_periodMonth_key" ON "salary_payments"("employeeId", "periodYear", "periodMonth");
CREATE INDEX IF NOT EXISTS "salary_payments_status_idx"  ON "salary_payments"("status");
CREATE INDEX IF NOT EXISTS "salary_payments_period_idx"  ON "salary_payments"("periodYear", "periodMonth");
CREATE INDEX IF NOT EXISTS "salary_payments_paidat_idx"  ON "salary_payments"("paidAt" DESC);

-- ── salary_adjustments ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "salary_adjustments" (
    "id"              TEXT NOT NULL,
    "salaryPaymentId" TEXT NOT NULL,
    "type"            "SalaryAdjustmentType" NOT NULL,
    "amount"          DECIMAL(12,2) NOT NULL,
    "reason"          TEXT NOT NULL,
    "registerId"      TEXT,
    "createdById"     TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "salary_adjustments_salaryPaymentId_idx" ON "salary_adjustments"("salaryPaymentId");
CREATE INDEX IF NOT EXISTS "salary_adjustments_type_idx"            ON "salary_adjustments"("type");

-- ── Foreign keys ─────────────────────────────────────────────────────────────

ALTER TABLE "cash_drops" DROP CONSTRAINT IF EXISTS "cash_drops_registerId_fkey";
ALTER TABLE "cash_drops" ADD CONSTRAINT "cash_drops_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_drops" DROP CONSTRAINT IF EXISTS "cash_drops_employeeId_fkey";
ALTER TABLE "cash_drops" ADD CONSTRAINT "cash_drops_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_drops" DROP CONSTRAINT IF EXISTS "cash_drops_witnessedById_fkey";
ALTER TABLE "cash_drops" ADD CONSTRAINT "cash_drops_witnessedById_fkey" FOREIGN KEY ("witnessedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cash_payouts" DROP CONSTRAINT IF EXISTS "cash_payouts_registerId_fkey";
ALTER TABLE "cash_payouts" ADD CONSTRAINT "cash_payouts_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_payouts" DROP CONSTRAINT IF EXISTS "cash_payouts_employeeId_fkey";
ALTER TABLE "cash_payouts" ADD CONSTRAINT "cash_payouts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_payouts" DROP CONSTRAINT IF EXISTS "cash_payouts_approvedById_fkey";
ALTER TABLE "cash_payouts" ADD CONSTRAINT "cash_payouts_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cash_payouts" DROP CONSTRAINT IF EXISTS "cash_payouts_expenseId_fkey";
ALTER TABLE "cash_payouts" ADD CONSTRAINT "cash_payouts_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "register_activities" DROP CONSTRAINT IF EXISTS "register_activities_registerId_fkey";
ALTER TABLE "register_activities" ADD CONSTRAINT "register_activities_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "cash_registers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "register_activities" DROP CONSTRAINT IF EXISTS "register_activities_employeeId_fkey";
ALTER TABLE "register_activities" ADD CONSTRAINT "register_activities_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payments" DROP CONSTRAINT IF EXISTS "supplier_payments_supplierId_fkey";
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" DROP CONSTRAINT IF EXISTS "supplier_payments_purchaseId_fkey";
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" DROP CONSTRAINT IF EXISTS "supplier_payments_createdById_fkey";
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" DROP CONSTRAINT IF EXISTS "supplier_payments_registerId_fkey";
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "salary_payments" DROP CONSTRAINT IF EXISTS "salary_payments_employeeId_fkey";
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salary_payments" DROP CONSTRAINT IF EXISTS "salary_payments_createdById_fkey";
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salary_payments" DROP CONSTRAINT IF EXISTS "salary_payments_paidById_fkey";
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "salary_payments" DROP CONSTRAINT IF EXISTS "salary_payments_registerId_fkey";
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "salary_adjustments" DROP CONSTRAINT IF EXISTS "salary_adjustments_salaryPaymentId_fkey";
ALTER TABLE "salary_adjustments" ADD CONSTRAINT "salary_adjustments_salaryPaymentId_fkey" FOREIGN KEY ("salaryPaymentId") REFERENCES "salary_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "salary_adjustments" DROP CONSTRAINT IF EXISTS "salary_adjustments_createdById_fkey";
ALTER TABLE "salary_adjustments" ADD CONSTRAINT "salary_adjustments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Data integrity guards Prisma cannot express ──────────────────────────────

-- A discrepancy without a stated reason is how cash shrinkage becomes
-- untraceable. Enforced here as well as in validation so a direct SQL write
-- cannot bypass it.
ALTER TABLE "cash_registers" DROP CONSTRAINT IF EXISTS "cash_registers_discrepancy_reason_ck";
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_discrepancy_reason_ck"
  CHECK ("difference" IS NULL OR "difference" = 0 OR "discrepancyReason" IS NOT NULL);

-- Salary adjustments carry direction in `type`; a negative amount would let a
-- deduction be entered as a negative bonus and net out invisibly.
ALTER TABLE "salary_adjustments" DROP CONSTRAINT IF EXISTS "salary_adjustments_amount_positive_ck";
ALTER TABLE "salary_adjustments" ADD CONSTRAINT "salary_adjustments_amount_positive_ck" CHECK ("amount" > 0);

ALTER TABLE "cash_drops" DROP CONSTRAINT IF EXISTS "cash_drops_amount_positive_ck";
ALTER TABLE "cash_drops" ADD CONSTRAINT "cash_drops_amount_positive_ck" CHECK ("amount" > 0);

ALTER TABLE "cash_payouts" DROP CONSTRAINT IF EXISTS "cash_payouts_amount_positive_ck";
ALTER TABLE "cash_payouts" ADD CONSTRAINT "cash_payouts_amount_positive_ck" CHECK ("amount" > 0);

ALTER TABLE "salary_payments" DROP CONSTRAINT IF EXISTS "salary_payments_period_month_ck";
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_period_month_ck" CHECK ("periodMonth" BETWEEN 1 AND 12);
