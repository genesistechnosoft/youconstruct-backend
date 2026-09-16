-- Add BANNER_WEB and BANNER_APP to MediaContext enum
ALTER TYPE "MediaContext" ADD VALUE 'BANNER_WEB';
ALTER TYPE "MediaContext" ADD VALUE 'BANNER_APP';

-- Backfill: copy existing homepage_banners.media_id into media_links as BANNER_WEB
INSERT INTO "media_links" ("id", "mediaId", "entityType", "entityId", "context", "isPrimary", "sortOrder", "createdAt")
SELECT
  gen_random_uuid(),
  hb."mediaId",
  'HOMEPAGE_BANNER'::"MediaEntityType",
  hb."id",
  'BANNER_WEB'::"MediaContext",
  true,
  0,
  now()
FROM "homepage_banners" hb
WHERE hb."mediaId" IS NOT NULL;

-- Drop the mediaId FK constraint and column
ALTER TABLE "homepage_banners" DROP CONSTRAINT IF EXISTS "homepage_banners_mediaId_fkey";
ALTER TABLE "homepage_banners" DROP COLUMN IF EXISTS "mediaId";
