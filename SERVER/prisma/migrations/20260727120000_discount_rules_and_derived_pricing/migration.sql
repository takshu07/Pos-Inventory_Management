-- =============================================================================
-- ENTERPRISE PRICING ENGINE — catalog discount rules + derived selling price
--
-- Introduces the CATALOG pricing layer (DiscountRule/DiscountHistory) and turns
-- ProductVariant.sellingPrice into a derived cache computed from
-- `mrp - effective discount` by the pricing engine.
--
-- The pre-existing `Promotion` table is untouched: it remains the BASKET layer
-- (min-spend offers, BOGO, coupons) evaluated at checkout.
--
-- The dead `discounts` table is dropped. It was never read or written by any
-- service, controller, route or repository — the only reference in the codebase
-- was a deleteMany() in the test-cleanup helper.
--
-- Applied via `prisma migrate diff` + manual execution because `prisma migrate
-- dev` cannot replay migration 20260723000000 against a shadow database.
-- =============================================================================

-- CreateEnum
CREATE TYPE "DiscountRuleScope" AS ENUM ('PRODUCT', 'CATEGORY', 'BRAND');

-- CreateEnum
CREATE TYPE "DiscountRuleType" AS ENUM ('PERCENTAGE', 'FLAT', 'BOGO', 'BUNDLE', 'TIERED');

-- CreateEnum
CREATE TYPE "DiscountStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'EXPIRED', 'DISABLED');

-- CreateEnum
CREATE TYPE "DiscountHistoryAction" AS ENUM ('CREATED', 'UPDATED', 'ENABLED', 'DISABLED', 'DELETED');

-- DropForeignKey
ALTER TABLE "discounts" DROP CONSTRAINT "discounts_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "discounts" DROP CONSTRAINT "discounts_productId_fkey";

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "appliedRuleId" TEXT,
ADD COLUMN     "defaultDiscountType" "DiscountRuleType" NOT NULL DEFAULT 'PERCENTAGE',
ADD COLUMN     "defaultDiscountValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "isManualPricing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priceComputedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "mrp" DECIMAL(10,2);

-- DropTable
DROP TABLE "discounts";

-- DropEnum
DROP TYPE "DiscountScope";

-- CreateTable
CREATE TABLE "discount_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" "DiscountRuleScope" NOT NULL,
    "type" "DiscountRuleType" NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "productId" TEXT,
    "categoryId" TEXT,
    "brandId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_history" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleName" TEXT NOT NULL,
    "action" "DiscountHistoryAction" NOT NULL,
    "oldData" JSONB,
    "newData" JSONB,
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discount_rules_active_lookup_idx" ON "discount_rules"("isEnabled", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "discount_rules_scope_isEnabled_idx" ON "discount_rules"("scope", "isEnabled");

-- CreateIndex
CREATE INDEX "discount_rules_productId_idx" ON "discount_rules"("productId");

-- CreateIndex
CREATE INDEX "discount_rules_categoryId_idx" ON "discount_rules"("categoryId");

-- CreateIndex
CREATE INDEX "discount_rules_brandId_idx" ON "discount_rules"("brandId");

-- CreateIndex
CREATE INDEX "discount_history_ruleId_idx" ON "discount_history"("ruleId");

-- CreateIndex
CREATE INDEX "discount_history_createdAt_idx" ON "discount_history"("createdAt");

-- AddForeignKey
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_history" ADD CONSTRAINT "discount_history_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "discount_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- HAND-WRITTEN ADDITIONS (below this line `prisma migrate diff` cannot generate)
-- =============================================================================

-- Scope/target integrity. Prisma cannot express "exactly one target column is
-- set, and it must be the one matching `scope`", so enforce it in the database.
-- Without this a PRODUCT-scoped rule could carry a categoryId and silently
-- never match anything.
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_scope_target_ck" CHECK (
  ("scope" = 'PRODUCT'  AND "productId"  IS NOT NULL AND "categoryId" IS NULL     AND "brandId" IS NULL) OR
  ("scope" = 'CATEGORY' AND "categoryId" IS NOT NULL AND "productId"  IS NULL     AND "brandId" IS NULL) OR
  ("scope" = 'BRAND'    AND "brandId"    IS NOT NULL AND "productId"  IS NULL     AND "categoryId" IS NULL)
);

-- A discount can never be negative, and a percentage can never exceed 100%.
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_value_ck" CHECK (
  "value" >= 0 AND ("type" <> 'PERCENTAGE' OR "value" <= 100)
);

-- An end date must not precede its start date.
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_date_order_ck" CHECK (
  "startDate" IS NULL OR "endDate" IS NULL OR "endDate" >= "startDate"
);

-- ── BACKFILL ────────────────────────────────────────────────────────────────
-- Seed each existing variant's default discount from its CURRENT mrp and
-- sellingPrice, expressed as a FLAT amount, and mark it as manually priced.
--
-- This is what makes the migration safe to deploy: because
--     sellingPrice = mrp - defaultDiscountValue
-- already holds by construction for every row, the pricing engine's first
-- recompute is a no-op and NO shelf price changes. Owners opt into derived
-- percentage pricing per product, at their own pace, from the Pricing screen.
--
-- GREATEST(...,0) guards the (currently non-existent, but historically possible)
-- case of sellingPrice > mrp, which would otherwise yield a negative discount.
-- Variants with mrp <= 0 are left at the column defaults (PERCENTAGE/0) since
-- there is no meaningful discount to express.
UPDATE "product_variants"
SET "defaultDiscountType"  = 'FLAT',
    "defaultDiscountValue" = GREATEST("mrp" - "sellingPrice", 0),
    "isManualPricing"      = true,
    "priceComputedAt"      = NOW()
WHERE "mrp" > 0;
