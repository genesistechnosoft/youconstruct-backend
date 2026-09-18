-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('DRAFT', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ReturnReasonCode" AS ENUM ('DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'MISSING_PARTS', 'QUALITY_ISSUE', 'CHANGED_MIND', 'OTHER');

-- CreateEnum
CREATE TYPE "PayoutOrigin" AS ENUM ('VENDOR_REQUEST', 'ADMIN');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_PAID';

-- AlterEnum
ALTER TYPE "MediaEntityType" ADD VALUE 'RETURN_REQUEST';

-- AlterEnum
ALTER TYPE "MediaContext" ADD VALUE 'RETURN_EVIDENCE';

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'RETURN_REQUESTED';
ALTER TYPE "NotificationEventType" ADD VALUE 'RETURN_APPROVED';
ALTER TYPE "NotificationEventType" ADD VALUE 'RETURN_REJECTED';
ALTER TYPE "NotificationEventType" ADD VALUE 'RETURN_RECEIVED';
ALTER TYPE "NotificationEventType" ADD VALUE 'RETURN_REFUNDED';

-- AlterTable
ALTER TABLE "addresses" ADD COLUMN "phone" TEXT;

-- AlterTable
ALTER TABLE "otp_verifications"
ADD COLUMN "referenceType" TEXT,
ADD COLUMN "referenceId" TEXT;

CREATE INDEX "otp_verifications_purpose_referenceId_createdAt_idx"
ON "otp_verifications"("purpose", "referenceId", "createdAt");

CREATE INDEX "otp_verifications_target_purpose_createdAt_idx"
ON "otp_verifications"("target", "purpose", "createdAt");

-- AlterTable
ALTER TABLE "vendor_payouts"
ADD COLUMN "origin" "PayoutOrigin" NOT NULL DEFAULT 'VENDOR_REQUEST',
ADD COLUMN "initiatedByUserId" TEXT,
ADD COLUMN "payoutMethod" TEXT,
ADD COLUMN "referenceUtr" TEXT;

CREATE INDEX "vendor_payouts_initiatedByUserId_idx" ON "vendor_payouts"("initiatedByUserId");

ALTER TABLE "vendor_payouts"
ADD CONSTRAINT "vendor_payouts_initiatedByUserId_fkey"
FOREIGN KEY ("initiatedByUserId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "orders"
ADD COLUMN "onlineAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "offlineAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "addressPhone" TEXT;

UPDATE "orders"
SET
  "onlineAmount" = CASE
    WHEN "paymentMethod" = 'ONLINE' THEN "grandTotal"
    ELSE 0
  END,
  "offlineAmount" = CASE
    WHEN "paymentMethod" = 'COD' THEN "grandTotal"
    ELSE 0
  END;

-- AlterTable
ALTER TABLE "sub_orders"
ADD COLUMN "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "onlineMerchandiseAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "onlineShippingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "offlineMerchandiseAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "sub_orders" AS so
SET
  "onlineMerchandiseAmount" = CASE
    WHEN o."paymentMethod" = 'ONLINE' THEN so."subtotal"
    ELSE 0
  END,
  "onlineShippingAmount" = CASE
    WHEN o."paymentMethod" = 'ONLINE' THEN so."shippingCharge"
    ELSE 0
  END,
  "offlineMerchandiseAmount" = CASE
    WHEN o."paymentMethod" = 'COD' THEN so."subtotal"
    ELSE 0
  END
FROM "orders" AS o
WHERE o."id" = so."orderId";

-- AlterTable
ALTER TABLE "order_items"
ADD COLUMN "cancelledQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "deliveryNumber" TEXT NOT NULL,
    "subOrderId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'DRAFT',
    "trackingNumber" TEXT,
    "courierName" TEXT,
    "shippingLabelUrl" TEXT,
    "estimatedDelivery" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "vendorRemarks" TEXT,
    "customerRemarks" TEXT,
    "overriddenByUserId" TEXT,
    "overrideReason" TEXT,
    "offlineAmountDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "offlineAmountCollected" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "walletCreditAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "walletCreditedAt" TIMESTAMP(3),
    "lastUpdatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deliveries_deliveryNumber_key" ON "deliveries"("deliveryNumber");
CREATE INDEX "deliveries_subOrderId_status_createdAt_idx" ON "deliveries"("subOrderId", "status", "createdAt");

ALTER TABLE "deliveries"
ADD CONSTRAINT "deliveries_subOrderId_fkey"
FOREIGN KEY ("subOrderId") REFERENCES "sub_orders"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "deliveries"
ADD CONSTRAINT "deliveries_lastUpdatedBy_fkey"
FOREIGN KEY ("lastUpdatedBy") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "deliveries"
ADD CONSTRAINT "deliveries_overriddenByUserId_fkey"
FOREIGN KEY ("overriddenByUserId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "delivery_items" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "delivery_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "delivery_items_deliveryId_idx" ON "delivery_items"("deliveryId");
CREATE INDEX "delivery_items_orderItemId_idx" ON "delivery_items"("orderItemId");
CREATE UNIQUE INDEX "delivery_items_deliveryId_orderItemId_key" ON "delivery_items"("deliveryId", "orderItemId");

ALTER TABLE "delivery_items"
ADD CONSTRAINT "delivery_items_deliveryId_fkey"
FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "delivery_items"
ADD CONSTRAINT "delivery_items_orderItemId_fkey"
FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill one delivery per existing shipment
INSERT INTO "deliveries" (
  "id",
  "deliveryNumber",
  "subOrderId",
  "status",
  "trackingNumber",
  "courierName",
  "shippingLabelUrl",
  "estimatedDelivery",
  "shippedAt",
  "deliveredAt",
  "lastUpdatedBy",
  "createdAt",
  "updatedAt"
)
SELECT
  s."id",
  'DEL-' || SUBSTRING(s."id" FROM 1 FOR 8),
  s."subOrderId",
  CASE s."status"
    WHEN 'SHIPPED' THEN 'SHIPPED'::"DeliveryStatus"
    WHEN 'OUT_FOR_DELIVERY' THEN 'OUT_FOR_DELIVERY'::"DeliveryStatus"
    WHEN 'DELIVERED' THEN 'DELIVERED'::"DeliveryStatus"
    WHEN 'FAILED' THEN 'CANCELLED'::"DeliveryStatus"
    ELSE 'DRAFT'::"DeliveryStatus"
  END,
  s."trackingNumber",
  s."courierName",
  s."shippingLabelUrl",
  s."estimatedDelivery",
  s."shippedAt",
  s."deliveredAt",
  s."lastUpdatedBy",
  s."createdAt",
  s."updatedAt"
FROM "shipments" s;

INSERT INTO "delivery_items" ("id", "deliveryId", "orderItemId", "quantity")
SELECT
  gen_random_uuid()::text,
  s."id",
  oi."id",
  oi."quantity"
FROM "shipments" s
JOIN "order_items" oi ON oi."subOrderId" = s."subOrderId";

-- CreateTable
CREATE TABLE "return_requests" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "subOrderId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "reasonCode" "ReturnReasonCode" NOT NULL,
    "details" TEXT,
    "vendorReviewNote" TEXT,
    "adminOverrideReason" TEXT,
    "reviewedByUserId" TEXT,
    "receivedAt" TIMESTAMP(3),
    "inspectionNotes" TEXT,
    "onlineRefundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "offlineRefundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "offlineRefundConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "return_requests_userId_createdAt_idx" ON "return_requests"("userId", "createdAt");
CREATE INDEX "return_requests_vendorId_status_createdAt_idx" ON "return_requests"("vendorId", "status", "createdAt");
CREATE INDEX "return_requests_deliveryId_createdAt_idx" ON "return_requests"("deliveryId", "createdAt");
CREATE INDEX "return_requests_subOrderId_createdAt_idx" ON "return_requests"("subOrderId", "createdAt");

ALTER TABLE "return_requests"
ADD CONSTRAINT "return_requests_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "return_requests"
ADD CONSTRAINT "return_requests_subOrderId_fkey"
FOREIGN KEY ("subOrderId") REFERENCES "sub_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "return_requests"
ADD CONSTRAINT "return_requests_deliveryId_fkey"
FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "return_requests"
ADD CONSTRAINT "return_requests_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "return_requests"
ADD CONSTRAINT "return_requests_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "vendor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "return_requests"
ADD CONSTRAINT "return_requests_reviewedByUserId_fkey"
FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "return_items" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "deliveryItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "return_items_returnRequestId_idx" ON "return_items"("returnRequestId");
CREATE INDEX "return_items_orderItemId_idx" ON "return_items"("orderItemId");
CREATE INDEX "return_items_deliveryItemId_idx" ON "return_items"("deliveryItemId");

ALTER TABLE "return_items"
ADD CONSTRAINT "return_items_returnRequestId_fkey"
FOREIGN KEY ("returnRequestId") REFERENCES "return_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "return_items"
ADD CONSTRAINT "return_items_orderItemId_fkey"
FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "return_items"
ADD CONSTRAINT "return_items_deliveryItemId_fkey"
FOREIGN KEY ("deliveryItemId") REFERENCES "delivery_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "order_refunds" ADD COLUMN "returnRequestId" TEXT;

CREATE INDEX "order_refunds_returnRequestId_idx" ON "order_refunds"("returnRequestId");

ALTER TABLE "order_refunds"
ADD CONSTRAINT "order_refunds_returnRequestId_fkey"
FOREIGN KEY ("returnRequestId") REFERENCES "return_requests"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
