-- Reassign media linked from kyc_documents to USER ownership
UPDATE "media" AS m
SET
  "ownerType" = 'USER',
  "ownerId" = k."userId"
FROM "kyc_documents" AS k
WHERE k."mediaId" = m.id
  AND m."deletedAt" IS NULL;

-- Reassign orphaned private KYC uploads by key prefix when user id in path is valid
-- Path shape: kyc/{userId}/{documentType}/...
UPDATE "media" AS m
SET
  "ownerType" = 'USER',
  "ownerId" = split_part(m."originalKey", '/', 2)
WHERE m."ownerType" = 'VENDOR'
  AND m."accessLevel" = 'PRIVATE'
  AND m."originalKey" LIKE 'kyc/%/%'
  AND m."deletedAt" IS NULL
  AND split_part(m."originalKey", '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1
    FROM "users" AS u
    WHERE u."id" = split_part(m."originalKey", '/', 2)
      AND u."deletedAt" IS NULL
  );
