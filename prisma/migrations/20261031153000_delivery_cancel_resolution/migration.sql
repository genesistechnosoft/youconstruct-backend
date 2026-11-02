-- CreateEnum
CREATE TYPE "DeliveryCancelResolution" AS ENUM ('REATTEMPT', 'REFUND');

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN "cancelResolution" "DeliveryCancelResolution";
