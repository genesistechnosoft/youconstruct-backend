-- CreateEnum
CREATE TYPE "PlatformSettingValueType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'DECIMAL_STRING', 'JSON', 'STRING_ARRAY');

-- CreateEnum
CREATE TYPE "OrderRefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RestockStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'FCM', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('ORDER_PLACED', 'ORDER_PAID', 'ORDER_CANCELLED', 'ORDER_REFUNDED', 'ORDER_SHIPPED', 'ORDER_DELIVERED', 'PRODUCT_APPROVED', 'PRODUCT_REJECTED', 'KYC_APPROVED', 'KYC_REJECTED', 'PAYOUT_PROCESSING', 'PAYOUT_COMPLETED', 'PAYOUT_FAILED', 'COUPON_CREATED', 'BULK_UPLOAD_COMPLETED', 'BULK_UPLOAD_FAILED');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CouponScope" AS ENUM ('PLATFORM', 'VENDOR');

-- CreateEnum
CREATE TYPE "CouponDiscountType" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "CouponStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BulkProductUploadStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'VALIDATED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BulkProductUploadRowStatus" AS ENUM ('PENDING', 'VALID', 'INVALID', 'IMPORTED', 'FAILED');

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "imageStorageKeySnapshot" TEXT,
ADD COLUMN     "imageUrlSnapshot" TEXT;

-- AlterTable
ALTER TABLE "vendor_bank_accounts" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "vendor_profiles" ADD COLUMN     "slug" TEXT;

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "valueType" "PlatformSettingValueType" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "isEditable" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_refunds" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "subOrderId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "OrderRefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "initiatedByUserId" TEXT,
    "razorpayRefundId" TEXT,
    "providerPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_cancellations" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "subOrderId" TEXT,
    "actorUserId" TEXT,
    "actorRole" "PlatformRole",
    "reason" TEXT NOT NULL,
    "restockStatus" "RestockStatus" NOT NULL DEFAULT 'PENDING',
    "refundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" "NotificationEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "providerId" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "scope" "CouponScope" NOT NULL,
    "vendorId" TEXT,
    "status" "CouponStatus" NOT NULL DEFAULT 'DRAFT',
    "discountType" "CouponDiscountType" NOT NULL,
    "discountValue" DECIMAL(12,2) NOT NULL,
    "maxDiscountAmount" DECIMAL(12,2),
    "minOrderAmount" DECIMAL(12,2),
    "usageLimit" INTEGER,
    "usageLimitPerUser" INTEGER,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_usages" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wishlist_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homepage_banners" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "mediaId" TEXT,
    "targetUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "homepage_banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_product_uploads" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT,
    "status" "BulkProductUploadStatus" NOT NULL DEFAULT 'UPLOADED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bulk_product_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_product_upload_rows" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "status" "BulkProductUploadRowStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "productId" TEXT,
    "variantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bulk_product_upload_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_settings_namespace_idx" ON "platform_settings"("namespace");

-- CreateIndex
CREATE INDEX "platform_settings_isEditable_idx" ON "platform_settings"("isEditable");

-- CreateIndex
CREATE INDEX "platform_settings_updatedAt_idx" ON "platform_settings"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_settings_namespace_key_key" ON "platform_settings"("namespace", "key");

-- CreateIndex
CREATE UNIQUE INDEX "order_refunds_razorpayRefundId_key" ON "order_refunds"("razorpayRefundId");

-- CreateIndex
CREATE INDEX "order_refunds_orderId_createdAt_idx" ON "order_refunds"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_refunds_subOrderId_createdAt_idx" ON "order_refunds"("subOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_refunds_status_createdAt_idx" ON "order_refunds"("status", "createdAt");

-- CreateIndex
CREATE INDEX "order_cancellations_orderId_createdAt_idx" ON "order_cancellations"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_cancellations_subOrderId_createdAt_idx" ON "order_cancellations"("subOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_cancellations_actorUserId_createdAt_idx" ON "order_cancellations"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "order_cancellations_restockStatus_createdAt_idx" ON "order_cancellations"("restockStatus", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_eventType_createdAt_idx" ON "notifications"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_notificationId_channel_status_idx" ON "notification_deliveries"("notificationId", "channel", "status");

