-- AlterTable
ALTER TABLE "products" ADD COLUMN     "pendingContent" JSONB,
ADD COLUMN     "pendingContentReview" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "products_pendingContentReview_status_deletedAt_idx" ON "products"("pendingContentReview", "status", "deletedAt");
