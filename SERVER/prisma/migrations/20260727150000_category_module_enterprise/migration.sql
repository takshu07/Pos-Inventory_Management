-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "level" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "path" TEXT,
ADD COLUMN     "searchKeywords" TEXT,
ADD COLUMN     "status" "CategoryStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedById" TEXT;

-- CreateIndex
CREATE INDEX "categories_status_idx" ON "categories"("status");

-- CreateIndex
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");

-- CreateIndex
CREATE INDEX "categories_path_idx" ON "categories"("path");

-- CreateIndex
CREATE INDEX "categories_createdAt_idx" ON "categories"("createdAt");

-- CreateIndex
CREATE INDEX "categories_searchkeywords_trgm_idx" ON "categories" USING GIN ("searchKeywords" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "categories_name_trgm_idx" ON "categories" USING GIN ("name" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: `status` is the new source of truth, `isActive` is kept in lockstep.
-- Existing rows carry only isActive, so derive the enum from it. Nothing is
-- ARCHIVED yet — archiving is a Phase 1 action, not a pre-existing state.
UPDATE "categories" SET "status" = 'INACTIVE' WHERE "isActive" = false;
