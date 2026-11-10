-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: professional_module_foundation
-- Phase 1 of Module 4 — Professional System
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "ProfessionalOnboardingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ProfessionalContentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REMOVED');

-- CreateEnum
CREATE TYPE "BudgetRange" AS ENUM ('UNDER_5_LAKH', 'LAKH_5_TO_10', 'LAKH_10_TO_25', 'LAKH_25_TO_50', 'LAKH_50_TO_100', 'ABOVE_1_CRORE');

-- AlterEnum: extend MediaEntityType
ALTER TYPE "MediaEntityType" ADD VALUE 'PROFESSIONAL_PROJECT';

-- AlterEnum: extend NotificationEventType (each ADD VALUE is a separate statement — safe in Postgres 12+)
ALTER TYPE "NotificationEventType" ADD VALUE 'PROFESSIONAL_APPROVED';
ALTER TYPE "NotificationEventType" ADD VALUE 'PROFESSIONAL_REJECTED';
ALTER TYPE "NotificationEventType" ADD VALUE 'PROFESSIONAL_SUSPENDED';
ALTER TYPE "NotificationEventType" ADD VALUE 'PROFESSIONAL_REINSTATED';
ALTER TYPE "NotificationEventType" ADD VALUE 'PROJECT_APPROVED';
ALTER TYPE "NotificationEventType" ADD VALUE 'PROJECT_REJECTED';
ALTER TYPE "NotificationEventType" ADD VALUE 'PROJECT_REMOVED';

-- AlterTable: professional_profiles
-- Step 1 – add new columns (onboardingStatus uses the enum we just created above)
ALTER TABLE "professional_profiles"
  ADD COLUMN "onboardingStatus" "ProfessionalOnboardingStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "rejectionReason"  VARCHAR(500),
  ADD COLUMN "reviewedAt"       TIMESTAMP(3),
  ADD COLUMN "submittedAt"      TIMESTAMP(3),
  ADD COLUMN "suspendedAt"      TIMESTAMP(3),
  ADD COLUMN "suspensionReason" VARCHAR(500),
  ALTER COLUMN "displayName" SET DATA TYPE VARCHAR(120),
  ALTER COLUMN "tagline"     SET DATA TYPE VARCHAR(160),
  ALTER COLUMN "bio"         SET DATA TYPE VARCHAR(2000);

-- Step 2 – backfill: mark existing approved rows
UPDATE "professional_profiles"
SET "onboardingStatus" = 'APPROVED',
    "approvedAt"       = COALESCE("approvedAt", NOW())
WHERE "isApproved" = true;

-- Step 3 – drop the old isActive column (isApproved kept for backcompat during transition)
ALTER TABLE "professional_profiles" DROP COLUMN "isActive";

-- CreateTable: professional_categories
CREATE TABLE "professional_categories" (
    "id"          TEXT         NOT NULL,
    "name"        VARCHAR(80)  NOT NULL,
    "slug"        TEXT         NOT NULL,
    "description" VARCHAR(300),
    "isActive"    BOOLEAN      NOT NULL DEFAULT true,
    "sortOrder"   INTEGER      NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    "deletedAt"   TIMESTAMP(3),

    CONSTRAINT "professional_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable: professional_profile_categories
CREATE TABLE "professional_profile_categories" (
    "professionalId" TEXT         NOT NULL,
    "categoryId"     TEXT         NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "professional_profile_categories_pkey" PRIMARY KEY ("professionalId","categoryId")
);

-- CreateTable: professional_projects
CREATE TABLE "professional_projects" (
    "id"              TEXT                        NOT NULL,
    "professionalId"  TEXT                        NOT NULL,
    "title"           VARCHAR(150)                NOT NULL,
    "description"     VARCHAR(5000),
    "location"        VARCHAR(150),
    "areaSqft"        DECIMAL(10,2),
    "budgetRange"     "BudgetRange",
    "completionYear"  SMALLINT,
    "status"          "ProfessionalContentStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectionReason" VARCHAR(500),
    "removalReason"   VARCHAR(500),
    "submittedAt"     TIMESTAMP(3),
    "reviewedAt"      TIMESTAMP(3),
    "approvedAt"      TIMESTAMP(3),
    "removedAt"       TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3)                NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3)                NOT NULL,
    "deletedAt"       TIMESTAMP(3),

    CONSTRAINT "professional_projects_pkey"              PRIMARY KEY ("id"),
    CONSTRAINT "professional_projects_completionYear_chk" CHECK ("completionYear" BETWEEN 1950 AND 2100)
);

-- CreateIndex
CREATE UNIQUE INDEX "professional_categories_slug_key"
  ON "professional_categories"("slug");

CREATE INDEX "professional_categories_isActive_deletedAt_sortOrder_idx"
  ON "professional_categories"("isActive", "deletedAt", "sortOrder");

CREATE INDEX "professional_profile_categories_categoryId_idx"
  ON "professional_profile_categories"("categoryId");

CREATE INDEX "professional_projects_professionalId_status_deletedAt_idx"
  ON "professional_projects"("professionalId", "status", "deletedAt");

CREATE INDEX "professional_projects_status_submittedAt_idx"
  ON "professional_projects"("status", "submittedAt");

CREATE INDEX "professional_profiles_onboardingStatus_createdAt_idx"
  ON "professional_profiles"("onboardingStatus", "createdAt");

CREATE INDEX "professional_profiles_isApproved_deletedAt_approvedAt_idx"
  ON "professional_profiles"("isApproved", "deletedAt", "approvedAt");

-- AddForeignKey
ALTER TABLE "professional_profile_categories"
  ADD CONSTRAINT "professional_profile_categories_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "professional_profiles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "professional_profile_categories"
  ADD CONSTRAINT "professional_profile_categories_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "professional_categories"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "professional_projects"
  ADD CONSTRAINT "professional_projects_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "professional_profiles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
