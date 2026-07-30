-- CreateEnum
CREATE TYPE "ReservationType" AS ENUM ('EXCHANGE', 'CUSTOMER_HOLD', 'ORDER', 'OTHER');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'FULFILLED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AdjustmentReason" AS ENUM ('DAMAGE', 'LOST', 'THEFT', 'MISCOUNT', 'SUPPLIER_ERROR', 'SYSTEM_CORRECTION', 'EXPIRED', 'OTHER');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CycleCountStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "type" "ReservationType" NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "heldFor" TEXT,
    "customerId" TEXT,
    "exchangeId" TEXT,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "storeCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantityChange" INTEGER NOT NULL,
    "stockAtRequest" INTEGER NOT NULL,
    "reason" "AdjustmentReason" NOT NULL,
    "notes" TEXT,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "movementId" TEXT,
    "storeCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_counts" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT,
    "status" "CycleCountStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "categoryId" TEXT,
    "brandId" TEXT,
    "supplierId" TEXT,
    "startedById" TEXT NOT NULL,
    "completedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "countedItems" INTEGER NOT NULL DEFAULT 0,
    "varianceItems" INTEGER NOT NULL DEFAULT 0,
    "netVariance" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "storeCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cycle_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_count_items" (
    "id" TEXT NOT NULL,
    "cycleCountId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "expectedQuantity" INTEGER NOT NULL,
    "countedQuantity" INTEGER,
    "variance" INTEGER,
    "notes" TEXT,
    "countedById" TEXT,
    "countedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cycle_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damaged_stock" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "movementId" TEXT,
    "isWrittenOff" BOOLEAN NOT NULL DEFAULT false,
    "writtenOffAt" TIMESTAMP(3),
    "reportedById" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storeCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "damaged_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_snapshots" (
    "id" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "stockValue" DECIMAL(14,2) NOT NULL,
    "retailValue" DECIMAL(14,2) NOT NULL,
    "averageCost" DECIMAL(10,2),
    "storeCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_reservations_variant_status_idx" ON "inventory_reservations"("variantId", "status");

-- CreateIndex
CREATE INDEX "inventory_reservations_expiry_idx" ON "inventory_reservations"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "inventory_reservations_customerId_idx" ON "inventory_reservations"("customerId");

-- CreateIndex
CREATE INDEX "inventory_reservations_exchangeId_idx" ON "inventory_reservations"("exchangeId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_movementId_key" ON "stock_adjustments"("movementId");

-- CreateIndex
CREATE INDEX "stock_adjustments_status_createdat_idx" ON "stock_adjustments"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "stock_adjustments_variantId_idx" ON "stock_adjustments"("variantId");

-- CreateIndex
CREATE INDEX "stock_adjustments_requestedById_idx" ON "stock_adjustments"("requestedById");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_counts_reference_key" ON "cycle_counts"("reference");

-- CreateIndex
CREATE INDEX "cycle_counts_status_startedat_idx" ON "cycle_counts"("status", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "cycle_count_items_variantId_idx" ON "cycle_count_items"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_count_items_cycleCountId_variantId_key" ON "cycle_count_items"("cycleCountId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "damaged_stock_movementId_key" ON "damaged_stock"("movementId");

-- CreateIndex
CREATE INDEX "damaged_stock_variantId_idx" ON "damaged_stock"("variantId");

-- CreateIndex
CREATE INDEX "damaged_stock_reportedat_idx" ON "damaged_stock"("reportedAt" DESC);

-- CreateIndex
CREATE INDEX "inventory_snapshots_date_idx" ON "inventory_snapshots"("snapshotDate" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_snapshots_snapshotDate_variantId_key" ON "inventory_snapshots"("snapshotDate", "variantId");

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_items" ADD CONSTRAINT "cycle_count_items_cycleCountId_fkey" FOREIGN KEY ("cycleCountId") REFERENCES "cycle_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_items" ADD CONSTRAINT "cycle_count_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_items" ADD CONSTRAINT "cycle_count_items_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damaged_stock" ADD CONSTRAINT "damaged_stock_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damaged_stock" ADD CONSTRAINT "damaged_stock_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damaged_stock" ADD CONSTRAINT "damaged_stock_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

