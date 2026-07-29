-- Adds the signed round-off adjustment used to reach a whole-rupee payable
-- total (Indian retail convention).
--
-- NOT NULL DEFAULT 0 is deliberate: existing sales were never rounded, so a
-- round-off of 0 is the historically accurate value for them and keeps the
-- invariant (subtotal - discount + tax + roundOff == grandTotal) true for
-- every past row without a backfill.
ALTER TABLE "sales" ADD COLUMN "roundOffAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
