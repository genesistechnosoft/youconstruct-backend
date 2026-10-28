-- Drop the partial pending-content review. No backfill: staged JSON is discarded.
DROP INDEX IF EXISTS "products_pendingContentReview_status_deletedAt_idx";

ALTER TABLE "products" DROP COLUMN "pendingContentReview",
DROP COLUMN "pendingContent";

ALTER TABLE "products" ADD COLUMN "catalogDraft" JSONB;

-- Admin queue: active products with an open catalog draft.
CREATE INDEX "products_catalog_draft_queue_idx" ON "products" ("status", "deletedAt")
WHERE
  "catalogDraft" IS NOT NULL;

CREATE TABLE "catalog_draft_skus" (
  "sku" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  CONSTRAINT "catalog_draft_skus_pkey" PRIMARY KEY ("sku")
);

CREATE INDEX "catalog_draft_skus_productId_idx" ON "catalog_draft_skus" ("productId");

ALTER TABLE "catalog_draft_skus" ADD CONSTRAINT "catalog_draft_skus_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
