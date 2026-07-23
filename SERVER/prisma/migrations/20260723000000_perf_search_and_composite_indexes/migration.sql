-- =============================================================================
-- PERFORMANCE MIGRATION — Search (trigram) + composite indexes
--
-- WHY:
--   The application searches customers, products, and variants with
--   `contains` (ILIKE '%term%'). A B-tree index CANNOT serve a leading-wildcard
--   ILIKE, so those queries fall back to a sequential scan (verified via
--   EXPLAIN on the live DB: "Seq Scan on customers ... Filter: name ~~* '%...%'").
--   At tens of thousands of rows this makes Customer/Product search scale
--   linearly with table size. pg_trgm GIN indexes make ILIKE '%term%'
--   index-assisted — the single largest scale win for search.
--
--   The three composite b-tree indexes serve the hottest ordered access
--   patterns: analytics (status + saleDate window), per-employee sales history,
--   and the analytics payment-method breakdown (saleId + status).
--
-- SAFETY:
--   * Additive only — no data changed; no column/table/constraint dropped.
--   * The statements below are byte-for-byte what `prisma migrate diff`
--     generates from the schema change, so `migrate deploy` records this as
--     applied with ZERO drift.
--   * On the current small tables the index build locks for milliseconds.
--     If ever applied to an already-huge table, build these CONCURRENTLY by
--     hand (outside a transaction) and then `prisma migrate resolve --applied`.
-- =============================================================================

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateIndex
CREATE INDEX "products_name_trgm_idx" ON "products" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "products_searchkeywords_trgm_idx" ON "products" USING GIN ("searchKeywords" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "product_variants_sku_trgm_idx" ON "product_variants" USING GIN ("sku" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "product_variants_barcode_trgm_idx" ON "product_variants" USING GIN ("barcode" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "customers_name_trgm_idx" ON "customers" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "customers_phone_trgm_idx" ON "customers" USING GIN ("phone" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "customers_email_trgm_idx" ON "customers" USING GIN ("email" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "customers_customercode_trgm_idx" ON "customers" USING GIN ("customerCode" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "sales_status_saledate_idx" ON "sales"("status", "saleDate" DESC);

-- CreateIndex
CREATE INDEX "sales_employeeid_saledate_idx" ON "sales"("employeeId", "saleDate" DESC);

-- CreateIndex
CREATE INDEX "payments_saleid_status_idx" ON "payments"("saleId", "status");
