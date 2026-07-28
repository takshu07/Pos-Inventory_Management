-- CreateEnum
CREATE TYPE "LabelTemplateKind" AS ENUM ('PRODUCT', 'BARCODE_ONLY', 'PRICE_TAG', 'SALE_TAG', 'CLEARANCE_TAG', 'SHELF_LABEL', 'WAREHOUSE_LABEL', 'QR_LABEL', 'RFID_TAG', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BarcodeSymbology" AS ENUM ('EAN13', 'CODE128', 'CODE39', 'UPC', 'ITF14', 'QR', 'DATA_MATRIX', 'NONE');

-- CreateEnum
CREATE TYPE "PrinterConnectionType" AS ENUM ('NETWORK', 'USB', 'BLUETOOTH', 'CLOUD', 'VIRTUAL');

-- CreateEnum
CREATE TYPE "PrinterDriverType" AS ENUM ('ESC_POS', 'TSPL', 'ZPL', 'DYMO', 'PDF', 'PREVIEW', 'NULL');

-- CreateEnum
CREATE TYPE "PrinterStatus" AS ENUM ('ONLINE', 'OFFLINE', 'ERROR', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PrintJobStatus" AS ENUM ('QUEUED', 'PENDING', 'PRINTING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrintJobItemStatus" AS ENUM ('PENDING', 'PRINTING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PrintSourceModule" AS ENUM ('PRODUCT', 'PURCHASE', 'INVENTORY', 'SALE', 'SEARCH', 'BATCH', 'MANUAL');

-- CreateEnum
CREATE TYPE "PrintOutputMode" AS ENUM ('PREVIEW', 'PDF', 'THERMAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActionModule" ADD VALUE 'LABEL';
ALTER TYPE "ActionModule" ADD VALUE 'PRINTER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActionType" ADD VALUE 'LABEL_PREVIEW_GENERATED';
ALTER TYPE "ActionType" ADD VALUE 'LABEL_PDF_GENERATED';
ALTER TYPE "ActionType" ADD VALUE 'LABEL_PRINT_STARTED';
ALTER TYPE "ActionType" ADD VALUE 'LABEL_PRINT_COMPLETED';
ALTER TYPE "ActionType" ADD VALUE 'LABEL_PRINT_FAILED';
ALTER TYPE "ActionType" ADD VALUE 'LABEL_REPRINTED';
ALTER TYPE "ActionType" ADD VALUE 'PRINTER_CHANGED';
ALTER TYPE "ActionType" ADD VALUE 'LABEL_TEMPLATE_CHANGED';
ALTER TYPE "ActionType" ADD VALUE 'PRINTER_SETTINGS_CHANGED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReferenceType" ADD VALUE 'LABEL_TEMPLATE';
ALTER TYPE "ReferenceType" ADD VALUE 'PRINTER';
ALTER TYPE "ReferenceType" ADD VALUE 'PRINT_JOB';

-- CreateTable
CREATE TABLE "label_templates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "LabelTemplateKind" NOT NULL DEFAULT 'PRODUCT',
    "widthMm" DECIMAL(6,2) NOT NULL,
    "heightMm" DECIMAL(6,2) NOT NULL,
    "marginTopMm" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "marginRightMm" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "marginBottomMm" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "marginLeftMm" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "elements" JSONB NOT NULL DEFAULT '[]',
    "barcodeSymbology" "BarcodeSymbology" NOT NULL DEFAULT 'EAN13',
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "storeCode" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "label_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "connection" "PrinterConnectionType" NOT NULL DEFAULT 'NETWORK',
    "driver" "PrinterDriverType" NOT NULL DEFAULT 'ESC_POS',
    "status" "PrinterStatus" NOT NULL DEFAULT 'UNKNOWN',
    "host" TEXT,
    "port" INTEGER,
    "devicePath" TEXT,
    "vendorId" TEXT,
    "productId" TEXT,
    "endpointUrl" TEXT,
    "location" TEXT,
    "dpi" INTEGER NOT NULL DEFAULT 203,
    "defaultWidthMm" DECIMAL(6,2) NOT NULL DEFAULT 50,
    "defaultHeightMm" DECIMAL(6,2) NOT NULL DEFAULT 25,
    "darkness" INTEGER NOT NULL DEFAULT 8,
    "printSpeed" INTEGER NOT NULL DEFAULT 4,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "printers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_jobs" (
    "id" TEXT NOT NULL,
    "jobNumber" TEXT NOT NULL,
    "printerId" TEXT,
    "templateId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'QUEUED',
    "source" "PrintSourceModule" NOT NULL DEFAULT 'MANUAL',
    "output" "PrintOutputMode" NOT NULL DEFAULT 'THERMAL',
    "reason" TEXT,
    "totalLabels" INTEGER NOT NULL DEFAULT 0,
    "totalCopies" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "failureReason" TEXT,
    "reprintOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_job_items" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "templateId" TEXT,
    "barcodeValue" TEXT,
    "barcodeSymbology" "BarcodeSymbology" NOT NULL DEFAULT 'EAN13',
    "status" "PrintJobItemStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_job_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printer_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "storeCode" TEXT,
    "terminalId" TEXT,
    "defaultPrinterId" TEXT,
    "defaultTemplateId" TEXT,
    "defaultCopies" INTEGER NOT NULL DEFAULT 1,
    "defaultWidthMm" DECIMAL(6,2) NOT NULL DEFAULT 50,
    "defaultHeightMm" DECIMAL(6,2) NOT NULL DEFAULT 25,
    "marginTopMm" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "marginRightMm" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "marginBottomMm" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "marginLeftMm" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "orientation" TEXT NOT NULL DEFAULT 'portrait',
    "darkness" INTEGER NOT NULL DEFAULT 8,
    "printSpeed" INTEGER NOT NULL DEFAULT 4,
    "barcodeSymbology" "BarcodeSymbology" NOT NULL DEFAULT 'EAN13',
    "showPreviewBeforePrint" BOOLEAN NOT NULL DEFAULT true,
    "printAfterProductCreate" BOOLEAN NOT NULL DEFAULT false,
    "printAfterPurchase" BOOLEAN NOT NULL DEFAULT true,
    "outputMode" "PrintOutputMode" NOT NULL DEFAULT 'PDF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "printer_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "label_templates_code_key" ON "label_templates"("code");

-- CreateIndex
CREATE INDEX "label_templates_kind_idx" ON "label_templates"("kind");

-- CreateIndex
CREATE INDEX "label_templates_isActive_idx" ON "label_templates"("isActive");

-- CreateIndex
CREATE INDEX "label_templates_isSystem_idx" ON "label_templates"("isSystem");

-- CreateIndex
CREATE INDEX "label_templates_storeCode_idx" ON "label_templates"("storeCode");

-- CreateIndex
CREATE UNIQUE INDEX "printers_code_key" ON "printers"("code");

-- CreateIndex
CREATE INDEX "printers_isActive_idx" ON "printers"("isActive");

-- CreateIndex
CREATE INDEX "printers_isDefault_idx" ON "printers"("isDefault");

-- CreateIndex
CREATE INDEX "printers_status_idx" ON "printers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "print_jobs_jobNumber_key" ON "print_jobs"("jobNumber");

-- CreateIndex
CREATE INDEX "print_jobs_status_createdAt_idx" ON "print_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "print_jobs_printerId_status_idx" ON "print_jobs"("printerId", "status");

-- CreateIndex
CREATE INDEX "print_jobs_requestedById_idx" ON "print_jobs"("requestedById");

-- CreateIndex
CREATE INDEX "print_jobs_source_idx" ON "print_jobs"("source");

-- CreateIndex
CREATE INDEX "print_jobs_createdAt_idx" ON "print_jobs"("createdAt");

-- CreateIndex
CREATE INDEX "print_job_items_jobId_idx" ON "print_job_items"("jobId");

-- CreateIndex
CREATE INDEX "print_job_items_variantId_idx" ON "print_job_items"("variantId");

-- CreateIndex
CREATE INDEX "print_job_items_status_idx" ON "print_job_items"("status");

-- CreateIndex
CREATE UNIQUE INDEX "printer_settings_storeCode_terminalId_key" ON "printer_settings"("storeCode", "terminalId");

-- AddForeignKey
ALTER TABLE "label_templates" ADD CONSTRAINT "label_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "printers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "label_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_reprintOfId_fkey" FOREIGN KEY ("reprintOfId") REFERENCES "print_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_job_items" ADD CONSTRAINT "print_job_items_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "print_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_job_items" ADD CONSTRAINT "print_job_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_job_items" ADD CONSTRAINT "print_job_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "label_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_settings" ADD CONSTRAINT "printer_settings_defaultPrinterId_fkey" FOREIGN KEY ("defaultPrinterId") REFERENCES "printers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_settings" ADD CONSTRAINT "printer_settings_defaultTemplateId_fkey" FOREIGN KEY ("defaultTemplateId") REFERENCES "label_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
