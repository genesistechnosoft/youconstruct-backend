-- Listing QC failures were stored as DRAFT + rejectionNote.
-- Live content-reject stays ACTIVE and is not touched.
UPDATE "products"
SET "status" = 'REJECTED'
WHERE "status" = 'DRAFT'
  AND "rejectionNote" IS NOT NULL
  AND "deletedAt" IS NULL;
