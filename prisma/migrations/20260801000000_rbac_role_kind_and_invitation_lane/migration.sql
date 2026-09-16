-- CreateEnum
CREATE TYPE "RoleKind" AS ENUM ('OWNER', 'CUSTOM');

-- Replace custom_roles.isSystem with an explicit role kind.
-- Owner was previously identified by isSystem + name = 'Owner' + non-ADMIN scope.
ALTER TABLE "custom_roles" ADD COLUMN "kind" "RoleKind" NOT NULL DEFAULT 'CUSTOM';

UPDATE "custom_roles"
SET "kind" = 'OWNER'
WHERE "isSystem" = true
  AND "name" = 'Owner'
  AND "scope" <> 'ADMIN';

ALTER TABLE "custom_roles" DROP COLUMN "isSystem";

-- invitations.platformRole becomes required; backfill the lane from scope.
UPDATE "invitations"
SET "platformRole" = CASE
  WHEN "scope" = 'VENDOR' THEN 'VENDOR'::"PlatformRole"
  WHEN "scope" = 'PROFESSIONAL' THEN 'PROFESSIONAL'::"PlatformRole"
  ELSE 'SUPPORT'::"PlatformRole"
END
WHERE "platformRole" IS NULL;

ALTER TABLE "invitations" ALTER COLUMN "platformRole" SET NOT NULL;

-- acceptedById had an index but no foreign key.
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
