-- CreateEnum
CREATE TYPE "MediaFileType" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "StorageDriver" AS ENUM ('LOCAL', 'R2');

-- CreateEnum
CREATE TYPE "MediaVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "MediaProcessingStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "media" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" "MediaFileType" NOT NULL,
    "visibility" "MediaVisibility" NOT NULL,
    "checksum" TEXT,
    "metadata" JSONB,
    "processingStatus" "MediaProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "variantType" TEXT NOT NULL,
    "storageDriver" "StorageDriver" NOT NULL DEFAULT 'LOCAL',
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_links" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "context" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_uploadedById_createdAt_idx" ON "media"("uploadedById", "createdAt");

-- CreateIndex
CREATE INDEX "media_processingStatus_idx" ON "media"("processingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_mediaId_variantType_key" ON "media_assets"("mediaId", "variantType");

-- CreateIndex
CREATE INDEX "media_assets_mediaId_variantType_idx" ON "media_assets"("mediaId", "variantType");

-- CreateIndex
CREATE INDEX "media_assets_storageDriver_storageKey_idx" ON "media_assets"("storageDriver", "storageKey");

-- CreateIndex
CREATE INDEX "media_links_mediaId_idx" ON "media_links"("mediaId");

-- CreateIndex
CREATE INDEX "media_links_entityType_entityId_context_sortOrder_idx" ON "media_links"("entityType", "entityId", "context", "sortOrder");

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_links" ADD CONSTRAINT "media_links_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
