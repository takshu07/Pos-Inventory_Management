-- =============================================================================
-- PROCUREMENT: PARTIAL GOODS RECEIPT
-- =============================================================================
-- Adds per-line receipt tracking so a purchase can be received in instalments.
-- Purely additive: no column is dropped, narrowed or retyped, and every
-- statement is idempotent so a re-run against a partially-applied database is
-- safe (this project applies migrations with `migrate deploy`, never `dev`).
-- =============================================================================

-- ── 1. New columns ──────────────────────────────────────────────────────────
ALTER TABLE "purchase_items"
  ADD COLUMN IF NOT EXISTS "receivedQuantity" INTEGER NOT NULL DEFAULT 0;

-- Completion timestamp of the goods receipt. NULL while a purchase is still
-- DRAFT/ORDERED/PARTIAL; set only when the last outstanding unit lands.
ALTER TABLE "purchases"
  ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3);

-- ── 2. Backfill history ─────────────────────────────────────────────────────
-- Purchases already marked RECEIVED were received in full under the old
-- all-or-nothing endpoint, and their stock movements are already posted.
-- Without this backfill they would read as 100% outstanding and the new
-- receive screen would invite a second receipt — double-counting stock.
UPDATE "purchase_items" pi
   SET "receivedQuantity" = pi."quantity"
  FROM "purchases" p
 WHERE pi."purchaseId" = p."id"
   AND p."status" = 'RECEIVED'
   AND pi."receivedQuantity" = 0;

-- Best-known completion time for those historical receipts. `updatedAt` is when
-- the row last changed, which for a RECEIVED purchase is the receipt itself.
UPDATE "purchases"
   SET "receivedAt" = "updatedAt"
 WHERE "status" = 'RECEIVED'
   AND "receivedAt" IS NULL;

-- ── 3. Payables backfill ────────────────────────────────────────────────────
-- createPurchase never initialised dueAmount, so every existing bill carries
-- dueAmount = 0 and is invisible to the payables queue even when nothing has
-- been paid. Seed the outstanding balance from what was actually paid.
-- Cancelled bills owe nothing and are left alone.
UPDATE "purchases"
   SET "dueAmount" = GREATEST("totalAmount" - "paidAmount", 0)
 WHERE "status" <> 'CANCELLED'
   AND "dueAmount" = 0
   AND "totalAmount" > "paidAmount";

-- Realign the status flag with the balance we just derived. Bills past their
-- agreed due date surface as OVERDUE; a NULL dueDate means no agreed term and
-- is treated as not-yet-due rather than immediately overdue.
UPDATE "purchases"
   SET "paymentStatus" = CASE
     WHEN "dueAmount" <= 0                              THEN 'PAID'
     WHEN "dueDate" IS NOT NULL AND "dueDate" < NOW()   THEN 'OVERDUE'
     WHEN "paidAmount" > 0                              THEN 'PARTIALLY_PAID'
     ELSE 'UNPAID'
   END::"SupplierPaymentStatus"
 WHERE "status" <> 'CANCELLED';

-- ── 4. Index for the outstanding-lines lookup ───────────────────────────────
-- The receive screen and the "what is still on order" rollups filter lines by
-- purchase and outstanding quantity.
CREATE INDEX IF NOT EXISTS "purchase_items_purchase_received_idx"
  ON "purchase_items" ("purchaseId", "receivedQuantity");
