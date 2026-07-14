-- CreateEnum
CREATE TYPE "VendorOnboardingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VendorPlan" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayoutTriggerType" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "TransactionReason" AS ENUM ('ORDER_EARNING', 'PAYOUT', 'REFUND_DEDUCTION', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PreferredPaymentMethod" AS ENUM ('CASH', 'ONLINE', 'BOTH');

-- AlterTable
ALTER TABLE "kyc_documents" ADD COLUMN     "fileUrl" TEXT,
ALTER COLUMN "documentNo" DROP NOT NULL;

-- AlterTable
ALTER TABLE "vendor_profiles" ADD COLUMN     "onboardingStatus" "VendorOnboardingStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "vendor_store_settings" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "shippingPolicy" TEXT,
    "refundPolicy" TEXT,
    "cancellationPolicy" TEXT,
    "preferredPaymentMethod" "PreferredPaymentMethod",
    "supportPhone" TEXT,
    "supportEmail" TEXT,
    "supportAddressLine1" TEXT,
    "supportAddressLine2" TEXT,
    "supportCity" TEXT,
    "supportState" TEXT,
    "supportPincode" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "seoKeywords" TEXT,
    "ogTitle" TEXT,
    "ogDescription" TEXT,
    "twitterTitle" TEXT,
    "twitterDescription" TEXT,
    "socialInstagram" TEXT,
    "socialFacebook" TEXT,
    "socialTwitter" TEXT,
    "socialYoutube" TEXT,
    "socialLinkedin" TEXT,
    "socialPinterest" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_store_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_memberships" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "plan" "VendorPlan" NOT NULL DEFAULT 'FREE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "storageLimitMb" INTEGER NOT NULL DEFAULT 0,
    "storageUsedMb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "productLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_wallets" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lockedBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalEarned" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalWithdrawn" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_transactions" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "reason" "TransactionReason" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceBefore" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bank_accounts" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "ifscCode" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "branchName" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payouts" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "triggerType" "PayoutTriggerType" NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "razorpayPayoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_store_settings_vendorId_key" ON "vendor_store_settings"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_memberships_vendorId_key" ON "vendor_memberships"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_wallets_vendorId_key" ON "vendor_wallets"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bank_accounts_vendorId_key" ON "vendor_bank_accounts"("vendorId");

-- AddForeignKey
ALTER TABLE "vendor_store_settings" ADD CONSTRAINT "vendor_store_settings_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_memberships" ADD CONSTRAINT "vendor_memberships_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_wallets" ADD CONSTRAINT "vendor_wallets_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_transactions" ADD CONSTRAINT "vendor_transactions_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_transactions" ADD CONSTRAINT "vendor_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "vendor_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bank_accounts" ADD CONSTRAINT "vendor_bank_accounts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payouts" ADD CONSTRAINT "vendor_payouts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payouts" ADD CONSTRAINT "vendor_payouts_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "vendor_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payouts" ADD CONSTRAINT "vendor_payouts_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "vendor_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