-- CreateIndex
CREATE INDEX "notification_deliveries_channel_status_createdAt_idx" ON "notification_deliveries"("channel", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_scope_status_expiresAt_idx" ON "coupons"("scope", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "coupons_vendorId_status_expiresAt_idx" ON "coupons"("vendorId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "coupons_createdAt_idx" ON "coupons"("createdAt");

-- CreateIndex
CREATE INDEX "coupon_usages_couponId_createdAt_idx" ON "coupon_usages"("couponId", "createdAt");

-- CreateIndex
CREATE INDEX "coupon_usages_userId_couponId_idx" ON "coupon_usages"("userId", "couponId");

-- CreateIndex
CREATE INDEX "coupon_usages_orderId_idx" ON "coupon_usages"("orderId");

-- CreateIndex
CREATE INDEX "wishlist_items_userId_createdAt_idx" ON "wishlist_items"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "wishlist_items_productId_idx" ON "wishlist_items"("productId");

-- CreateIndex
CREATE INDEX "wishlist_items_variantId_idx" ON "wishlist_items"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "wishlist_items_userId_productId_variantId_key" ON "wishlist_items"("userId", "productId", "variantId");

-- CreateIndex
CREATE INDEX "homepage_banners_isActive_sortOrder_idx" ON "homepage_banners"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "homepage_banners_startsAt_endsAt_idx" ON "homepage_banners"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "homepage_banners_mediaId_idx" ON "homepage_banners"("mediaId");

-- CreateIndex
CREATE INDEX "bulk_product_uploads_vendorId_status_createdAt_idx" ON "bulk_product_uploads"("vendorId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "bulk_product_uploads_uploadedByUserId_createdAt_idx" ON "bulk_product_uploads"("uploadedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "bulk_product_upload_rows_uploadId_status_idx" ON "bulk_product_upload_rows"("uploadId", "status");

-- CreateIndex
CREATE INDEX "bulk_product_upload_rows_productId_idx" ON "bulk_product_upload_rows"("productId");

-- CreateIndex
CREATE INDEX "bulk_product_upload_rows_variantId_idx" ON "bulk_product_upload_rows"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_product_upload_rows_uploadId_rowNumber_key" ON "bulk_product_upload_rows"("uploadId", "rowNumber");

-- CreateIndex
CREATE INDEX "addresses_userId_deletedAt_idx" ON "addresses"("userId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_definitions_name_key" ON "attribute_definitions"("name");

-- CreateIndex
CREATE INDEX "brands_isActive_deletedAt_name_idx" ON "brands"("isActive", "deletedAt", "name");

-- CreateIndex
CREATE INDEX "cart_items_variantId_idx" ON "cart_items"("variantId");

-- CreateIndex
CREATE INDEX "categories_parentId_isActive_deletedAt_sortOrder_idx" ON "categories"("parentId", "isActive", "deletedAt", "sortOrder");

-- CreateIndex
CREATE INDEX "categories_isActive_deletedAt_sortOrder_idx" ON "categories"("isActive", "deletedAt", "sortOrder");

-- CreateIndex
CREATE INDEX "order_items_variantId_idx" ON "order_items"("variantId");

-- CreateIndex
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

-- CreateIndex
CREATE INDEX "product_variants_productId_deletedAt_isActive_idx" ON "product_variants"("productId", "deletedAt", "isActive");

-- CreateIndex
CREATE INDEX "product_variants_sellingPrice_idx" ON "product_variants"("sellingPrice");

-- CreateIndex
CREATE INDEX "products_status_deletedAt_createdAt_idx" ON "products"("status", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "products_categoryId_status_deletedAt_idx" ON "products"("categoryId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "products_brandId_status_deletedAt_idx" ON "products"("brandId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "products_vendorId_deletedAt_idx" ON "products"("vendorId", "deletedAt");

-- CreateIndex
CREATE INDEX "products_createdAt_idx" ON "products"("createdAt");

-- CreateIndex
CREATE INDEX "variant_attributes_attributeId_idx" ON "variant_attributes"("attributeId");

-- CreateIndex
CREATE INDEX "vendor_bank_accounts_vendorId_deletedAt_idx" ON "vendor_bank_accounts"("vendorId", "deletedAt");

-- CreateIndex
CREATE INDEX "vendor_bank_accounts_isVerified_deletedAt_idx" ON "vendor_bank_accounts"("isVerified", "deletedAt");

-- CreateIndex
CREATE INDEX "vendor_payouts_vendorId_status_createdAt_idx" ON "vendor_payouts"("vendorId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "vendor_payouts_walletId_status_createdAt_idx" ON "vendor_payouts"("walletId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "vendor_payouts_bankAccountId_idx" ON "vendor_payouts"("bankAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_profiles_slug_key" ON "vendor_profiles"("slug");

-- CreateIndex
CREATE INDEX "vendor_profiles_onboardingStatus_createdAt_idx" ON "vendor_profiles"("onboardingStatus", "createdAt");

-- CreateIndex
CREATE INDEX "vendor_profiles_isApproved_deletedAt_idx" ON "vendor_profiles"("isApproved", "deletedAt");

-- CreateIndex
CREATE INDEX "vendor_transactions_vendorId_createdAt_idx" ON "vendor_transactions"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "vendor_transactions_walletId_createdAt_idx" ON "vendor_transactions"("walletId", "createdAt");

-- AddForeignKey
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "sub_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_cancellations" ADD CONSTRAINT "order_cancellations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_cancellations" ADD CONSTRAINT "order_cancellations_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "sub_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_cancellations" ADD CONSTRAINT "order_cancellations_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_cancellations" ADD CONSTRAINT "order_cancellations_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "order_refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_banners" ADD CONSTRAINT "homepage_banners_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_banners" ADD CONSTRAINT "homepage_banners_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_banners" ADD CONSTRAINT "homepage_banners_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_product_uploads" ADD CONSTRAINT "bulk_product_uploads_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_product_uploads" ADD CONSTRAINT "bulk_product_uploads_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_product_upload_rows" ADD CONSTRAINT "bulk_product_upload_rows_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "bulk_product_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
