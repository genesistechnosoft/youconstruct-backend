-- CreateEnum
CREATE TYPE "MediaOwnerType" AS ENUM ('VENDOR', 'PROFESSIONAL', 'ADMIN');

-- CreateEnum
CREATE TYPE "MediaAccessLevel" AS ENUM ('PUBLIC', 'PRIVATE', 'SIGNED');

-- CreateEnum
CREATE TYPE "MediaFileType" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "StorageDriver" AS ENUM ('LOCAL', 'R2');

-- CreateEnum
CREATE TYPE "MediaProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaEntityType" AS ENUM ('PRODUCT', 'PRODUCT_VARIANT', 'VENDOR_PROFILE', 'PROFESSIONAL_PROFILE', 'CATEGORY', 'BRAND', 'HOMEPAGE_BANNER');

-- CreateEnum
CREATE TYPE "MediaContext" AS ENUM ('GALLERY', 'PRIMARY', 'LOGO', 'BANNER', 'THUMBNAIL', 'CATEGORY_IMAGE', 'BRAND_LOGO', 'PROFILE_PHOTO', 'PROJECT_PHOTO', 'REEL');

-- CreateEnum
CREATE TYPE "MediaProcessingJobType" AS ENUM ('IMAGE_COMPRESS', 'THUMBNAIL_GENERATE', 'VIDEO_TRANSCODE');

-- CreateEnum
CREATE TYPE "MediaProcessingJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "kyc_documents" ADD COLUMN     "mediaId" TEXT;

-- CreateTable
CREATE TABLE "media" (
    "id" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "ownerType" "MediaOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "folderId" TEXT,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "fileType" "MediaFileType" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" DOUBLE PRECISION,
    "storageDriver" "StorageDriver" NOT NULL,
    "originalKey" TEXT NOT NULL,
    "optimizedKey" TEXT,
    "thumbnailKey" TEXT,
    "accessLevel" "MediaAccessLevel" NOT NULL DEFAULT 'PUBLIC',
    "processingStatus" "MediaProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_folders" (
    "id" TEXT NOT NULL,
    "ownerType" "MediaOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_links" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "entityType" "MediaEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "context" "MediaContext",
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_processing_jobs" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "jobType" "MediaProcessingJobType" NOT NULL,
    "status" "MediaProcessingJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_uploadedBy_idx" ON "media"("uploadedBy");

-- CreateIndex
CREATE INDEX "media_ownerType_ownerId_idx" ON "media"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "media_folderId_idx" ON "media"("folderId");

-- CreateIndex
CREATE INDEX "media_fileType_idx" ON "media"("fileType");

-- CreateIndex
CREATE INDEX "media_processingStatus_idx" ON "media"("processingStatus");

-- CreateIndex
CREATE INDEX "media_folders_ownerType_ownerId_idx" ON "media_folders"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "media_folders_parentId_idx" ON "media_folders"("parentId");

-- CreateIndex
CREATE INDEX "media_links_mediaId_idx" ON "media_links"("mediaId");

-- CreateIndex
CREATE INDEX "media_links_entityType_entityId_idx" ON "media_links"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "media_links_entityType_entityId_context_idx" ON "media_links"("entityType", "entityId", "context");

-- CreateIndex
CREATE INDEX "media_processing_jobs_mediaId_idx" ON "media_processing_jobs"("mediaId");

-- CreateIndex
CREATE INDEX "media_processing_jobs_status_idx" ON "media_processing_jobs"("status");

-- CreateIndex
CREATE INDEX "media_processing_jobs_jobType_idx" ON "media_processing_jobs"("jobType");

-- CreateIndex
CREATE INDEX "kyc_documents_mediaId_idx" ON "kyc_documents"("mediaId");

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "media_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "media_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_links" ADD CONSTRAINT "media_links_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_processing_jobs" ADD CONSTRAINT "media_processing_jobs_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
