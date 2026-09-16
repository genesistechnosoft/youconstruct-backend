UPDATE "users"
SET "platformRole" = 'ADMIN'::"PlatformRole"
WHERE "platformRole" = 'SUPPORT'::"PlatformRole";

UPDATE "invitations"
SET "platformRole" = 'ADMIN'::"PlatformRole",
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "platformRole" = 'SUPPORT'::"PlatformRole";

UPDATE "security_audit_logs"
SET "actorRole" = 'ADMIN'::"PlatformRole"
WHERE "actorRole" = 'SUPPORT'::"PlatformRole";

UPDATE "order_cancellations"
SET "actorRole" = 'ADMIN'::"PlatformRole",
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "actorRole" = 'SUPPORT'::"PlatformRole";

UPDATE "invitations"
SET "email" = lower("email"),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "email" <> lower("email");

UPDATE "invitations"
SET "status" = 'EXPIRED'::"InvitationStatus",
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'PENDING'::"InvitationStatus"
  AND "expiresAt" <= CURRENT_TIMESTAMP;

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY lower("email"), "scope", "scopeEntityId"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS row_number
  FROM "invitations"
  WHERE "status" = 'PENDING'::"InvitationStatus"
)
UPDATE "invitations" AS invitation
SET "status" = 'REVOKED'::"InvitationStatus",
    "updatedAt" = CURRENT_TIMESTAMP
FROM ranked
WHERE invitation."id" = ranked."id"
  AND ranked.row_number > 1;

ALTER TABLE "users" ALTER COLUMN "platformRole" DROP DEFAULT;
ALTER TYPE "PlatformRole" RENAME TO "PlatformRole_old";
CREATE TYPE "PlatformRole" AS ENUM (
  'SUPER_ADMIN',
  'ADMIN',
  'CUSTOMER',
  'VENDOR',
  'PROFESSIONAL'
);

ALTER TABLE "users"
  ALTER COLUMN "platformRole" TYPE "PlatformRole"
  USING ("platformRole"::text::"PlatformRole");
ALTER TABLE "invitations"
  ALTER COLUMN "platformRole" TYPE "PlatformRole"
  USING ("platformRole"::text::"PlatformRole");
ALTER TABLE "security_audit_logs"
  ALTER COLUMN "actorRole" TYPE "PlatformRole"
  USING ("actorRole"::text::"PlatformRole");
ALTER TABLE "order_cancellations"
  ALTER COLUMN "actorRole" TYPE "PlatformRole"
  USING ("actorRole"::text::"PlatformRole");

DROP TYPE "PlatformRole_old";
ALTER TABLE "users"
  ALTER COLUMN "platformRole" SET DEFAULT 'CUSTOMER'::"PlatformRole";

CREATE UNIQUE INDEX "invitations_pending_email_context_unique"
  ON "invitations" (lower("email"), "scope", "scopeEntityId")
  WHERE "status" = 'PENDING'::"InvitationStatus"
    AND "scopeEntityId" IS NOT NULL;

CREATE UNIQUE INDEX "invitations_pending_email_admin_unique"
  ON "invitations" (lower("email"), "scope")
  WHERE "status" = 'PENDING'::"InvitationStatus"
    AND "scopeEntityId" IS NULL;
