-- =============================================================================
-- DRAWER RECONCILIATION: TRACEABILITY COLUMNS
-- =============================================================================
-- A closed shift freezes its rollups so a signed-off reconciliation can never
-- be rewritten by a late transaction. Those frozen columns were, however,
-- missing three figures the summary needs, so the closed-shift view rebuilt
-- them from the nearest available column and got them wrong:
--
--   cashCollected     The drawer follows the LEDGER (cash sales + cash exchange
--                     top-ups). The summary substituted `cashSales`, the SALES
--                     table's cash column, which by definition excludes top-ups
--                     because an exchange is not a sale. Every closed shift that
--                     took a cash top-up therefore under-reported cash collected
--                     by exactly that amount, and the residual was absorbed into
--                     "other adjustments" — so the drawer still appeared to add
--                     up while silently misattributing real money.
--   exchangeTopUps    Explains why total received exceeds gross sales.
--   storeCreditTotal  Refunds settled as credit. Moves no notes, so it must stay
--                     out of the drawer AND out of net revenue.
--
-- Purely additive: no column is dropped, narrowed or retyped, and every
-- statement is idempotent so a re-run against a partially-applied database is
-- safe (this project applies migrations with `migrate deploy`, never `dev`).
-- =============================================================================

-- ── 1. New columns ──────────────────────────────────────────────────────────
ALTER TABLE "cash_registers"
  ADD COLUMN IF NOT EXISTS "cashCollected" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "exchangeTopUps" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "storeCreditTotal" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- ── 2. Backfill history ─────────────────────────────────────────────────────
-- Shifts closed before these columns existed still have a drawer ledger, and
-- the ledger is the authoritative record of what physically entered the till.
-- Recovering cashCollected from it makes historical reconciliations correct
-- rather than merely self-consistent.
--
-- Only rows still at the default are touched, so re-running cannot overwrite a
-- value written at close by the application.
UPDATE "cash_registers" cr
   SET "cashCollected" = COALESCE((
         SELECT SUM(ct."amount")
           FROM "cash_transactions" ct
          WHERE ct."registerId" = cr."id"
            AND ct."type" = 'CASH_IN'
       ), 0)
 WHERE cr."status" <> 'OPEN'
   AND cr."cashCollected" = 0;

-- exchangeTopUps and storeCreditTotal cannot be recovered for already-closed
-- shifts: both are derived from payment and exchange rows joined across the
-- session window, and a shift closed months ago may since have had its window
-- overlap re-used by another cashier. Leaving them at 0 is the honest outcome —
-- they are informational figures only, excluded from the drawer and from net
-- revenue, so a zero understates a note rather than corrupting a reconciliation.
-- Newly closed shifts populate them at close.
