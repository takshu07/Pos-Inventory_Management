-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "bin" TEXT,
ADD COLUMN     "discountAllowed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "heightCm" DECIMAL(8,2),
ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "lengthCm" DECIMAL(8,2),
ADD COLUMN     "maxDiscountPct" DECIMAL(5,2),
ADD COLUMN     "rack" TEXT,
ADD COLUMN     "shelf" TEXT,
ADD COLUMN     "shelfLocation" TEXT,
ADD COLUMN     "supplierId" TEXT,
ADD COLUMN     "supplierSku" TEXT,
ADD COLUMN     "warehouse" TEXT,
ADD COLUMN     "widthCm" DECIMAL(8,2);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "collectionName" TEXT,
ADD COLUMN     "fabricMaterial" TEXT,
ADD COLUMN     "fit" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "gstRate" DECIMAL(5,2),
ADD COLUMN     "hsnCode" TEXT,
ADD COLUMN     "neckType" TEXT,
ADD COLUMN     "occasion" TEXT,
ADD COLUMN     "pattern" TEXT,
ADD COLUMN     "season" TEXT,
ADD COLUMN     "sleeveType" TEXT,
ADD COLUMN     "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

