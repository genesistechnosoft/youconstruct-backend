-- MFA-ready fields for future platform staff hardening (not enforced yet)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfaSecret" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfaBackupCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfaVerifiedAt" TIMESTAMP(3);
